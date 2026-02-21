import { getPost, getPostsByIds } from '../clients/x-api.js';
import {
  getBackfillCheckpoint,
  getContentMetaById,
  getHydrationCandidates,
  markHydrationFailure,
  markHydrationFetching,
  updateBackfillCheckpoint,
  upsertPost,
  type HydrationCandidate,
} from '../db/index.js';
import type { ContentStatus, HydrationRunResult } from '../types.js';

const BACKFILL_JOB = 'article-content-v1';
const FETCH_BATCH_SIZE = 100;

type ClassifiedError = {
  code: string;
  retryable: boolean;
  message: string;
};

function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(`${createdAt}::${id}`).toString('base64url');
}

function decodeCursor(cursor?: string): { created_at: string; id: string } | undefined {
  if (!cursor) return undefined;
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const [created_at, id] = decoded.split('::');
    if (!created_at || !id) return undefined;
    return { created_at, id };
  } catch {
    return undefined;
  }
}

function classifyError(error: unknown): ClassifiedError {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (lower.includes('429') || lower.includes('rate limit')) {
    return { code: 'RATE_LIMITED', retryable: true, message };
  }

  if (lower.includes('timeout') || lower.includes('timed out') || lower.includes('network')) {
    return { code: 'TIMEOUT', retryable: true, message };
  }

  if (lower.includes('404') || lower.includes('not found') || lower.includes('deleted')) {
    return { code: 'NOT_FOUND', retryable: false, message };
  }

  if (lower.includes('403') || lower.includes('unauthorized') || lower.includes('protected')) {
    return { code: 'UNAUTHORIZED', retryable: false, message };
  }

  if (lower.includes('parse')) {
    return { code: 'PARSE_ERROR', retryable: true, message };
  }

  return { code: 'UNKNOWN', retryable: true, message };
}

function nextRetryAt(attemptCount: number): string {
  const hours = attemptCount <= 1 ? 1 : attemptCount === 2 ? 6 : attemptCount === 3 ? 24 : 24;
  return new Date(Date.now() + (hours * 60 * 60 * 1000)).toISOString();
}

async function fetchPostsWithFallback(ids: string[]): Promise<Map<string, Awaited<ReturnType<typeof getPost>>>> {
  const results = new Map<string, Awaited<ReturnType<typeof getPost>>>();
  if (ids.length === 0) return results;

  for (let idx = 0; idx < ids.length; idx += FETCH_BATCH_SIZE) {
    const batch = ids.slice(idx, idx + FETCH_BATCH_SIZE);
    try {
      const posts = await getPostsByIds(batch);
      for (const post of posts) {
        results.set(post.id, post);
      }
    } catch {
      // fallback below
    }
  }

  const missing = ids.filter((id) => !results.has(id));
  for (const id of missing) {
    try {
      const post = await getPost(id);
      results.set(id, post);
    } catch {
      // leave unresolved and let caller classify as missing
    }
  }

  return results;
}

function aggregate(rows: HydrationRunResult['rows'], dryRun: boolean, cursor?: string): HydrationRunResult {
  const result: HydrationRunResult = {
    processed: rows.length,
    hydrated: 0,
    partial: 0,
    failed: 0,
    missing: 0,
    skipped: 0,
    dry_run: dryRun,
    rows,
    backfill_cursor: cursor,
  };

  for (const row of rows) {
    if (row.new_status === 'hydrated') result.hydrated += 1;
    else if (row.new_status === 'partial') result.partial += 1;
    else if (row.new_status === 'failed') result.failed += 1;
    else if (row.new_status === 'missing') result.missing += 1;
    else if (row.new_status === row.old_status) result.skipped += 1;
  }

  return result;
}

function resolveCandidates(params: {
  ids?: string[];
  limit: number;
  force?: boolean;
  backfill?: boolean;
}): { candidates: HydrationCandidate[]; cursor?: { created_at: string; id: string } } {
  if (params.ids?.length) {
    return {
      candidates: getHydrationCandidates({ ids: params.ids, limit: params.limit, force: params.force }),
    };
  }

  let cursor: { created_at: string; id: string } | undefined;
  if (params.backfill) {
    const checkpoint = getBackfillCheckpoint(BACKFILL_JOB);
    if (checkpoint?.cursor_created_at && checkpoint?.cursor_id) {
      cursor = { created_at: checkpoint.cursor_created_at, id: checkpoint.cursor_id };
    }
  }

  return {
    candidates: getHydrationCandidates({ limit: params.limit, force: params.force, cursor }),
    cursor,
  };
}

export async function hydrateArticleContent(params: {
  ids?: string[];
  limit: number;
  force?: boolean;
  dry_run?: boolean;
  max_attempts?: number;
  backfill?: boolean;
}): Promise<HydrationRunResult> {
  const dryRun = params.dry_run ?? false;
  const force = params.force ?? false;
  const maxAttempts = params.max_attempts ?? 7;

  const { candidates } = resolveCandidates(params);
  if (candidates.length === 0) {
    return aggregate([], dryRun);
  }

  const rows: HydrationRunResult['rows'] = [];

  if (dryRun) {
    for (const candidate of candidates) {
      rows.push({
        id: candidate.id,
        old_status: candidate.content_status,
        new_status: candidate.content_status,
        content_version: candidate.content_version,
      });
    }
    return aggregate(rows, true);
  }

  const claimed = candidates.filter((candidate) => markHydrationFetching(candidate));
  const fetched = await fetchPostsWithFallback(claimed.map((candidate) => candidate.id));

  let backfillCursor: string | undefined;

  for (const candidate of claimed) {
    const fetchedPost = fetched.get(candidate.id);
    if (!fetchedPost) {
      const attempt = candidate.attempt_count + 1;
      const terminal = attempt >= maxAttempts;
      markHydrationFailure({
        id: candidate.id,
        expectedVersion: candidate.content_version,
        nextStatus: terminal ? 'missing' : 'failed',
        errorCode: terminal ? 'NOT_FOUND' : 'RETRY_MISSING',
        errorMessage: 'Unable to hydrate article content for post id',
        nextRetryAt: terminal ? null : nextRetryAt(attempt),
      });
      const nextStatus: ContentStatus = terminal ? 'missing' : 'failed';
      rows.push({
        id: candidate.id,
        old_status: candidate.content_status,
        new_status: nextStatus,
        content_version: candidate.content_version,
        error_code: terminal ? 'NOT_FOUND' : 'RETRY_MISSING',
      });
      continue;
    }

    try {
      const outcome = upsertPost(fetchedPost, 'hydration', {
        forceContent: force,
        expectedContentVersion: candidate.content_version,
      });

      const currentMeta = getContentMetaById(candidate.id);
      rows.push({
        id: candidate.id,
        old_status: candidate.content_status,
        new_status: currentMeta?.content_status ?? outcome.contentStatus,
        content_version: currentMeta?.content_version ?? outcome.contentVersion,
      });
    } catch (error) {
      const classified = classifyError(error);
      const attempt = candidate.attempt_count + 1;
      const terminal = !classified.retryable || attempt >= maxAttempts;

      markHydrationFailure({
        id: candidate.id,
        expectedVersion: candidate.content_version,
        nextStatus: terminal ? 'missing' : 'failed',
        errorCode: classified.code,
        errorMessage: classified.message,
        nextRetryAt: terminal ? null : nextRetryAt(attempt),
      });

      rows.push({
        id: candidate.id,
        old_status: candidate.content_status,
        new_status: terminal ? 'missing' : 'failed',
        content_version: candidate.content_version,
        error_code: classified.code,
      });
    }

    if (params.backfill) {
      backfillCursor = encodeCursor(candidate.created_at, candidate.id);
      updateBackfillCheckpoint({
        jobName: BACKFILL_JOB,
        cursorCreatedAt: candidate.created_at,
        cursorId: candidate.id,
        processedIncrement: 1,
      });
    }
  }

  const skipped = candidates.filter((candidate) => !claimed.some((row) => row.id === candidate.id));
  for (const candidate of skipped) {
    rows.push({
      id: candidate.id,
      old_status: candidate.content_status,
      new_status: candidate.content_status,
      content_version: candidate.content_version,
      error_code: 'CONCURRENT_UPDATE',
    });
  }

  return aggregate(rows, false, backfillCursor);
}

export function decodeBackfillCursor(cursor?: string): { created_at: string; id: string } | undefined {
  return decodeCursor(cursor);
}
