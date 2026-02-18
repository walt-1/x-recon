import type { JoinedTweet } from '../../clients/x-api.js';

/**
 * Create a mock X API v2 tweet with pre-joined includes.
 */
export function makeJoinedTweet(overrides?: {
  tweet?: Record<string, any>;
  author?: Record<string, any>;
  media?: Array<Record<string, any>>;
}): JoinedTweet {
  return {
    tweet: {
      id: '1234567890',
      text: 'Hello world from x-recon',
      authorId: '9876543210',
      createdAt: '2025-01-15T12:00:00.000Z',
      conversationId: '1234567890',
      lang: 'en',
      publicMetrics: {
        likeCount: 42,
        retweetCount: 10,
        replyCount: 5,
        impressionCount: 1000,
        bookmarkCount: 3,
      },
      entities: {
        hashtags: [{ tag: 'testing' }],
        mentions: [{ username: 'mentioned_user' }],
        urls: [{ expanded_url: 'https://example.com' }],
      },
      referencedTweets: [],
      attachments: { mediaKeys: ['media_1', 'media_2'] },
      ...overrides?.tweet,
    },
    author: {
      id: '9876543210',
      username: 'testuser',
      name: 'Test User',
      verified: false,
      ...overrides?.author,
    },
    media: overrides?.media ?? [
      {
        mediaKey: 'media_1',
        type: 'photo',
        url: 'https://pbs.twimg.com/media/photo1.jpg',
        alt_text: 'A photo',
      },
      {
        mediaKey: 'media_2',
        type: 'video',
        url: 'https://video.twimg.com/vid1.mp4',
        preview_image_url: 'https://pbs.twimg.com/thumb1.jpg',
      },
    ],
  };
}

/**
 * Create a minimal JoinedTweet with empty/missing fields.
 */
export function makeMinimalJoinedTweet(): JoinedTweet {
  return {
    tweet: {},
    author: undefined,
    media: undefined,
  };
}

/**
 * Create a mock X API v2 response with tweet data and includes.
 */
export function makeXApiResponse(tweets: JoinedTweet[]) {
  return {
    data: tweets.map(t => t.tweet),
    includes: {
      users: tweets
        .map(t => t.author)
        .filter(Boolean) as Array<Record<string, any>>,
      media: tweets
        .flatMap(t => t.media ?? []),
    },
    meta: {},
  };
}
