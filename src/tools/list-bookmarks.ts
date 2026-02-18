import { z } from 'zod';
import { listBookmarks as listBookmarksApi } from '../clients/x-api.js';
import type { PaginatedResponse, XPost } from '../types.js';

export const listBookmarksSchema = {
  max_results: z.number().min(1).max(100).default(20),
  cursor: z.string().optional().describe('Pagination cursor from previous response'),
};

export async function listBookmarks(params: {
  max_results: number;
  cursor?: string;
}): Promise<PaginatedResponse<XPost>> {
  return listBookmarksApi(params.max_results, params.cursor);
}
