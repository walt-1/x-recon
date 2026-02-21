import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockHydrateArticleContent = vi.fn();

vi.mock('../../services/content-hydration.js', () => ({
  hydrateArticleContent: (...args: any[]) => mockHydrateArticleContent(...args),
}));

import { hydrateArticles } from '../../tools/hydrate-articles.js';

describe('hydrateArticles tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates args to hydration service', async () => {
    mockHydrateArticleContent.mockResolvedValue({
      processed: 1,
      hydrated: 1,
      partial: 0,
      failed: 0,
      missing: 0,
      skipped: 0,
      dry_run: false,
      rows: [],
    });

    const params = {
      ids: ['1'],
      limit: 1,
      force: true,
      dry_run: false,
      max_attempts: 7,
      backfill: false,
    };

    await hydrateArticles(params);
    expect(mockHydrateArticleContent).toHaveBeenCalledWith(params);
  });
});
