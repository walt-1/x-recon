import { z } from 'zod';
import { listBookmarks, getPostsByIds as fetchPostsByIds } from '../clients/x-api.js';
import { upsertPosts, getExistingPostIds, tagPost, logSync } from '../db/index.js';
import { autoTagPosts } from '../db/tagger.js';
import { extractTweetIdsFromUrls, extractTweetIdsFromText } from '../parsers/citation.js';
import type { SyncResult, XPost } from '../types.js';

export const syncBookmarksSchema = {
  max_pages: z.number().min(1).max(50).default(5).describe(
    'Maximum number of pages to sync (20 bookmarks per page). Default 5 = 100 bookmarks.',
  ),
  auto_tag: z.boolean().default(true).describe(
    'Automatically classify and tag posts using Grok. Costs ~$0.005 per 20 posts.',
  ),
  tags: z.array(z.string()).optional().describe(
    'Manually apply these tags to ALL synced bookmarks (in addition to auto-tags).',
  ),
  stop_on_overlap: z.boolean().default(true).describe(
    'Stop syncing when overlap with already-ingested bookmarks is detected.',
  ),
  stop_before: z.string().datetime().optional().describe(
    'Stop syncing when page contains posts older than this ISO 8601 date.',
  ),
  force_full_scan: z.boolean().default(false).describe(
    'Bypass smart stopping; fetch until max_pages or API exhausted.',
  ),
};

type StopReason = 'overlap' | 'date_cutoff' | 'max_pages' | 'no_more_pages';

function collectReferencedIds(posts: XPost[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const post of posts) {
    const candidates: string[] = [];

    if (post.quoted_tweet_id) candidates.push(post.quoted_tweet_id);
    if (post.in_reply_to) candidates.push(post.in_reply_to);
    if (post.urls.length > 0) candidates.push(...extractTweetIdsFromUrls(post.urls));
    if (post.source_url) candidates.push(...extractTweetIdsFromText(post.source_url));

    for (const id of candidates) {
      if (/^\d+$/.test(id) && id !== post.id && !seen.has(id)) {
        seen.add(id);
        result.push(id);
      }
    }
  }

  return result;
}

function getOldestTimestamp(posts: XPost[]): string | null {
  if (posts.length === 0) return null;
  let oldest = posts[0].timestamp;
  for (const post of posts) {
    if (post.timestamp < oldest) oldest = post.timestamp;
  }
  return oldest;
}

export async function syncBookmarks(params: {
  max_pages: number;
  auto_tag: boolean;
  tags?: string[];
  stop_on_overlap: boolean;
  stop_before?: string;
  force_full_scan: boolean;
}): Promise<SyncResult> {
  const allPosts: XPost[] = [];
  const newPosts: XPost[] = [];
  let cursor: string | undefined;
  let pages = 0;
  let stopReason: StopReason | undefined;
  let overlapDetected = false;

  while (pages < params.max_pages) {
    const result = await listBookmarks(20, cursor);

    if (result.data.length === 0) {
      stopReason = 'no_more_pages';
      pages++;
      break;
    }

    const pageIds = result.data.map(p => p.id);
    const existingIds = getExistingPostIds(pageIds);
    const pageNewPosts = result.data.filter(p => !existingIds.has(p.id));

    allPosts.push(...result.data);
    newPosts.push(...pageNewPosts);

    if (existingIds.size > 0) overlapDetected = true;

    upsertPosts(result.data, 'bookmark');
    pages++;

    if (!params.force_full_scan) {
      if (params.stop_on_overlap && existingIds.size > 0) {
        stopReason = 'overlap';
        break;
      }

      if (params.stop_before) {
        const oldest = getOldestTimestamp(result.data);
        if (oldest && oldest < params.stop_before) {
          stopReason = 'date_cutoff';
          break;
        }
      }
    }

    cursor = result.cursor;
    if (!result.has_more) {
      stopReason = 'no_more_pages';
      break;
    }
  }

  if (!stopReason && pages >= params.max_pages) {
    stopReason = 'max_pages';
  }

  // --- Reference expansion ---
  let referencedCandidates = 0;
  let referencedExisting = 0;
  let referencedFetched = 0;
  let referencedInserted = 0;
  let referencedFailed = 0;

  const candidateIds = collectReferencedIds(allPosts);
  referencedCandidates = candidateIds.length;

  if (candidateIds.length > 0) {
    const batchIds = new Set(allPosts.map(p => p.id));
    const afterBatchExclusion = candidateIds.filter(id => !batchIds.has(id));
    const existingRefIds = getExistingPostIds(afterBatchExclusion);

    referencedExisting = (candidateIds.length - afterBatchExclusion.length) + existingRefIds.size;
    const toHydrate = afterBatchExclusion.filter(id => !existingRefIds.has(id));

    for (let i = 0; i < toHydrate.length; i += 100) {
      const chunk = toHydrate.slice(i, i + 100);
      try {
        const fetched = await fetchPostsByIds(chunk);
        referencedFetched += fetched.length;
        referencedInserted += fetched.length;
        referencedFailed += chunk.length - fetched.length;
        if (fetched.length > 0) {
          upsertPosts(fetched, 'bookmark_ref');
        }
      } catch {
        referencedFailed += chunk.length;
      }
    }
  }

  // --- Auto-tag new bookmark posts only (deduplicated) ---
  const seenNewIds = new Set<string>();
  const uniqueNewPosts = newPosts.filter(p => {
    if (seenNewIds.has(p.id)) return false;
    seenNewIds.add(p.id);
    return true;
  });

  let tagsApplied = 0;

  if (params.auto_tag && uniqueNewPosts.length > 0) {
    const tagMap = await autoTagPosts(uniqueNewPosts);
    for (const [postId, postTags] of tagMap) {
      for (const t of postTags) {
        tagPost(postId, t);
        tagsApplied++;
      }
    }
  }

  if (params.tags?.length) {
    for (const post of allPosts) {
      for (const t of params.tags) {
        tagPost(post.id, t);
        tagsApplied++;
      }
    }
  }

  logSync('bookmarks', allPosts.length, cursor);

  const timestamps = allPosts.map(p => p.timestamp).filter(Boolean).sort();

  return {
    total_synced: allPosts.length,
    new_posts: uniqueNewPosts.length,
    tags_applied: tagsApplied,
    pages_fetched: pages,
    stop_reason: stopReason,
    overlap_detected: overlapDetected,
    cutoff_reached: stopReason === 'date_cutoff',
    first_synced_timestamp: timestamps[0],
    last_synced_timestamp: timestamps[timestamps.length - 1],
    referenced_candidates: referencedCandidates,
    referenced_existing: referencedExisting,
    referenced_fetched: referencedFetched,
    referenced_inserted: referencedInserted,
    referenced_failed: referencedFailed,
  };
}
