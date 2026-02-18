import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { XPost } from '../../types.js';

const mockGetPost = vi.fn();

vi.mock('../../clients/x-api.js', () => ({
  getPost: (...args: any[]) => mockGetPost(...args),
}));

vi.mock('../../parsers/citation.js', async () => {
  const actual = await vi.importActual('../../parsers/citation.js');
  return actual;
});

import { getPost } from '../../tools/get-post.js';

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

describe('getPost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches a post by numeric ID', async () => {
    mockGetPost.mockResolvedValue(makePost({ id: '12345', text: 'Hello' }));

    const result = await getPost({ post: '12345' });
    expect(mockGetPost).toHaveBeenCalledWith('12345');
    expect(result.id).toBe('12345');
    expect(result.text).toBe('Hello');
  });

  it('extracts ID from x.com URL', async () => {
    mockGetPost.mockResolvedValue(makePost({ id: '67890' }));

    await getPost({ post: 'https://x.com/user/status/67890' });
    expect(mockGetPost).toHaveBeenCalledWith('67890');
  });

  it('extracts ID from twitter.com URL', async () => {
    mockGetPost.mockResolvedValue(makePost({ id: '67890' }));

    await getPost({ post: 'https://twitter.com/user/status/67890' });
    expect(mockGetPost).toHaveBeenCalledWith('67890');
  });

  it('throws when getPost rejects (post not found)', async () => {
    mockGetPost.mockRejectedValue(new Error('Post 99999 not found'));

    await expect(getPost({ post: '99999' })).rejects.toThrow('Post 99999 not found');
  });

  it('throws on invalid input (no tweet ID extractable)', async () => {
    await expect(getPost({ post: 'https://x.com/articles/something' }))
      .rejects.toThrow('Cannot extract tweet ID');
  });
});
