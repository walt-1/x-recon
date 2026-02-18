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

import { getArticle } from '../../tools/get-article.js';

function makePost(overrides: Partial<XPost> = {}): XPost {
  return {
    id: '1234567890',
    text: 'Regular tweet text',
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

describe('getArticle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('extracts tweet ID from URL and returns XArticle shape', async () => {
    mockGetPost.mockResolvedValue(makePost({
      id: '12345',
      text: 'Article content here',
      author: { handle: 'author', name: 'Author', id: '111', verified: true },
      timestamp: '2025-06-01T00:00:00.000Z',
      source_url: 'https://x.com/author/status/12345',
    }));

    const result = await getArticle({ url: 'https://x.com/author/status/12345' });
    expect(mockGetPost).toHaveBeenCalledWith('12345');
    expect(result.id).toBe('12345');
    expect(result.content).toBe('Article content here');
    expect(result.author.handle).toBe('author');
    expect(result.author.name).toBe('Author');
    expect(result.author.id).toBe('111');
    expect(result.title).toBe('');
    expect(result.source_url).toBe('https://x.com/author/status/12345');
  });

  it('uses note_tweet_text for content when available', async () => {
    mockGetPost.mockResolvedValue(makePost({
      id: '12345',
      text: 'Short truncated text...',
      note_tweet_text: 'This is the full long-form article content that was written as a note tweet.',
    }));

    const result = await getArticle({ url: 'https://x.com/a/status/12345' });
    expect(result.content).toBe('This is the full long-form article content that was written as a note tweet.');
  });

  it('falls back to regular text when note_tweet_text is undefined', async () => {
    mockGetPost.mockResolvedValue(makePost({
      id: '12345',
      text: 'Regular tweet text',
      note_tweet_text: undefined,
    }));

    const result = await getArticle({ url: 'https://x.com/a/status/12345' });
    expect(result.content).toBe('Regular tweet text');
  });

  it('throws on invalid URL with no /status/ pattern', async () => {
    await expect(getArticle({ url: 'https://x.com/articles/something' }))
      .rejects.toThrow('Cannot extract tweet ID');
  });

  it('throws when post is not found', async () => {
    mockGetPost.mockRejectedValue(new Error('Post 99999 not found'));

    await expect(getArticle({ url: 'https://x.com/a/status/99999' }))
      .rejects.toThrow('Post 99999 not found');
  });

  it('maps timestamp and source_url from the post', async () => {
    mockGetPost.mockResolvedValue(makePost({
      id: '555',
      timestamp: '2025-03-20T10:30:00.000Z',
      source_url: 'https://x.com/writer/status/555',
    }));

    const result = await getArticle({ url: 'https://x.com/writer/status/555' });
    expect(result.timestamp).toBe('2025-03-20T10:30:00.000Z');
    expect(result.source_url).toBe('https://x.com/writer/status/555');
  });
});
