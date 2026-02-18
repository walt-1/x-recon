import { describe, it, expect } from 'vitest';
import { normalizeTweet, normalizeProfile } from '../../parsers/tweet.js';
import { makeJoinedTweet, makeMinimalJoinedTweet } from '../fixtures/tweets.js';
import { makeXApiUser, makeMinimalXApiUser } from '../fixtures/profiles.js';

describe('normalizeTweet', () => {
  it('maps all fields from a fully-populated tweet', () => {
    const joined = makeJoinedTweet();
    const result = normalizeTweet(joined);

    expect(result.id).toBe('1234567890');
    expect(result.text).toBe('Hello world from x-recon');
    expect(result.author.handle).toBe('testuser');
    expect(result.author.name).toBe('Test User');
    expect(result.author.id).toBe('9876543210');
    expect(result.author.verified).toBe(false);
    expect(result.timestamp).toBe('2025-01-15T12:00:00.000Z');
    expect(result.metrics.likes).toBe(42);
    expect(result.metrics.retweets).toBe(10);
    expect(result.metrics.replies).toBe(5);
    expect(result.metrics.views).toBe(1000);
    expect(result.metrics.bookmarks).toBe(3);
    expect(result.urls).toEqual(['https://example.com']);
    expect(result.hashtags).toEqual(['testing']);
    expect(result.mentions).toEqual(['mentioned_user']);
    expect(result.thread_id).toBe('1234567890');
    expect(result.source_url).toBe('https://x.com/testuser/status/1234567890');
    expect(result.language).toBe('en');
  });

  it('maps photos to media entries with type photo', () => {
    const joined = makeJoinedTweet();
    const result = normalizeTweet(joined);
    const photo = result.media.find(m => m.type === 'photo');
    expect(photo).toBeDefined();
    expect(photo!.url).toBe('https://pbs.twimg.com/media/photo1.jpg');
    expect(photo!.alt).toBe('A photo');
  });

  it('maps videos to media entries with type video and thumbnail', () => {
    const joined = makeJoinedTweet();
    const result = normalizeTweet(joined);
    const video = result.media.find(m => m.type === 'video');
    expect(video).toBeDefined();
    expect(video!.url).toBe('https://video.twimg.com/vid1.mp4');
    expect(video!.thumbnail).toBe('https://pbs.twimg.com/thumb1.jpg');
  });

  it('defaults missing fields to empty/zero/false', () => {
    const joined = makeMinimalJoinedTweet();
    const result = normalizeTweet(joined);

    expect(result.id).toBe('');
    expect(result.text).toBe('');
    expect(result.author.handle).toBe('');
    expect(result.author.name).toBe('');
    expect(result.author.id).toBe('');
    expect(result.metrics.likes).toBe(0);
    expect(result.metrics.retweets).toBe(0);
    expect(result.metrics.replies).toBe(0);
    expect(result.metrics.views).toBe(0);
    expect(result.metrics.bookmarks).toBe(0);
    expect(result.media).toEqual([]);
    expect(result.urls).toEqual([]);
    expect(result.hashtags).toEqual([]);
    expect(result.mentions).toEqual([]);
  });

  it('falls back name to handle when name is missing', () => {
    const joined = makeJoinedTweet({ author: { id: '1', username: 'fallback', name: undefined } });
    const result = normalizeTweet(joined);
    expect(result.author.name).toBe('fallback');
  });

  it('maps referenced_tweets for replies and quotes', () => {
    const joined = makeJoinedTweet({
      tweet: {
        id: '100',
        text: 'Reply tweet',
        referencedTweets: [
          { type: 'replied_to', id: '99' },
          { type: 'quoted', id: '88' },
        ],
      },
    });
    const result = normalizeTweet(joined);
    expect(result.in_reply_to).toBe('99');
    expect(result.quoted_tweet_id).toBe('88');
  });

  it('maps note_tweet for long-form content', () => {
    const joined = makeJoinedTweet({
      tweet: {
        id: '200',
        text: 'Short text',
        noteTweet: { text: 'This is a very long article text that exceeds 280 characters...' },
      },
    });
    const result = normalizeTweet(joined);
    expect(result.note_tweet_text).toBe('This is a very long article text that exceeds 280 characters...');
    expect(result.text).toBe('This is a very long article text that exceeds 280 characters...');
  });

  it('constructs source_url from handle and id', () => {
    const joined = makeJoinedTweet({
      tweet: { id: '999' },
      author: { id: '1', username: 'bob', name: 'Bob' },
    });
    const result = normalizeTweet(joined);
    expect(result.source_url).toBe('https://x.com/bob/status/999');
  });

  it('uses /i/status/ URL when author is missing', () => {
    const joined = makeMinimalJoinedTweet();
    joined.tweet.id = '777';
    const result = normalizeTweet(joined);
    expect(result.source_url).toBe('https://x.com/i/status/777');
  });

  it('handles animated_gif media type', () => {
    const joined = makeJoinedTweet({
      media: [{ mediaKey: 'gif_1', type: 'animated_gif', url: 'https://gif.com/g.mp4' }],
    });
    const result = normalizeTweet(joined);
    expect(result.media[0].type).toBe('animated_gif');
  });
});

describe('normalizeProfile', () => {
  it('maps all fields from a full user', () => {
    const user = makeXApiUser();
    const result = normalizeProfile(user);

    expect(result.id).toBe('9876543210');
    expect(result.handle).toBe('testuser');
    expect(result.name).toBe('Test User');
    expect(result.bio).toBe('A test bio for x-recon testing');
    expect(result.verified).toBe(true);
    expect(result.followers_count).toBe(1500);
    expect(result.following_count).toBe(300);
    expect(result.tweet_count).toBe(5000);
    expect(result.created_at).toBe('2020-03-15T00:00:00.000Z');
    expect(result.location).toBe('San Francisco, CA');
    expect(result.website).toBe('https://example.com');
    expect(result.profile_image_url).toBe('https://pbs.twimg.com/profile_images/avatar.jpg');
    expect(result.banner_url).toBe('https://pbs.twimg.com/profile_banners/banner.jpg');
    expect(result.pinned_tweet_id).toBe('1111111111');
  });

  it('defaults verified to false when missing', () => {
    const user = makeMinimalXApiUser();
    expect(normalizeProfile(user).verified).toBe(false);
  });

  it('defaults counts to 0 when missing', () => {
    const user = makeMinimalXApiUser();
    const result = normalizeProfile(user);
    expect(result.followers_count).toBe(0);
    expect(result.following_count).toBe(0);
    expect(result.tweet_count).toBe(0);
  });

  it('returns empty string for created_at when missing', () => {
    const user = makeMinimalXApiUser();
    expect(normalizeProfile(user).created_at).toBe('');
  });

  it('returns undefined for optional fields when missing', () => {
    const user = makeXApiUser({
      location: undefined,
      url: undefined,
      profileBannerUrl: undefined,
      pinnedTweetId: undefined,
    });
    const result = normalizeProfile(user);
    expect(result.location).toBeUndefined();
    expect(result.website).toBeUndefined();
    expect(result.banner_url).toBeUndefined();
    expect(result.pinned_tweet_id).toBeUndefined();
  });
});
