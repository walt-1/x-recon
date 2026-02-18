/**
 * Create a mock X API v2 user object.
 */
export function makeXApiUser(overrides?: Record<string, any>): Record<string, any> {
  return {
    id: '9876543210',
    username: 'testuser',
    name: 'Test User',
    description: 'A test bio for x-recon testing',
    verified: true,
    publicMetrics: {
      followersCount: 1500,
      followingCount: 300,
      tweetCount: 5000,
    },
    createdAt: '2020-03-15T00:00:00.000Z',
    location: 'San Francisco, CA',
    url: 'https://example.com',
    profileImageUrl: 'https://pbs.twimg.com/profile_images/avatar.jpg',
    profileBannerUrl: 'https://pbs.twimg.com/profile_banners/banner.jpg',
    pinnedTweetId: '1111111111',
    ...overrides,
  };
}

/**
 * Create a minimal X API v2 user with missing fields.
 */
export function makeMinimalXApiUser(): Record<string, any> {
  return {
    id: '',
    username: '',
    name: '',
  };
}
