import { z } from 'zod';
import { hydrateArticleContent } from '../services/content-hydration.js';
import type { HydrationRunResult } from '../types.js';

export const hydrateArticlesSchema = {
  ids: z.array(z.string()).max(200).optional().describe('Optional explicit post IDs to hydrate'),
  limit: z.number().min(1).max(500).default(100).describe('Maximum rows to process in this run'),
  force: z.boolean().default(false).describe('Force content acceptance even if score is not higher'),
  dry_run: z.boolean().default(false).describe('Preview candidate rows without mutating data'),
  max_attempts: z.number().min(1).max(20).default(7).describe('Max retry attempts before marking missing'),
  backfill: z.boolean().default(false).describe('Use resumable checkpointed backfill mode'),
};

export async function hydrateArticles(params: {
  ids?: string[];
  limit: number;
  force: boolean;
  dry_run: boolean;
  max_attempts: number;
  backfill: boolean;
}): Promise<HydrationRunResult> {
  return hydrateArticleContent(params);
}
