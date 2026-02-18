import { z } from 'zod';
import { getPostsByTag } from '../db/index.js';
import type { XPost } from '../types.js';

export const getPostsByTagSchema = {
  tag: z.string().describe('Tag to filter by (e.g. "solana-validator", "macro-analysis")'),
  limit: z.number().min(1).max(500).default(100).describe('Maximum posts to return'),
};

export async function getPostsByTagHandler(params: {
  tag: string;
  limit: number;
}): Promise<XPost[]> {
  return getPostsByTag(params.tag, params.limit);
}
