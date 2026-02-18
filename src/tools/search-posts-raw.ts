import { z } from 'zod';
import { searchRecent } from '../clients/x-api.js';
import type { PaginatedResponse, XPost } from '../types.js';

export const searchPostsRawSchema = {
  query: z.string().describe('Search query (supports Twitter search operators: from:, to:, #, exact phrases in quotes)'),
  max_results: z.number().min(1).max(50).default(20),
  mode: z.enum(['latest', 'top']).default('latest').describe('Sort by recency or engagement'),
};

export async function searchPostsRaw(params: {
  query: string;
  max_results: number;
  mode: 'latest' | 'top';
}): Promise<PaginatedResponse<XPost>> {
  const sortOrder = params.mode === 'top' ? 'relevancy' : 'recency';
  return searchRecent(params.query, params.max_results, sortOrder);
}
