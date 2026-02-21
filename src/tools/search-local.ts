import { z } from 'zod';
import { searchLocalContent } from '../db/index.js';
import type { ContentStatus, LocalContentListResult } from '../types.js';

export const searchLocalSchema = {
  query: z.string().describe('Full-text search query across stored posts (e.g. "firedancer validator performance")'),
  tag: z.string().optional().describe('Optional: narrow search to posts with this tag'),
  limit: z.number().min(1).max(100).default(20).describe('Maximum posts to return'),
  content_status: z.enum(['new', 'pending', 'fetching', 'hydrated', 'partial', 'failed', 'missing', 'stale']).optional()
    .describe('Optional: restrict search to rows with this content hydration status'),
  include_full_content: z.boolean().default(false)
    .describe('Include full content text. Defaults to false for token-safe responses'),
  snippet_chars: z.number().min(200).max(2000).default(800).describe('Snippet length in characters'),
  max_total_chars: z.number().min(2000).max(250000).default(80000)
    .describe('Hard cap for total returned content characters across all rows'),
};

export async function searchLocal(params: {
  query: string;
  tag?: string;
  limit: number;
  content_status?: ContentStatus;
  include_full_content: boolean;
  snippet_chars: number;
  max_total_chars: number;
}): Promise<LocalContentListResult> {
  const result = searchLocalContent({
    query: params.query,
    tag: params.tag,
    limit: params.limit,
    content_status: params.content_status,
    include_full_content: params.include_full_content,
    snippet_chars: params.snippet_chars,
  });

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
