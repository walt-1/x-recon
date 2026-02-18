import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { XPost } from '../../types.js';
import type { GrokResponse } from '../../clients/grok.js';

const mockSearchX = vi.fn();
const mockExtractCitations = vi.fn();
const mockGetPostsByIds = vi.fn();

vi.mock('../../clients/grok.js', () => ({
  searchX: (...args: any[]) => mockSearchX(...args),
  extractCitations: (...args: any[]) => mockExtractCitations(...args),
}));

vi.mock('../../clients/x-api.js', () => ({
  getPostsByIds: (...args: any[]) => mockGetPostsByIds(...args),
}));

vi.mock('../../parsers/citation.js', async () => {
  const actual = await vi.importActual('../../parsers/citation.js');
  return actual;
});

import { searchPosts } from '../../tools/search-posts.js';

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

function makeGrokResponse(citationUrls: string[]): GrokResponse {
  return {
    id: 'resp_1',
    output: [
      {
        type: 'message' as const,
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text: 'Here are the results.',
            annotations: citationUrls.map(url => ({ type: 'url_citation', url })),
          },
        ],
      },
    ],
  };
}

describe('searchPosts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls searchX with correct params', async () => {
    const grokResp = makeGrokResponse([]);
    mockSearchX.mockResolvedValue(grokResp);
    mockExtractCitations.mockReturnValue([]);

    await searchPosts({ query: 'test query', max_results: 10 });
    expect(mockSearchX).toHaveBeenCalledWith({
      query: 'test query',
      handles: undefined,
      from_date: undefined,
      to_date: undefined,
    });
  });

  it('passes handles and date filters to searchX', async () => {
    const grokResp = makeGrokResponse([]);
    mockSearchX.mockResolvedValue(grokResp);
    mockExtractCitations.mockReturnValue([]);

    await searchPosts({
      query: 'test',
      max_results: 5,
      handles: ['user1'],
      from_date: '2025-01-01',
      to_date: '2025-12-31',
    });
    expect(mockSearchX).toHaveBeenCalledWith({
      query: 'test',
      handles: ['user1'],
      from_date: '2025-01-01',
      to_date: '2025-12-31',
    });
  });

  it('extracts citations, gets IDs, and hydrates via getPostsByIds', async () => {
    const grokResp = makeGrokResponse([
      'https://x.com/user/status/111',
      'https://x.com/user/status/222',
    ]);
    mockSearchX.mockResolvedValue(grokResp);
    mockExtractCitations.mockReturnValue([
      'https://x.com/user/status/111',
      'https://x.com/user/status/222',
    ]);
    mockGetPostsByIds.mockResolvedValue([
      makePost({ id: '111', text: 'First' }),
      makePost({ id: '222', text: 'Second' }),
    ]);

    const result = await searchPosts({ query: 'test', max_results: 10 });
    expect(mockExtractCitations).toHaveBeenCalledWith(grokResp);
    expect(mockGetPostsByIds).toHaveBeenCalledWith(['111', '222']);
    expect(result.data).toHaveLength(2);
    expect(result.data[0].id).toBe('111');
    expect(result.data[1].id).toBe('222');
  });

  it('slices IDs to max_results before hydrating', async () => {
    const grokResp = makeGrokResponse([
      'https://x.com/u/status/1',
      'https://x.com/u/status/2',
      'https://x.com/u/status/3',
    ]);
    mockSearchX.mockResolvedValue(grokResp);
    mockExtractCitations.mockReturnValue([
      'https://x.com/u/status/1',
      'https://x.com/u/status/2',
      'https://x.com/u/status/3',
    ]);
    mockGetPostsByIds.mockResolvedValue([
      makePost({ id: '1' }),
      makePost({ id: '2' }),
    ]);

    await searchPosts({ query: 'test', max_results: 2 });
    expect(mockGetPostsByIds).toHaveBeenCalledWith(['1', '2']);
  });

  it('returns empty data when no citations found', async () => {
    const grokResp = makeGrokResponse([]);
    mockSearchX.mockResolvedValue(grokResp);
    mockExtractCitations.mockReturnValue([]);

    const result = await searchPosts({ query: 'test', max_results: 10 });
    expect(result.data).toEqual([]);
    expect(result.has_more).toBe(false);
    expect(mockGetPostsByIds).not.toHaveBeenCalled();
  });

  it('returns empty data when citations contain no valid tweet IDs', async () => {
    const grokResp = makeGrokResponse(['https://example.com/not-a-tweet']);
    mockSearchX.mockResolvedValue(grokResp);
    mockExtractCitations.mockReturnValue(['https://example.com/not-a-tweet']);

    const result = await searchPosts({ query: 'test', max_results: 10 });
    expect(result.data).toEqual([]);
    expect(result.has_more).toBe(false);
  });

  it('deduplicates tweet IDs from citations', async () => {
    const grokResp = makeGrokResponse([
      'https://x.com/u/status/111',
      'https://x.com/other/status/111',
    ]);
    mockSearchX.mockResolvedValue(grokResp);
    mockExtractCitations.mockReturnValue([
      'https://x.com/u/status/111',
      'https://x.com/other/status/111',
    ]);
    mockGetPostsByIds.mockResolvedValue([makePost({ id: '111' })]);

    const result = await searchPosts({ query: 'test', max_results: 10 });
    expect(mockGetPostsByIds).toHaveBeenCalledWith(['111']);
    expect(result.data).toHaveLength(1);
  });
});
