import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockListBookmarks = vi.fn();

vi.mock('../../clients/x-api.js', () => ({
  listBookmarks: (...args: any[]) => mockListBookmarks(...args),
}));

import { listBookmarks } from '../../tools/list-bookmarks.js';

describe('listBookmarks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates to listBookmarks API with max_results and cursor', async () => {
    mockListBookmarks.mockRejectedValue(new Error(
      'Bookmarks require OAuth 2.0 user authentication (not yet configured). ' +
      'Set X_API_CLIENT_ID and X_API_CLIENT_SECRET to enable this feature.',
    ));

    await expect(listBookmarks({ max_results: 50 }))
      .rejects.toThrow('OAuth 2.0 user authentication');
    expect(mockListBookmarks).toHaveBeenCalledWith(50, undefined);
  });

  it('passes cursor when provided', async () => {
    mockListBookmarks.mockRejectedValue(new Error('Bookmarks require OAuth'));

    await expect(listBookmarks({ max_results: 20, cursor: 'cursor-abc' }))
      .rejects.toThrow();
    expect(mockListBookmarks).toHaveBeenCalledWith(20, 'cursor-abc');
  });

  it('throws OAuth not configured error', async () => {
    mockListBookmarks.mockRejectedValue(new Error(
      'Bookmarks require OAuth 2.0 user authentication (not yet configured). ' +
      'Set X_API_CLIENT_ID and X_API_CLIENT_SECRET to enable this feature.',
    ));

    await expect(listBookmarks({ max_results: 20 }))
      .rejects.toThrow('X_API_CLIENT_ID');
  });
});
