import type { JoinedTweet } from '../clients/x-api.js';
import type { XPost, XUserProfile } from '../types.js';

/**
 * Normalize an X API v2 tweet (with pre-joined includes) into our XPost shape.
 */
export function normalizeTweet(joined: JoinedTweet): XPost {
  const { tweet, author, media } = joined;
  const id = tweet.id ?? '';
  const handle = author?.username ?? '';

  // Referenced tweets
  const refs: Array<Record<string, any>> = tweet.referencedTweets ?? tweet.referenced_tweets ?? [];
  const inReplyTo = refs.find((r: any) => r.type === 'replied_to')?.id;
  const quotedId = refs.find((r: any) => r.type === 'quoted')?.id;

  // Entities
  const entities = tweet.entities ?? {};
  const hashtags = (entities.hashtags ?? []).map((h: any) => h.tag ?? h.text ?? '');
  const mentions = (entities.mentions ?? []).map((m: any) => m.username ?? '');
  const urls = (entities.urls ?? []).map((u: any) => u.expanded_url ?? u.url ?? '');

  // Public metrics
  const pm = tweet.publicMetrics ?? tweet.public_metrics ?? {};

  // Media
  const normalizedMedia = (media ?? []).map((m: any) => {
    const mediaType = m.type ?? 'photo';
    const type = mediaType === 'animated_gif' ? 'animated_gif' as const
      : mediaType === 'video' ? 'video' as const
      : mediaType === 'gif' ? 'gif' as const
      : 'photo' as const;
    return {
      type,
      url: m.url ?? m.preview_image_url ?? '',
      alt: m.alt_text ?? m.altText,
      thumbnail: m.preview_image_url ?? m.previewImageUrl,
    };
  });

  // Note tweet (long-form content)
  const noteTweet = tweet.noteTweet ?? tweet.note_tweet;
  const noteTweetText = noteTweet?.text ?? undefined;

  // Article (long-form content metadata)
  const rawArticle = tweet.article;
  const articleText = rawArticle?.text ?? rawArticle?.content ?? rawArticle?.body;
  const article = rawArticle
    ? {
        id: rawArticle.id ?? rawArticle.article_id,
        title: rawArticle.title ?? rawArticle.headline,
        text: articleText,
        summary: rawArticle.summary ?? rawArticle.preview_text,
      }
    : undefined;

  // Text: prefer article/note_tweet text for long-form, fall back to regular text
  const text = articleText ?? noteTweetText ?? tweet.text ?? '';

  // Conversation / thread
  const conversationId = tweet.conversationId ?? tweet.conversation_id;
  const authorId = tweet.authorId ?? tweet.author_id ?? author?.id ?? '';

  return {
    id,
    text,
    author: {
      handle,
      name: author?.name ?? handle,
      id: authorId,
      verified: author?.verified ?? false,
    },
    timestamp: tweet.createdAt ?? tweet.created_at ?? '',
    metrics: {
      likes: pm.likeCount ?? pm.like_count ?? 0,
      retweets: pm.retweetCount ?? pm.retweet_count ?? 0,
      replies: pm.replyCount ?? pm.reply_count ?? 0,
      views: pm.impressionCount ?? pm.impression_count ?? 0,
      bookmarks: pm.bookmarkCount ?? pm.bookmark_count ?? 0,
    },
    media: normalizedMedia,
    urls,
    hashtags,
    mentions,
    in_reply_to: inReplyTo,
    quoted_tweet_id: quotedId,
    is_thread: conversationId === id && !inReplyTo,
    thread_id: conversationId,
    language: tweet.lang,
    note_tweet_text: noteTweetText,
    article,
    source_url: handle
      ? `https://x.com/${handle}/status/${id}`
      : `https://x.com/i/status/${id}`,
  };
}

/**
 * Normalize an X API v2 user into our XUserProfile shape.
 */
export function normalizeProfile(user: Record<string, any>): XUserProfile {
  const pm = user.publicMetrics ?? user.public_metrics ?? {};
  return {
    id: user.id ?? '',
    handle: user.username ?? '',
    name: user.name ?? '',
    bio: user.description ?? '',
    verified: user.verified ?? false,
    followers_count: pm.followersCount ?? pm.followers_count ?? 0,
    following_count: pm.followingCount ?? pm.following_count ?? 0,
    tweet_count: pm.tweetCount ?? pm.tweet_count ?? 0,
    created_at: user.createdAt ?? user.created_at ?? '',
    location: user.location ?? undefined,
    website: user.url ?? undefined,
    profile_image_url: user.profileImageUrl ?? user.profile_image_url ?? '',
    banner_url: user.profileBannerUrl ?? user.profile_banner_url ?? undefined,
    pinned_tweet_id: user.pinnedTweetId ?? user.pinned_tweet_id ?? undefined,
  };
}
