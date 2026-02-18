import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { XPost, PaginatedResponse } from '../../types.js';

const mockSearchRecent = vi.fn();

vi.mock('../../clients/x-api.js', () => ({
  searchRecent: (...args: any[]) => mockSearchRecent(...args),
}));

import { searchPostsRaw } from '../../tools/search-posts-raw.js';

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

describe('searchPostsRaw', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates to searchRecent and returns results', async () => {
    const response: PaginatedResponse<XPost> = {
      data: [makePost({ id: '1' }), makePost({ id: '2' })],
      has_more: false,
    };
    mockSearchRecent.mockResolvedValue(response);

    const result = await searchPostsRaw({ query: 'test', max_results: 20, mode: 'latest' });
    expect(result.data).toHaveLength(2);
    expect(result.has_more).toBe(false);
  });

  it('maps latest mode to recency sort order', async () => {
    mockSearchRecent.mockResolvedValue({ data: [], has_more: false });

    await searchPostsRaw({ query: 'test', max_results: 10, mode: 'latest' });
    expect(mockSearchRecent).toHaveBeenCalledWith('test', 10, 'recency');
  });

  it('maps top mode to relevancy sort order', async () => {
    mockSearchRecent.mockResolvedValue({ data: [], has_more: false });

    await searchPostsRaw({ query: 'test', max_results: 10, mode: 'top' });
    expect(mockSearchRecent).toHaveBeenCalledWith('test', 10, 'relevancy');
  });

  it('passes query and max_results through to searchRecent', async () => {
    mockSearchRecent.mockResolvedValue({ data: [], has_more: false });

    await searchPostsRaw({ query: 'from:elonmusk AI', max_results: 50, mode: 'latest' });
    expect(mockSearchRecent).toHaveBeenCalledWith('from:elonmusk AI', 50, 'recency');
  });

  it('returns cursor from searchRecent when present', async () => {
    const response: PaginatedResponse<XPost> = {
      data: [makePost()],
      cursor: 'next-token-abc',
      has_more: true,
    };
    mockSearchRecent.mockResolvedValue(response);

    const result = await searchPostsRaw({ query: 'test', max_results: 10, mode: 'latest' });
    expect(result.cursor).toBe('next-token-abc');
    expect(result.has_more).toBe(true);
  });
});
