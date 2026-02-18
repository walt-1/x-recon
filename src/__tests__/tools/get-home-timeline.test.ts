import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetHomeTimeline = vi.fn();

vi.mock('../../clients/x-api.js', () => ({
  getHomeTimeline: (...args: any[]) => mockGetHomeTimeline(...args),
}));

import { getHomeTimeline } from '../../tools/get-home-timeline.js';

describe('getHomeTimeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates to getHomeTimeline API with max_results', async () => {
    mockGetHomeTimeline.mockRejectedValue(new Error(
      'Home timeline requires OAuth 2.0 user authentication (not yet configured). ' +
      'Set X_API_CLIENT_ID and X_API_CLIENT_SECRET to enable this feature.',
    ));

    await expect(getHomeTimeline({ max_results: 20 }))
      .rejects.toThrow('OAuth 2.0 user authentication');
    expect(mockGetHomeTimeline).toHaveBeenCalledWith(20, undefined);
  });

  it('throws OAuth not configured error', async () => {
    mockGetHomeTimeline.mockRejectedValue(new Error(
      'Home timeline requires OAuth 2.0 user authentication (not yet configured). ' +
      'Set X_API_CLIENT_ID and X_API_CLIENT_SECRET to enable this feature.',
    ));

    await expect(getHomeTimeline({ max_results: 10 }))
      .rejects.toThrow('X_API_CLIENT_ID');
  });

  it('passes through the max_results parameter', async () => {
    mockGetHomeTimeline.mockRejectedValue(new Error('OAuth'));

    await expect(getHomeTimeline({ max_results: 50 })).rejects.toThrow();
    expect(mockGetHomeTimeline).toHaveBeenCalledWith(50, undefined);
  });
});
