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
  stop_reason?: 'overlap' | 'date_cutoff' | 'max_pages' | 'no_more_pages';
  overlap_detected?: boolean;
  cutoff_reached?: boolean;
  first_synced_timestamp?: string;
  last_synced_timestamp?: string;
  referenced_candidates: number;
  referenced_existing: number;
  referenced_fetched: number;
  referenced_inserted: number;
  referenced_failed: number;
}

export interface StoredPost extends XPost {
  ingested_at: string;
  source: string;
  tags: string[];
}

export const CONTENT_STATUS_VALUES = [
  'new',
  'pending',
  'fetching',
  'hydrated',
  'partial',
  'failed',
  'missing',
  'stale',
] as const;

export type ContentStatus = (typeof CONTENT_STATUS_VALUES)[number];

export const CONTENT_SOURCE_VALUES = ['article', 'note_tweet', 'tweet', 'unknown'] as const;

export type ContentSource = (typeof CONTENT_SOURCE_VALUES)[number];

export interface LocalContentItem {
  id: string;
  type: string;
  author_handle: string;
  author_name: string | null;
  created_at: string;
  source_url: string | null;
  source: string | null;
  article_title: string | null;
  content_status: ContentStatus;
  content_source: ContentSource;
  content_version: number;
  content_fetched_at: string | null;
  snippet: string;
  content_text?: string;
  tags: string[];
}

export interface LocalContentListResult {
  data: LocalContentItem[];
  cursor?: string;
  has_more: boolean;
  truncated?: boolean;
}

export interface HydrationRowResult {
  id: string;
  old_status: ContentStatus;
  new_status: ContentStatus;
  content_version: number;
  error_code?: string;
}

export interface HydrationRunResult {
  processed: number;
  hydrated: number;
  partial: number;
  failed: number;
  missing: number;
  skipped: number;
  dry_run: boolean;
  rows: HydrationRowResult[];
  backfill_cursor?: string;
}
