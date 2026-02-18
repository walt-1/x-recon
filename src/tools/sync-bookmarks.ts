import { z } from 'zod';
import { listBookmarks } from '../clients/x-api.js';
import { upsertPosts, getPostById, tagPost, logSync } from '../db/index.js';
import { autoTagPosts } from '../db/tagger.js';
import type { SyncResult } from '../types.js';

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
};

export async function syncBookmarks(params: {
  max_pages: number;
  auto_tag: boolean;
  tags?: string[];
}): Promise<SyncResult> {
  const allPosts = [];
  let cursor: string | undefined;
  let pages = 0;

  // Paginate through bookmarks
  while (pages < params.max_pages) {
    const result = await listBookmarks(20, cursor);
    allPosts.push(...result.data);
    pages++;
    cursor = result.cursor;
    if (!result.has_more) break;
  }

  if (allPosts.length === 0) {
    return { total_synced: 0, new_posts: 0, tags_applied: 0, pages_fetched: pages };
  }

  // Identify new posts (not already in DB)
  const newPosts = allPosts.filter(p => !getPostById(p.id));

  // Store all (upsert is idempotent)
  upsertPosts(allPosts, 'bookmark');

  // Auto-tag new posts
  let tagsApplied = 0;
  if (params.auto_tag && newPosts.length > 0) {
    const tagMap = await autoTagPosts(newPosts);
    for (const [postId, postTags] of tagMap) {
      for (const t of postTags) {
        tagPost(postId, t);
        tagsApplied++;
      }
    }
  }

  // Apply manual tags to all synced posts
  if (params.tags?.length) {
    for (const post of allPosts) {
      for (const t of params.tags) {
        tagPost(post.id, t);
        tagsApplied++;
      }
    }
  }

  // Log sync
  logSync('bookmarks', allPosts.length, cursor);

  return {
    total_synced: allPosts.length,
    new_posts: newPosts.length,
    tags_applied: tagsApplied,
    pages_fetched: pages,
  };
}
