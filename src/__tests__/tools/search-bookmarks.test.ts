import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { XPost, PaginatedResponse } from '../../types.js';

const mockListBookmarks = vi.fn();

vi.mock('../../clients/x-api.js', () => ({
  listBookmarks: (...args: any[]) => mockListBookmarks(...args),
}));

import { searchBookmarks } from '../../tools/search-bookmarks.js';

function makePost(overrides: Partial<XPost> = {}): XPost {
  return {
    id: '1234567890',
    text: 'Test post',
    author: { handle: 'testuser', name: 'Test User', id: '987', verified: false },
    timestamp: '2025-01-15T12:00:00.000Z',
    metrics: { likes: 10, retweets: 5, replies: 2, views: 100, bookmarks: 1 },
    media: [],
    urls: [],
    hashtags: [],
    mentions: [],
    is_thread: false,
    source_url: 'https://x.com/testuser/status/1234567890',
    ...overrides,
  };
}

describe('searchBookmarks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws OAuth not configured error from listBookmarks', async () => {
    mockListBookmarks.mockRejectedValue(new Error(
      'Bookmarks require OAuth 2.0 user authentication (not yet configured). ' +
      'Set X_API_CLIENT_ID and X_API_CLIENT_SECRET to enable this feature.',
    ));

    await expect(searchBookmarks({ query: 'DeFi', max_results: 20 }))
      .rejects.toThrow('OAuth 2.0 user authentication');
  });

  it('calls listBookmarks with max_results and cursor', async () => {
    mockListBookmarks.mockRejectedValue(new Error('OAuth'));

    await expect(searchBookmarks({ query: 'test', max_results: 10, cursor: 'cur-123' }))
      .rejects.toThrow();
    expect(mockListBookmarks).toHaveBeenCalledWith(10, 'cur-123');
  });

  it('filters bookmarks by query when listBookmarks succeeds', async () => {
    const response: PaginatedResponse<XPost> = {
      data: [
        makePost({ id: '1', text: 'Great DeFi protocol analysis' }),
        makePost({ id: '2', text: 'Something about NFTs' }),
        makePost({ id: '3', text: 'DeFi yield farming strategies' }),
      ],
      has_more: false,
    };
    mockListBookmarks.mockResolvedValue(response);

    const result = await searchBookmarks({ query: 'DeFi', max_results: 20 });
    expect(result.data).toHaveLength(2);
    expect(result.data[0].id).toBe('1');
    expect(result.data[1].id).toBe('3');
  });

  it('performs case-insensitive query filtering', async () => {
    const response: PaginatedResponse<XPost> = {
      data: [
        makePost({ id: '1', text: 'TYPESCRIPT is great' }),
        makePost({ id: '2', text: 'I love typescript' }),
        makePost({ id: '3', text: 'No match here' }),
      ],
      has_more: false,
    };
    mockListBookmarks.mockResolvedValue(response);

    const result = await searchBookmarks({ query: 'TypeScript', max_results: 20 });
    expect(result.data).toHaveLength(2);
  });
});
