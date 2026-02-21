import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSearchLocalContent = vi.fn();

vi.mock('../../db/index.js', () => ({
  searchLocalContent: (...args: any[]) => mockSearchLocalContent(...args),
}));

import { searchLocal } from '../../tools/search-local.js';

describe('searchLocal tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes params to db search helper', async () => {
    mockSearchLocalContent.mockReturnValue({ data: [], has_more: false });

    await searchLocal({
      query: 'solana',
      tag: 'infrastructure',
      limit: 20,
      include_full_content: false,
      snippet_chars: 800,
      max_total_chars: 80000,
    });

    expect(mockSearchLocalContent).toHaveBeenCalledWith({
      query: 'solana',
      tag: 'infrastructure',
      limit: 20,
      content_status: undefined,
      include_full_content: false,
      snippet_chars: 800,
    });
  });

  it('truncates total full content payload when exceeding max_total_chars', async () => {
    mockSearchLocalContent.mockReturnValue({
      data: [
        {
          id: '1',
          type: 'article',
          author_handle: 'a',
          author_name: 'A',
          created_at: '2025-01-01T00:00:00.000Z',
          source_url: null,
          source: 'bookmark',
          article_title: 'T',
          content_status: 'hydrated',
          content_source: 'article',
          content_version: 1,
          content_fetched_at: null,
          snippet: 'x',
          content_text: 'abcdefghij',
          tags: [],
        },
      ],
      has_more: false,
    });

    const result = await searchLocal({
      query: 'article',
      limit: 10,
      include_full_content: true,
      snippet_chars: 800,
      max_total_chars: 5,
    });

    expect(result.truncated).toBe(true);
    expect(result.data[0].content_text).toBe('abcde...');
  });
});
