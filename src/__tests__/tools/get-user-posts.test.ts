import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { XPost, PaginatedResponse } from '../../types.js';

const mockGetUserPosts = vi.fn();

vi.mock('../../clients/x-api.js', () => ({
  getUserPosts: (...args: any[]) => mockGetUserPosts(...args),
}));

import { getUserPosts } from '../../tools/get-user-posts.js';

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

describe('getUserPosts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates to getUserPosts API with handle and max_results', async () => {
    const response: PaginatedResponse<XPost> = {
      data: [makePost({ id: '1' }), makePost({ id: '2' })],
      has_more: false,
    };
    mockGetUserPosts.mockResolvedValue(response);

    const result = await getUserPosts({ handle: 'testuser', max_results: 20, include_replies: false });
    expect(mockGetUserPosts).toHaveBeenCalledWith('testuser', 20);
    expect(result.data).toHaveLength(2);
  });

  it('filters out replies when include_replies is false', async () => {
    const response: PaginatedResponse<XPost> = {
      data: [
        makePost({ id: '1' }),
        makePost({ id: '2', in_reply_to: '999' }),
        makePost({ id: '3' }),
      ],
      has_more: false,
    };
    mockGetUserPosts.mockResolvedValue(response);

    const result = await getUserPosts({ handle: 'user', max_results: 20, include_replies: false });
    expect(result.data).toHaveLength(2);
    expect(result.data.every(p => p.in_reply_to === undefined)).toBe(true);
  });

  it('includes replies when include_replies is true', async () => {
    const response: PaginatedResponse<XPost> = {
      data: [
        makePost({ id: '1' }),
        makePost({ id: '2', in_reply_to: '999' }),
      ],
      has_more: false,
    };
    mockGetUserPosts.mockResolvedValue(response);

    const result = await getUserPosts({ handle: 'user', max_results: 20, include_replies: true });
    expect(result.data).toHaveLength(2);
  });

  it('returns empty data when API returns empty', async () => {
    mockGetUserPosts.mockResolvedValue({ data: [], has_more: false });

    const result = await getUserPosts({ handle: 'empty_user', max_results: 10, include_replies: false });
    expect(result.data).toEqual([]);
    expect(result.has_more).toBe(false);
  });

  it('preserves cursor and has_more from API response', async () => {
    const response: PaginatedResponse<XPost> = {
      data: [makePost()],
      cursor: 'next-page',
      has_more: true,
    };
    mockGetUserPosts.mockResolvedValue(response);

    const result = await getUserPosts({ handle: 'user', max_results: 10, include_replies: true });
    expect(result.cursor).toBe('next-page');
    expect(result.has_more).toBe(true);
  });
});
