import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { ensureSchema } from '../../db/schema.js';
import { setDb, resetDb, getPostById, upsertPost } from '../../db/index.js';
import type { XPost, PaginatedResponse } from '../../types.js';

vi.mock('../../clients/x-api.js', () => ({
  listBookmarks: vi.fn(),
  getPostsByIds: vi.fn(),
}));

vi.mock('../../db/tagger.js', () => ({
  autoTagPosts: vi.fn().mockResolvedValue(new Map()),
}));

import { syncBookmarks } from '../../tools/sync-bookmarks.js';
import { listBookmarks, getPostsByIds as fetchPostsByIds } from '../../clients/x-api.js';
import { autoTagPosts } from '../../db/tagger.js';

const mockListBookmarks = vi.mocked(listBookmarks);
const mockFetchPostsByIds = vi.mocked(fetchPostsByIds);
const mockAutoTagPosts = vi.mocked(autoTagPosts);

const makePost = (overrides: Partial<XPost> = {}): XPost => {
  const id = overrides.id ?? '123';
  return {
    id,
    text: 'Test post text',
    author: { handle: 'testuser', name: 'Test User', id: '456', verified: false },
    timestamp: '2025-01-15T00:00:00.000Z',
    metrics: { likes: 10, retweets: 5, replies: 2, views: 100, bookmarks: 1 },
    media: [],
    urls: [],
    hashtags: [],
    mentions: [],
    is_thread: false,
    source_url: `https://x.com/testuser/status/${id}`,
    ...overrides,
  };
};

function makePage(posts: XPost[], cursor?: string, hasMore = false): PaginatedResponse<XPost> {
  return { data: posts, cursor, has_more: hasMore };
}

const defaultParams = {
  max_pages: 5,
  auto_tag: false,
  stop_on_overlap: true,
  force_full_scan: false,
};

describe('syncBookmarks', () => {
  beforeEach(() => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    setDb(db);
    ensureSchema(db);
    vi.clearAllMocks();
    mockAutoTagPosts.mockResolvedValue(new Map());
    mockFetchPostsByIds.mockResolvedValue([]);
  });

  afterEach(() => {
    resetDb();
  });

  // --- Smart Stop: Overlap ---

  describe('smart stop - overlap detection', () => {
    it('stops on overlap after first overlapped page', async () => {
      upsertPost(makePost({ id: '100', text: 'Already synced' }), 'bookmark');

      mockListBookmarks.mockResolvedValueOnce(
        makePage([
          makePost({ id: '200', text: 'New post' }),
          makePost({ id: '100', text: 'Already synced' }),
        ], 'cursor-1', true),
      );

      const result = await syncBookmarks(defaultParams);

      expect(result.stop_reason).toBe('overlap');
      expect(result.overlap_detected).toBe(true);
      expect(result.pages_fetched).toBe(1);
      expect(result.total_synced).toBe(2);
      expect(result.new_posts).toBe(1);
      expect(mockListBookmarks).toHaveBeenCalledTimes(1);
    });

    it('continues when no overlap', async () => {
      mockListBookmarks
        .mockResolvedValueOnce(makePage([makePost({ id: '1' })], 'c1', true))
        .mockResolvedValueOnce(makePage([makePost({ id: '2' })], 'c2', true))
        .mockResolvedValueOnce(makePage([makePost({ id: '3' })]));

      const result = await syncBookmarks(defaultParams);

      expect(result.stop_reason).toBe('no_more_pages');
      expect(result.overlap_detected).toBe(false);
      expect(result.pages_fetched).toBe(3);
      expect(result.total_synced).toBe(3);
    });

    it('returns quickly when all posts on first page are known', async () => {
      upsertPost(makePost({ id: '1' }), 'bookmark');
      upsertPost(makePost({ id: '2' }), 'bookmark');

      mockListBookmarks.mockResolvedValueOnce(
        makePage([makePost({ id: '1' }), makePost({ id: '2' })], 'c1', true),
      );

      const result = await syncBookmarks(defaultParams);

      expect(result.stop_reason).toBe('overlap');
      expect(result.new_posts).toBe(0);
      expect(result.total_synced).toBe(2);
    });
  });

  // --- Smart Stop: Date Cutoff ---

  describe('smart stop - date cutoff', () => {
    it('stops when page crosses stop_before date', async () => {
      mockListBookmarks.mockResolvedValueOnce(
        makePage([
          makePost({ id: '1', timestamp: '2025-12-15T00:00:00.000Z' }),
          makePost({ id: '2', timestamp: '2025-11-01T00:00:00.000Z' }),
        ], 'c1', true),
      );

      const result = await syncBookmarks({
        ...defaultParams,
        stop_before: '2025-12-01T00:00:00Z',
      });

      expect(result.stop_reason).toBe('date_cutoff');
      expect(result.cutoff_reached).toBe(true);
      expect(result.pages_fetched).toBe(1);
      expect(result.total_synced).toBe(2);
    });

    it('does not stop when all posts are newer than cutoff', async () => {
      mockListBookmarks.mockResolvedValueOnce(
        makePage([
          makePost({ id: '1', timestamp: '2025-12-15T00:00:00.000Z' }),
          makePost({ id: '2', timestamp: '2025-12-10T00:00:00.000Z' }),
        ]),
      );

      const result = await syncBookmarks({
        ...defaultParams,
        stop_before: '2025-12-01T00:00:00Z',
      });

      expect(result.stop_reason).toBe('no_more_pages');
      expect(result.cutoff_reached).toBe(false);
    });
  });

  // --- Force Full Scan ---

  describe('force_full_scan', () => {
    it('ignores overlap and date stops', async () => {
      upsertPost(makePost({ id: '100' }), 'bookmark');

      mockListBookmarks
        .mockResolvedValueOnce(
          makePage([makePost({ id: '100', timestamp: '2025-10-01T00:00:00.000Z' })], 'c1', true),
        )
        .mockResolvedValueOnce(
          makePage([makePost({ id: '200', timestamp: '2025-09-01T00:00:00.000Z' })]),
        );

      const result = await syncBookmarks({
        ...defaultParams,
        stop_before: '2025-11-01T00:00:00Z',
        force_full_scan: true,
      });

      expect(result.stop_reason).toBe('no_more_pages');
      expect(result.pages_fetched).toBe(2);
      expect(result.total_synced).toBe(2);
    });
  });

  // --- Reference Expansion ---

  describe('reference expansion', () => {
    it('hydrates quoted tweet references', async () => {
      const quotedPost = makePost({ id: '999', text: 'Original quoted post' });

      mockListBookmarks.mockResolvedValueOnce(
        makePage([makePost({ id: '1', quoted_tweet_id: '999' })]),
      );
      mockFetchPostsByIds.mockResolvedValueOnce([quotedPost]);

      const result = await syncBookmarks(defaultParams);

      expect(result.referenced_candidates).toBe(1);
      expect(result.referenced_fetched).toBe(1);
      expect(result.referenced_inserted).toBe(1);
      expect(result.referenced_failed).toBe(0);
      expect(getPostById('999')).not.toBeNull();
    });

    it('hydrates article URL references', async () => {
      const refPost = makePost({ id: '555', text: 'Referenced post' });

      mockListBookmarks.mockResolvedValueOnce(
        makePage([makePost({
          id: '1',
          urls: ['https://x.com/someone/status/555'],
          article: { title: 'Article', text: 'Some text' },
        })]),
      );
      mockFetchPostsByIds.mockResolvedValueOnce([refPost]);

      const result = await syncBookmarks(defaultParams);

      expect(result.referenced_candidates).toBe(1);
      expect(result.referenced_fetched).toBe(1);
      expect(getPostById('555')).not.toBeNull();
    });

    it('does not re-fetch references already in DB', async () => {
      upsertPost(makePost({ id: '999', text: 'Already stored' }), 'manual');

      mockListBookmarks.mockResolvedValueOnce(
        makePage([makePost({ id: '1', quoted_tweet_id: '999' })]),
      );

      const result = await syncBookmarks(defaultParams);

      expect(result.referenced_candidates).toBe(1);
      expect(result.referenced_existing).toBe(1);
      expect(result.referenced_fetched).toBe(0);
      expect(mockFetchPostsByIds).not.toHaveBeenCalled();
    });

    it('deduplicates references across bookmarks', async () => {
      mockListBookmarks.mockResolvedValueOnce(
        makePage([
          makePost({ id: '1', quoted_tweet_id: '999' }),
          makePost({ id: '2', quoted_tweet_id: '999' }),
        ]),
      );
      mockFetchPostsByIds.mockResolvedValueOnce([makePost({ id: '999' })]);

      const result = await syncBookmarks(defaultParams);

      expect(result.referenced_candidates).toBe(1);
      expect(result.referenced_fetched).toBe(1);
      expect(mockFetchPostsByIds).toHaveBeenCalledTimes(1);
    });

    it('handles partial fetch failure gracefully', async () => {
      mockListBookmarks.mockResolvedValueOnce(
        makePage([
          makePost({ id: '1', quoted_tweet_id: '888' }),
          makePost({ id: '2', in_reply_to: '777' }),
        ]),
      );
      mockFetchPostsByIds.mockResolvedValueOnce([makePost({ id: '888' })]);

      const result = await syncBookmarks(defaultParams);

      expect(result.referenced_candidates).toBe(2);
      expect(result.referenced_fetched).toBe(1);
      expect(result.referenced_failed).toBe(1);
    });

    it('handles complete fetch failure without throwing', async () => {
      mockListBookmarks.mockResolvedValueOnce(
        makePage([makePost({ id: '1', quoted_tweet_id: '999' })]),
      );
      mockFetchPostsByIds.mockRejectedValueOnce(new Error('API down'));

      const result = await syncBookmarks(defaultParams);

      expect(result.referenced_candidates).toBe(1);
      expect(result.referenced_failed).toBe(1);
      expect(result.referenced_fetched).toBe(0);
      expect(result.total_synced).toBe(1);
    });
  });

  // --- Tagging ---

  describe('tagging behavior', () => {
    it('auto-tags only new bookmark posts, not hydrated refs', async () => {
      mockListBookmarks.mockResolvedValueOnce(
        makePage([makePost({ id: '1', quoted_tweet_id: '999' })]),
      );
      mockFetchPostsByIds.mockResolvedValueOnce([makePost({ id: '999' })]);
      mockAutoTagPosts.mockResolvedValueOnce(
        new Map([['1', ['solana-validator']]]),
      );

      await syncBookmarks({ ...defaultParams, auto_tag: true });

      expect(mockAutoTagPosts).toHaveBeenCalledTimes(1);
      const calledWith = mockAutoTagPosts.mock.calls[0][0];
      expect(calledWith).toHaveLength(1);
      expect(calledWith[0].id).toBe('1');
    });

    it('applies manual tags to all synced bookmark posts', async () => {
      mockListBookmarks.mockResolvedValueOnce(
        makePage([makePost({ id: '1' }), makePost({ id: '2' })]),
      );

      const result = await syncBookmarks({
        ...defaultParams,
        tags: ['my-tag'],
      });

      expect(result.tags_applied).toBe(2);
    });
  });

  // --- Counter / Response Shape ---

  describe('response counters', () => {
    it('returns correct stop_reason for max_pages', async () => {
      mockListBookmarks
        .mockResolvedValueOnce(makePage([makePost({ id: '1' })], 'c1', true))
        .mockResolvedValueOnce(makePage([makePost({ id: '2' })], 'c2', true));

      const result = await syncBookmarks({ ...defaultParams, max_pages: 2 });

      expect(result.stop_reason).toBe('max_pages');
      expect(result.pages_fetched).toBe(2);
    });

    it('returns timestamps in response', async () => {
      mockListBookmarks.mockResolvedValueOnce(
        makePage([
          makePost({ id: '1', timestamp: '2025-12-01T00:00:00.000Z' }),
          makePost({ id: '2', timestamp: '2025-12-15T00:00:00.000Z' }),
        ]),
      );

      const result = await syncBookmarks(defaultParams);

      expect(result.first_synced_timestamp).toBe('2025-12-01T00:00:00.000Z');
      expect(result.last_synced_timestamp).toBe('2025-12-15T00:00:00.000Z');
    });

    it('returns all zero reference counters when no refs found', async () => {
      mockListBookmarks.mockResolvedValueOnce(
        makePage([makePost({ id: '1' })]),
      );

      const result = await syncBookmarks(defaultParams);

      expect(result.referenced_candidates).toBe(0);
      expect(result.referenced_existing).toBe(0);
      expect(result.referenced_fetched).toBe(0);
      expect(result.referenced_inserted).toBe(0);
      expect(result.referenced_failed).toBe(0);
    });

    it('returns empty result for zero bookmarks', async () => {
      mockListBookmarks.mockResolvedValueOnce(makePage([]));

      const result = await syncBookmarks(defaultParams);

      expect(result.total_synced).toBe(0);
      expect(result.new_posts).toBe(0);
      expect(result.pages_fetched).toBe(1);
      expect(result.stop_reason).toBe('no_more_pages');
    });
  });
});
