import { z } from 'zod';
import { listBookmarks } from '../clients/x-api.js';
import type { PaginatedResponse, XPost } from '../types.js';

export const searchBookmarksSchema = {
  query: z.string().describe('Keyword to search within bookmarks'),
  max_results: z.number().min(1).max(100).default(20),
  cursor: z.string().optional().describe('Pagination cursor from previous response'),
};

export async function searchBookmarks(params: {
  query: string;
  max_results: number;
  cursor?: string;
}): Promise<PaginatedResponse<XPost>> {
  // Bookmarks require OAuth 2.0 — listBookmarks will throw with a clear message
  const result = await listBookmarks(params.max_results, params.cursor);

  // Client-side filter by query
  const queryLower = params.query.toLowerCase();
  result.data = result.data.filter(post =>
    post.text.toLowerCase().includes(queryLower),
  );

  return result;
}
