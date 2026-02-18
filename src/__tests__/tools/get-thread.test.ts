import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { XPost } from '../../types.js';

const mockGetPost = vi.fn();
const mockGetThread = vi.fn();

vi.mock('../../clients/x-api.js', () => ({
  getPost: (...args: any[]) => mockGetPost(...args),
  getThread: (...args: any[]) => mockGetThread(...args),
}));

vi.mock('../../parsers/citation.js', async () => {
  const actual = await vi.importActual('../../parsers/citation.js');
  return actual;
});

import { getThread } from '../../tools/get-thread.js';

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

describe('getThread', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches initial tweet to get conversation_id, then calls getThread', async () => {
    const initialPost = makePost({ id: '1', thread_id: 'conv1', author: { handle: 'user', name: 'User', id: '1', verified: false } });
    mockGetPost.mockResolvedValue(initialPost);
    mockGetThread.mockResolvedValue([
      makePost({ id: '2', author: { handle: 'user', name: 'User', id: '1', verified: false } }),
      makePost({ id: '3', author: { handle: 'user', name: 'User', id: '1', verified: false } }),
    ]);

    const result = await getThread({ post: '1', include_replies: false });
    expect(mockGetPost).toHaveBeenCalledWith('1');
    expect(mockGetThread).toHaveBeenCalledWith('conv1');
    expect(result.data).toHaveLength(2);
    expect(result.has_more).toBe(false);
  });

  it('uses tweet ID as conversation_id when thread_id is undefined', async () => {
    const initialPost = makePost({ id: '1', thread_id: undefined });
    mockGetPost.mockResolvedValue(initialPost);
    mockGetThread.mockResolvedValue([]);

    await getThread({ post: '1', include_replies: false });
    expect(mockGetThread).toHaveBeenCalledWith('1');
  });

  it('extracts ID from URL', async () => {
    const initialPost = makePost({ id: '67890' });
    mockGetPost.mockResolvedValue(initialPost);
    mockGetThread.mockResolvedValue([]);

    await getThread({ post: 'https://x.com/user/status/67890', include_replies: false });
    expect(mockGetPost).toHaveBeenCalledWith('67890');
  });

  it('filters to thread author when include_replies is false', async () => {
    const initialPost = makePost({
      id: '1',
      thread_id: 'conv1',
      author: { handle: 'author', name: 'Author', id: '1', verified: false },
    });
    mockGetPost.mockResolvedValue(initialPost);
    mockGetThread.mockResolvedValue([
      makePost({ id: '2', author: { handle: 'author', name: 'Author', id: '1', verified: false } }),
      makePost({ id: '3', author: { handle: 'other_user', name: 'Other', id: '2', verified: false } }),
      makePost({ id: '4', author: { handle: 'author', name: 'Author', id: '1', verified: false } }),
    ]);

    const result = await getThread({ post: '1', include_replies: false });
    expect(result.data).toHaveLength(2);
    expect(result.data.every(p => p.author.handle === 'author')).toBe(true);
  });

  it('includes all replies when include_replies is true', async () => {
    const initialPost = makePost({
      id: '1',
      thread_id: 'conv1',
      author: { handle: 'author', name: 'Author', id: '1', verified: false },
    });
    mockGetPost.mockResolvedValue(initialPost);
    mockGetThread.mockResolvedValue([
      makePost({ id: '2', author: { handle: 'author', name: 'Author', id: '1', verified: false } }),
      makePost({ id: '3', author: { handle: 'replier', name: 'Replier', id: '2', verified: false } }),
    ]);

    const result = await getThread({ post: '1', include_replies: true });
    expect(result.data).toHaveLength(2);
  });

  it('throws when initial tweet is not found', async () => {
    mockGetPost.mockRejectedValue(new Error('Post 99999 not found'));

    await expect(getThread({ post: '99999', include_replies: false }))
      .rejects.toThrow('Post 99999 not found');
  });

  it('returns empty data when thread has no other posts', async () => {
    const initialPost = makePost({ id: '1', thread_id: '1' });
    mockGetPost.mockResolvedValue(initialPost);
    mockGetThread.mockResolvedValue([]);

    const result = await getThread({ post: '1', include_replies: false });
    expect(result.data).toEqual([]);
    expect(result.has_more).toBe(false);
  });
});
