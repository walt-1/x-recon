import { z } from 'zod';
import { getPostsByIds as fetchPostsByIds } from '../clients/x-api.js';
import { getPostById, upsertPosts, tagPosts } from '../db/index.js';
import { autoTagPosts } from '../db/tagger.js';
import { tagPost } from '../db/index.js';

export const ingestPostsSchema = {
  post_ids: z.array(z.string()).min(1).max(100).describe(
    'Post IDs to fetch from X API and store locally. Posts already in DB are skipped (no duplicate API cost).',
  ),
  tags: z.array(z.string()).optional().describe('Tags to apply to ingested posts'),
  auto_tag: z.boolean().default(true).describe('Auto-classify posts using Grok'),
  source: z.string().default('manual').describe('Source label for tracking'),
};

export async function ingestPosts(params: {
  post_ids: string[];
  tags?: string[];
  auto_tag: boolean;
  source: string;
}) {
  // Filter out posts already in DB
  const newIds = params.post_ids.filter(id => !getPostById(id));
  let fetched = 0;

  if (newIds.length > 0) {
    // Fetch from X API
    const posts = await fetchPostsByIds(newIds);
    fetched = posts.length;

    // Store locally
    upsertPosts(posts, params.source);

    // Auto-tag if requested
    let tagsApplied = 0;
    if (params.auto_tag && posts.length > 0) {
      const tagMap = await autoTagPosts(posts);
      for (const [postId, postTags] of tagMap) {
        for (const t of postTags) {
          tagPost(postId, t);
          tagsApplied++;
        }
      }
    }

    // Apply manual tags if provided
    if (params.tags?.length) {
      for (const t of params.tags) {
        tagPosts(posts.map(p => p.id), t);
        tagsApplied += posts.length;
      }
    }

    return {
      requested: params.post_ids.length,
      already_stored: params.post_ids.length - newIds.length,
      fetched,
      tags_applied: tagsApplied,
    };
  }

  return {
    requested: params.post_ids.length,
    already_stored: params.post_ids.length,
    fetched: 0,
    tags_applied: 0,
  };
}
