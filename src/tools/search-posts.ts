import { z } from 'zod';
import { searchX, extractCitations } from '../clients/grok.js';
import { extractTweetIds } from '../parsers/citation.js';
import { getPostsByIds } from '../clients/x-api.js';
import type { PaginatedResponse, XPost } from '../types.js';

export const searchPostsSchema = {
  query: z.string().describe('Natural language search query'),
  max_results: z.number().min(1).max(20).default(10).describe('Max posts to return'),
  from_date: z.string().optional().describe('ISO 8601 start date filter'),
  to_date: z.string().optional().describe('ISO 8601 end date filter'),
  handles: z.array(z.string()).max(10).optional().describe('Filter to these X handles (no @ prefix)'),
};

export async function searchPosts(params: {
  query: string;
  max_results: number;
  from_date?: string;
  to_date?: string;
  handles?: string[];
}): Promise<PaginatedResponse<XPost>> {
  // Step 1: Call Grok x_search
  const grokResponse = await searchX({
    query: params.query,
    handles: params.handles,
    from_date: params.from_date,
    to_date: params.to_date,
  });

  // Step 2: Extract tweet IDs from citation annotations
  const citations = extractCitations(grokResponse);
  const tweetIds = extractTweetIds(citations).slice(0, params.max_results);

  if (tweetIds.length === 0) {
    return { data: [], has_more: false };
  }

  // Step 3: Hydrate with X API v2
  const posts = await getPostsByIds(tweetIds);
  return { data: posts, has_more: false };
}
