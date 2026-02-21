import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

import { ensureSchema } from '../db/schema.js';
import {
  getBackfillCheckpoint,
  getDb,
  getHydrationCandidates,
  listLocalContent,
  markHydrationFailure,
  markHydrationFetching,
  resetDb,
  searchLocalContent,
  setDb,
  updateBackfillCheckpoint,
  upsertPost,
} from '../db/index.js';
import type { XPost } from '../types.js';

function makePost(overrides: Partial<XPost> = {}): XPost {
  return {
    id: '123',
    text: 'Test post text',
    author: { handle: 'testuser', name: 'Test User', id: '456', verified: false },
    timestamp: '2025-01-01T00:00:00.000Z',
    metrics: { likes: 10, retweets: 5, replies: 2, views: 100, bookmarks: 1 },
    media: [],
    urls: [],
    hashtags: [],
    mentions: [],
    is_thread: false,
    source_url: 'https://x.com/testuser/status/123',
    ...overrides,
  };
}

describe('db content hydration model', () => {
  beforeEach(() => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    setDb(db);
    ensureSchema(db);
  });

  afterEach(() => {
    resetDb();
  });

  it('classifies metadata-only article as pending with placeholder content', () => {
    const post = makePost({
      id: 'article-1',
      text: 'https://t.co/abc123',
      article: {
        title: 'Long-form article',
      },
    });
    upsertPost(post, 'bookmark');

    const row = getDb().prepare('SELECT type, content_status, article_title, content_text FROM posts WHERE id = ?').get('article-1') as {
      type: string;
      content_status: string;
      article_title: string | null;
      content_text: string | null;
    };

    expect(row.type).toBe('article');
    expect(row.content_status).toBe('pending');
    expect(row.article_title).toBe('Long-form article');
    expect(row.content_text).toBe('https://t.co/abc123');
  });

  it('keeps higher-quality hydrated content when lower-quality update arrives', () => {
    const hydrated = makePost({
      id: 'article-2',
      article: {
        title: 'Hydrated title',
        text: 'Full article body with substantial detail and arguments.',
      },
    });
    const first = upsertPost(hydrated, 'hydration', { forceContent: true });

    const placeholder = makePost({
      id: 'article-2',
      text: 'https://t.co/xyz789',
      article: {
        title: 'Hydrated title',
      },
    });
    const second = upsertPost(placeholder, 'bookmark');

    const row = getDb().prepare('SELECT content_text, content_status, content_version FROM posts WHERE id = ?').get('article-2') as {
      content_text: string;
      content_status: string;
      content_version: number;
    };

    expect(first.contentAccepted).toBe(true);
    expect(second.contentAccepted).toBe(false);
    expect(row.content_text).toContain('Full article body');
    expect(row.content_status).toBe('hydrated');
    expect(row.content_version).toBe(1);
  });

  it('enforces optimistic concurrency version check', () => {
    const post = makePost({ id: 'article-3', article: { title: 'A', text: 'A body' } });
    upsertPost(post, 'bookmark');

    const result = upsertPost(
      makePost({ id: 'article-3', article: { title: 'B', text: 'Updated body' } }),
      'hydration',
      { expectedContentVersion: 999, forceContent: true },
    );

    expect(result.contentAccepted).toBe(false);
    expect(result.skippedReason).toBe('version_mismatch');
  });

  it('supports hydration state transitions and retry metadata', () => {
    const post = makePost({
      id: 'article-4',
      text: 'https://t.co/hydrate',
      article: { title: 'Needs hydration' },
    });
    upsertPost(post, 'bookmark');

    const [candidate] = getHydrationCandidates({ limit: 10 });
    expect(candidate.id).toBe('article-4');
    expect(markHydrationFetching(candidate)).toBe(true);

    const failed = markHydrationFailure({
      id: candidate.id,
      expectedVersion: candidate.content_version,
      nextStatus: 'failed',
      errorCode: 'RATE_LIMITED',
      errorMessage: 'Rate limited',
      nextRetryAt: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(failed).toBe(true);

    const row = getDb().prepare('SELECT content_status, error_code, attempt_count FROM posts WHERE id = ?').get(candidate.id) as {
      content_status: string;
      error_code: string | null;
      attempt_count: number;
    };

    expect(row.content_status).toBe('failed');
    expect(row.error_code).toBe('RATE_LIMITED');
    expect(row.attempt_count).toBe(1);
  });

  it('lists/searches canonical local content and persists backfill checkpoints', () => {
    upsertPost(makePost({ id: 'a1', article: { title: 'Alpha', text: 'Solana article body content' } }), 'bookmark');
    upsertPost(makePost({ id: 'a2', text: 'https://t.co/placeholder', article: { title: 'Beta' } }), 'bookmark');

    const listed = listLocalContent({ limit: 10, include_full_content: false, snippet_chars: 400 });
    expect(listed.data.length).toBe(2);
    expect(listed.data[0].snippet.length).toBeGreaterThan(0);

    const searched = searchLocalContent({
      query: 'Solana article',
      limit: 10,
      include_full_content: true,
      snippet_chars: 400,
    });
    expect(searched.data.length).toBe(1);
    expect(searched.data[0].content_text).toContain('Solana article body content');

    updateBackfillCheckpoint({
      jobName: 'article-content-v1',
      cursorCreatedAt: '2025-01-01T00:00:00.000Z',
      cursorId: 'a2',
      processedIncrement: 2,
    });

    const checkpoint = getBackfillCheckpoint('article-content-v1');
    expect(checkpoint?.cursor_id).toBe('a2');
    expect(checkpoint?.processed_count).toBe(2);
  });
});
