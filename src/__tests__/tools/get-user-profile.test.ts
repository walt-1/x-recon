import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { XUserProfile } from '../../types.js';

const mockGetUserProfile = vi.fn();

vi.mock('../../clients/x-api.js', () => ({
  getUserProfile: (...args: any[]) => mockGetUserProfile(...args),
}));

import { getUserProfile } from '../../tools/get-user-profile.js';

function makeProfile(overrides: Partial<XUserProfile> = {}): XUserProfile {
  return {
    id: '9876543210',
    handle: 'testuser',
    name: 'Test User',
    bio: 'A test bio',
    verified: true,
    followers_count: 1500,
    following_count: 300,
    tweet_count: 5000,
    created_at: '2020-03-15T00:00:00.000Z',
    location: 'San Francisco, CA',
    website: 'https://example.com',
    profile_image_url: 'https://pbs.twimg.com/profile_images/avatar.jpg',
    banner_url: 'https://pbs.twimg.com/profile_banners/banner.jpg',
    pinned_tweet_id: '1111111111',
    ...overrides,
  };
}

describe('getUserProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates to getUserProfile API and returns result', async () => {
    const profile = makeProfile({ handle: 'naval', name: 'Naval' });
    mockGetUserProfile.mockResolvedValue(profile);

    const result = await getUserProfile({ handle: 'naval' });
    expect(mockGetUserProfile).toHaveBeenCalledWith('naval');
    expect(result.handle).toBe('naval');
    expect(result.name).toBe('Naval');
  });

  it('returns all profile fields', async () => {
    const profile = makeProfile();
    mockGetUserProfile.mockResolvedValue(profile);

    const result = await getUserProfile({ handle: 'testuser' });
    expect(result.id).toBe('9876543210');
    expect(result.bio).toBe('A test bio');
    expect(result.verified).toBe(true);
    expect(result.followers_count).toBe(1500);
    expect(result.following_count).toBe(300);
    expect(result.tweet_count).toBe(5000);
    expect(result.location).toBe('San Francisco, CA');
    expect(result.website).toBe('https://example.com');
  });

  it('throws when user is not found', async () => {
    mockGetUserProfile.mockRejectedValue(new Error('User @nonexistent not found'));

    await expect(getUserProfile({ handle: 'nonexistent' })).rejects.toThrow('not found');
  });
});
