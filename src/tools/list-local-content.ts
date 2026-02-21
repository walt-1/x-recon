import { z } from 'zod';
import { listLocalContent as listLocalContentFromDb } from '../db/index.js';
import type { ContentStatus, LocalContentListResult } from '../types.js';

export const listLocalContentSchema = {
  limit: z.number().min(1).max(100).default(20).describe('Maximum rows to return per page'),
  cursor: z.string().optional().describe('Pagination cursor from previous response'),
  type: z.string().optional().describe('Optional post type filter (e.g. article, post)'),
  tag: z.string().optional().describe('Optional tag filter'),
  author: z.string().optional().describe('Optional author handle filter (without @)'),
  from_date: z.string().optional().describe('Optional ISO date lower bound for created_at'),
  to_date: z.string().optional().describe('Optional ISO date upper bound for created_at'),
  content_status: z.enum(['new', 'pending', 'fetching', 'hydrated', 'partial', 'failed', 'missing', 'stale']).optional()
    .describe('Optional content hydration status filter'),
  has_full_content: z.boolean().optional().describe('Only return rows with non-empty canonical content'),
  include_full_content: z.boolean().default(false).describe('Include full content text in each row'),
  snippet_chars: z.number().min(200).max(2000).default(800).describe('Snippet length in characters'),
  max_total_chars: z.number().min(2000).max(250000).default(80000)
    .describe('Hard cap for total returned content characters across all rows'),
};

export async function listLocalContent(params: {
  limit: number;
  cursor?: string;
  type?: string;
  tag?: string;
  author?: string;
  from_date?: string;
  to_date?: string;
  content_status?: ContentStatus;
  has_full_content?: boolean;
  include_full_content: boolean;
  snippet_chars: number;
  max_total_chars: number;
}): Promise<LocalContentListResult> {
  const result = listLocalContentFromDb(params);
  if (!params.include_full_content) return result;

  let remaining = params.max_total_chars;
  let truncated = false;
  for (const row of result.data) {
    const text = row.content_text ?? '';
    if (!text) continue;

    if (text.length <= remaining) {
      remaining -= text.length;
      continue;
    }

    row.content_text = remaining > 0 ? `${text.slice(0, remaining)}...` : '';
    truncated = true;
    remaining = 0;
  }

  if (truncated) {
    result.truncated = true;
  }

  return result;
}
