import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockListLocalContentFromDb = vi.fn();

vi.mock('../../db/index.js', () => ({
  listLocalContent: (...args: any[]) => mockListLocalContentFromDb(...args),
}));

import { listLocalContent } from '../../tools/list-local-content.js';

describe('listLocalContent tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates to db list helper', async () => {
    mockListLocalContentFromDb.mockReturnValue({ data: [], has_more: false });

    await listLocalContent({
      limit: 20,
      include_full_content: false,
      snippet_chars: 600,
      max_total_chars: 80000,
    });

    expect(mockListLocalContentFromDb).toHaveBeenCalledWith({
      limit: 20,
      include_full_content: false,
      snippet_chars: 600,
      max_total_chars: 80000,
    });
  });

  it('marks result truncated when full content exceeds cap', async () => {
    mockListLocalContentFromDb.mockReturnValue({
      data: [
        {
          id: '1',
          type: 'article',
          author_handle: 'a',
          author_name: 'A',
          created_at: '2025-01-01T00:00:00.000Z',
          source_url: null,
          source: 'bookmark',
          article_title: 'A',
          content_status: 'hydrated',
          content_source: 'article',
          content_version: 2,
          content_fetched_at: null,
          snippet: 'x',
          content_text: '123456789',
          tags: [],
        },
      ],
      has_more: false,
    });

    const result = await listLocalContent({
      limit: 10,
      include_full_content: true,
      snippet_chars: 600,
      max_total_chars: 3,
    });

    expect(result.truncated).toBe(true);
    expect(result.data[0].content_text).toBe('123...');
  });
});
