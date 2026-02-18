import { z } from 'zod';
import { getUserPosts as getUserPostsApi } from '../clients/x-api.js';
import type { PaginatedResponse, XPost } from '../types.js';

export const getUserPostsSchema = {
  handle: z.string().describe('X handle without @ prefix'),
  max_results: z.number().min(1).max(100).default(20),
  include_replies: z.boolean().default(false).describe('Include reply tweets'),
};

export async function getUserPosts(params: {
  handle: string;
  max_results: number;
  include_replies: boolean;
}): Promise<PaginatedResponse<XPost>> {
  const result = await getUserPostsApi(params.handle, params.max_results);

  if (!params.include_replies) {
    result.data = result.data.filter(post => !post.in_reply_to);
  }

  return result;
}
