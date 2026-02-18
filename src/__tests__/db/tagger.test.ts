import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { XPost } from '../../types.js';

vi.mock('../../config.js', () => ({
  loadConfig: () => ({
    XAI_API_KEY: 'test-xai-key',
    X_API_BEARER_TOKEN: 'test-bearer',
    GROK_MODEL: 'grok-test-model',
    GROK_TAGGING_MODEL: 'grok-3-mini',
    LOG_LEVEL: 'info',
  }),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { autoTagPosts, TAG_TAXONOMY } from '../../db/tagger.js';

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

function mockGrokOk(body: Record<string, string[]>) {
  mockFetch.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({
      choices: [{
        message: {
          content: JSON.stringify(body),
        },
      }],
    }),
  });
}

function mockGrokError(status: number, text: string) {
  mockFetch.mockResolvedValue({
    ok: false,
    status,
    text: () => Promise.resolve(text),
  });
}

describe('autoTagPosts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns correct Map when Grok responds with valid JSON', async () => {
    mockGrokOk({ '123': ['solana-validator', 'infrastructure'] });

    const post = makePost();
    const result = await autoTagPosts([post]);

    expect(result).toBeInstanceOf(Map);
    expect(result.get('123')).toEqual(['solana-validator', 'infrastructure']);
  });

  it('filters out invalid tags not in TAG_TAXONOMY', async () => {
    mockGrokOk({
      '123': ['solana-validator', 'invalid-tag', 'made-up-category'],
    });

    const post = makePost();
    const result = await autoTagPosts([post]);

    expect(result.get('123')).toEqual(['solana-validator']);
    // Invalid tags should be filtered out
    expect(result.get('123')).not.toContain('invalid-tag');
    expect(result.get('123')).not.toContain('made-up-category');
  });

  it('omits post from results when all tags are invalid', async () => {
    mockGrokOk({
      '123': ['completely-fake', 'not-real'],
    });

    const post = makePost();
    const result = await autoTagPosts([post]);

    // Post 123 should not be in the map since no valid tags remain
    expect(result.has('123')).toBe(false);
  });

  it('returns empty map for empty post array', async () => {
    const result = await autoTagPosts([]);

    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
    // Should not call fetch at all
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns empty map when Grok API fails (graceful fallback)', async () => {
    mockGrokError(500, 'Internal server error');

    const post = makePost();
    const result = await autoTagPosts([post]);

    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
  });

  it('chunks posts exceeding BATCH_SIZE (20) into multiple Grok calls', async () => {
    // Create 25 posts (should result in 2 batches: 20 + 5)
    const posts: XPost[] = [];
    const expectedTags: Record<string, string[]> = {};
    for (let i = 1; i <= 25; i++) {
      posts.push(makePost({ id: String(i), text: `Post number ${i}` }));
      expectedTags[String(i)] = ['trading'];
    }

    // Each call should return tags for its batch
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => {
          const batch1: Record<string, string[]> = {};
          for (let i = 1; i <= 20; i++) batch1[String(i)] = ['trading'];
          return Promise.resolve({
            choices: [{ message: { content: JSON.stringify(batch1) } }],
          });
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => {
          const batch2: Record<string, string[]> = {};
          for (let i = 21; i <= 25; i++) batch2[String(i)] = ['trading'];
          return Promise.resolve({
            choices: [{ message: { content: JSON.stringify(batch2) } }],
          });
        },
      });

    const result = await autoTagPosts(posts);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.size).toBe(25);
    for (let i = 1; i <= 25; i++) {
      expect(result.get(String(i))).toEqual(['trading']);
    }
  });

  it('sends request to the correct Grok endpoint', async () => {
    mockGrokOk({ '123': ['solana-validator'] });

    const post = makePost();
    await autoTagPosts([post]);

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.x.ai/v1/chat/completions',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('includes Authorization header with API key', async () => {
    mockGrokOk({ '123': ['solana-validator'] });

    const post = makePost();
    await autoTagPosts([post]);

    const [, options] = mockFetch.mock.calls[0];
    const headers = options.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer test-xai-key');
  });

  it('uses the configured GROK_TAGGING_MODEL', async () => {
    mockGrokOk({ '123': ['solana-validator'] });

    const post = makePost();
    await autoTagPosts([post]);

    const [, options] = mockFetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.model).toBe('grok-3-mini');
  });

  it('includes all TAG_TAXONOMY values in the prompt', async () => {
    mockGrokOk({ '123': ['solana-validator'] });

    const post = makePost();
    await autoTagPosts([post]);

    const [, options] = mockFetch.mock.calls[0];
    const body = JSON.parse(options.body);
    const promptContent = body.messages[0].content;

    for (const tag of TAG_TAXONOMY) {
      expect(promptContent).toContain(tag);
    }
  });
});
