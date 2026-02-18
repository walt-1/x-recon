export interface XPost {
  id: string;
  text: string;
  author: {
    handle: string;
    name: string;
    id: string;
    verified: boolean;
  };
  timestamp: string;
  metrics: {
    likes: number;
    retweets: number;
    replies: number;
    views: number;
    bookmarks: number;
  };
  media: Array<{
    type: 'photo' | 'video' | 'gif' | 'animated_gif';
    url: string;
    alt?: string;
    thumbnail?: string;
  }>;
  urls: string[];
  hashtags: string[];
  mentions: string[];
  in_reply_to?: string;
  quoted_tweet_id?: string;
  quoted_tweet?: XPost;
  is_thread: boolean;
  thread_id?: string;
  language?: string;
  note_tweet_text?: string;
  article?: {
    id?: string;
    title?: string;
    text?: string;
    summary?: string;
  };
  source_url: string;
}

export interface XArticle {
  id: string;
  title: string;
  content: string;
  author: {
    handle: string;
    name: string;
    id: string;
  };
  timestamp: string;
  cover_image?: string;
  source_url: string;
}

export interface XUserProfile {
  id: string;
  handle: string;
  name: string;
  bio: string;
  verified: boolean;
  followers_count: number;
  following_count: number;
  tweet_count: number;
  created_at: string;
  location?: string;
  website?: string;
  profile_image_url: string;
  banner_url?: string;
  pinned_tweet_id?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  cursor?: string;
  has_more: boolean;
}

export interface TagSummary {
  tag: string;
  count: number;
}

export interface SyncResult {
  total_synced: number;
  new_posts: number;
  tags_applied: number;
  pages_fetched: number;
}

export interface StoredPost extends XPost {
  ingested_at: string;
  source: string;
  tags: string[];
}
