import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { ensureSchema } from '../db/schema.js';
import {
  setDb,
  resetDb,
  upsertPost,
  upsertPosts,
  getPostById,
  getPostsByIds,
  tagPost,
  tagPosts,
  untagPost,
  getPostsByTag,
  searchPosts,
  searchPostsByTag,
  getAllTags,
  getTotalPostCount,
  logSync,
  getLastSync,
} from '../db/index.js';
import type { XPost } from '../types.js';

const makePost = (overrides: Partial<XPost> = {}): XPost => ({
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
});

describe('db', () => {
  beforeEach(() => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    setDb(db);
    ensureSchema(db);
  });

  afterEach(() => {
    resetDb();
  });

  // --- upsertPost + getPostById roundtrip ---

  describe('upsertPost + getPostById', () => {
    it('stores and retrieves a post with correct XPost shape via raw_json', () => {
      const post = makePost();
      upsertPost(post, 'test');

      const retrieved = getPostById('123');
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe('123');
      expect(retrieved!.text).toBe('Test post text');
      expect(retrieved!.author.handle).toBe('testuser');
      expect(retrieved!.author.name).toBe('Test User');
      expect(retrieved!.author.id).toBe('456');
      expect(retrieved!.author.verified).toBe(false);
      expect(retrieved!.timestamp).toBe('2025-01-01T00:00:00.000Z');
      expect(retrieved!.metrics).toEqual({ likes: 10, retweets: 5, replies: 2, views: 100, bookmarks: 1 });
      expect(retrieved!.media).toEqual([]);
      expect(retrieved!.urls).toEqual([]);
      expect(retrieved!.hashtags).toEqual([]);
      expect(retrieved!.mentions).toEqual([]);
      expect(retrieved!.is_thread).toBe(false);
      expect(retrieved!.source_url).toBe('https://x.com/testuser/status/123');
    });

    it('returns null for non-existent post', () => {
      expect(getPostById('nonexistent')).toBeNull();
    });
  });

  // --- upsertPost idempotency ---

  describe('upsertPost idempotency', () => {
    it('does not duplicate when the same ID is inserted twice', () => {
      const post = makePost();
      upsertPost(post, 'test');
      upsertPost(post, 'test');

      expect(getTotalPostCount()).toBe(1);
    });

    it('updates the post on second write with same ID', () => {
      const post = makePost();
      upsertPost(post, 'test');

      const updated = makePost({ text: 'Updated text' });
      upsertPost(updated, 'test');

      const retrieved = getPostById('123');
      expect(retrieved!.text).toBe('Updated text');
      expect(getTotalPostCount()).toBe(1);
    });
  });

  // --- upsertPosts batch ---

  describe('upsertPosts', () => {
    it('batch inserts multiple posts in a transaction', () => {
      const posts = [
        makePost({ id: '1', text: 'First post' }),
        makePost({ id: '2', text: 'Second post' }),
        makePost({ id: '3', text: 'Third post' }),
      ];
      upsertPosts(posts, 'batch-test');

      expect(getTotalPostCount()).toBe(3);
      expect(getPostById('1')!.text).toBe('First post');
      expect(getPostById('2')!.text).toBe('Second post');
      expect(getPostById('3')!.text).toBe('Third post');
    });
  });

  // --- tagPost + getPostsByTag ---

  describe('tagPost + getPostsByTag', () => {
    it('tags a post and retrieves it by tag', () => {
      const post = makePost();
      upsertPost(post, 'test');
      tagPost('123', 'solana-validator');

      const results = getPostsByTag('solana-validator');
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('123');
    });

    it('returns empty array for non-existent tag', () => {
      const post = makePost();
      upsertPost(post, 'test');

      const results = getPostsByTag('nonexistent');
      expect(results).toHaveLength(0);
    });
  });

  // --- tagPosts batch ---

  describe('tagPosts', () => {
    it('batch tags multiple posts', () => {
      const posts = [
        makePost({ id: '1', text: 'Post one' }),
        makePost({ id: '2', text: 'Post two' }),
        makePost({ id: '3', text: 'Post three' }),
      ];
      upsertPosts(posts, 'test');

      tagPosts(['1', '2', '3'], 'infrastructure');

      const results = getPostsByTag('infrastructure');
      expect(results).toHaveLength(3);
      const ids = results.map(r => r.id).sort();
      expect(ids).toEqual(['1', '2', '3']);
    });
  });

  // --- untagPost ---

  describe('untagPost', () => {
    it('removes a tag from a post', () => {
      const post = makePost();
      upsertPost(post, 'test');
      tagPost('123', 'solana-validator');

      // Verify tag exists
      expect(getPostsByTag('solana-validator')).toHaveLength(1);

      untagPost('123', 'solana-validator');

      // Verify tag is removed
      expect(getPostsByTag('solana-validator')).toHaveLength(0);
    });

    it('does not error when removing a non-existent tag', () => {
      const post = makePost();
      upsertPost(post, 'test');

      // Should not throw
      expect(() => untagPost('123', 'nonexistent')).not.toThrow();
    });
  });

  // --- FTS searchPosts ---

  describe('searchPosts', () => {
    it('matches only the relevant post via full-text search', () => {
      const posts = [
        makePost({ id: '1', text: 'Solana validator performance metrics', author: { handle: 'sol_dev', name: 'Sol Dev', id: '100', verified: false } }),
        makePost({ id: '2', text: 'Ethereum gas optimization tips', author: { handle: 'eth_dev', name: 'Eth Dev', id: '101', verified: false } }),
        makePost({ id: '3', text: 'Bitcoin lightning network scaling', author: { handle: 'btc_dev', name: 'BTC Dev', id: '102', verified: false } }),
      ];
      upsertPosts(posts, 'test');

      const results = searchPosts('Solana validator');
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('1');
    });

    it('returns empty array when no posts match', () => {
      const post = makePost({ text: 'Completely unrelated content' });
      upsertPost(post, 'test');

      const results = searchPosts('nonexistent topic query');
      expect(results).toHaveLength(0);
    });
  });

  // --- searchPostsByTag ---

  describe('searchPostsByTag', () => {
    it('FTS filtered by tag returns only matching posts', () => {
      const posts = [
        makePost({ id: '1', text: 'Solana validator node setup guide' }),
        makePost({ id: '2', text: 'Solana DeFi yield farming strategies' }),
        makePost({ id: '3', text: 'Ethereum smart contract audit' }),
      ];
      upsertPosts(posts, 'test');

      tagPost('1', 'infrastructure');
      tagPost('2', 'defi-general');

      // Both posts 1 and 2 contain "Solana" but only post 1 has the 'infrastructure' tag
      const results = searchPostsByTag('Solana', 'infrastructure');
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('1');
    });
  });

  // --- getAllTags ---

  describe('getAllTags', () => {
    it('returns correct tag counts', () => {
      const posts = [
        makePost({ id: '1', text: 'Post one' }),
        makePost({ id: '2', text: 'Post two' }),
        makePost({ id: '3', text: 'Post three' }),
      ];
      upsertPosts(posts, 'test');

      tagPost('1', 'solana-validator');
      tagPost('2', 'solana-validator');
      tagPost('3', 'solana-validator');
      tagPost('1', 'infrastructure');
      tagPost('2', 'infrastructure');

      const tags = getAllTags();
      expect(tags).toHaveLength(2);

      const solanaTag = tags.find(t => t.tag === 'solana-validator');
      expect(solanaTag).toBeDefined();
      expect(solanaTag!.count).toBe(3);

      const infraTag = tags.find(t => t.tag === 'infrastructure');
      expect(infraTag).toBeDefined();
      expect(infraTag!.count).toBe(2);
    });

    it('returns empty array when no tags exist', () => {
      expect(getAllTags()).toHaveLength(0);
    });
  });

  // --- getTotalPostCount ---

  describe('getTotalPostCount', () => {
    it('returns correct count', () => {
      expect(getTotalPostCount()).toBe(0);

      upsertPost(makePost({ id: '1' }), 'test');
      expect(getTotalPostCount()).toBe(1);

      upsertPost(makePost({ id: '2' }), 'test');
      expect(getTotalPostCount()).toBe(2);
    });
  });

  // --- getPostsByIds ---

  describe('getPostsByIds', () => {
    it('returns posts for given IDs', () => {
      const posts = [
        makePost({ id: '1', text: 'First' }),
        makePost({ id: '2', text: 'Second' }),
        makePost({ id: '3', text: 'Third' }),
      ];
      upsertPosts(posts, 'test');

      const results = getPostsByIds(['1', '3']);
      expect(results).toHaveLength(2);
      const ids = results.map(r => r.id).sort();
      expect(ids).toEqual(['1', '3']);
    });

    it('returns empty array for empty input', () => {
      expect(getPostsByIds([])).toEqual([]);
    });

    it('skips non-existent IDs', () => {
      upsertPost(makePost({ id: '1' }), 'test');

      const results = getPostsByIds(['1', 'nonexistent']);
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('1');
    });
  });

  // --- logSync + getLastSync ---

  describe('logSync + getLastSync', () => {
    it('stores and retrieves sync log entries', () => {
      logSync('bookmarks', 50, 'cursor-abc');

      const last = getLastSync('bookmarks');
      expect(last).not.toBeNull();
      expect(last!.cursor).toBe('cursor-abc');
      expect(last!.completed_at).toBeDefined();
    });

    it('returns null for non-existent sync type', () => {
      expect(getLastSync('nonexistent')).toBeNull();
    });

    it('returns the most recent sync entry', () => {
      logSync('bookmarks', 10, 'cursor-1');
      logSync('bookmarks', 20, 'cursor-2');

      const last = getLastSync('bookmarks');
      expect(last!.cursor).toBe('cursor-2');
    });

    it('handles sync without cursor', () => {
      logSync('search', 5);

      const last = getLastSync('search');
      expect(last).not.toBeNull();
      expect(last!.cursor).toBeUndefined();
    });
  });
});
