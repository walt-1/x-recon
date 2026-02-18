import { z } from 'zod';
import { searchPosts, searchPostsByTag } from '../db/index.js';
import type { XPost } from '../types.js';

export const searchLocalSchema = {
  query: z.string().describe('Full-text search query across stored posts (e.g. "firedancer validator performance")'),
  tag: z.string().optional().describe('Optional: narrow search to posts with this tag'),
  limit: z.number().min(1).max(200).default(50).describe('Maximum posts to return'),
};

export async function searchLocal(params: {
  query: string;
  tag?: string;
  limit: number;
}): Promise<XPost[]> {
  if (params.tag) {
    return searchPostsByTag(params.query, params.tag, params.limit);
  }
  return searchPosts(params.query, params.limit);
}
