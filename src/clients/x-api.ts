import { Client } from '@xdevplatform/xdk';
import { loadConfig } from '../config.js';
import { getUserClient, getAuthUserId, hasOAuthTokens } from '../auth/oauth.js';
import { normalizeTweet, normalizeProfile } from '../parsers/tweet.js';
import type { XPost, XUserProfile, PaginatedResponse } from '../types.js';

type XApiErrorLike = {
  status?: number;
  message?: string;
  response?: {
    status?: number;
  };
};

function getErrorStatus(err: unknown): number | undefined {
  const maybe = err as XApiErrorLike;
  return maybe?.status ?? maybe?.response?.status;
}

export function normalizeXApiError(err: unknown, context: string): Error {
  const message = err instanceof Error ? err.message : String(err);
  const status = getErrorStatus(err);

  if (status === 402 || /payment required/i.test(message) || /\b402\b/.test(message)) {
    return new Error(
      `X API request failed for ${context}: HTTP 402 Payment Required. ` +
        'Your X API app likely needs additional credits or a paid tier for this endpoint. ' +
        'Top up credits in https://console.x.com and retry.',
    );
  }

  if (/available:\s*none/i.test(message)) {
    return new Error(
      `X API authentication not configured for ${context}. ` +
        'Provide X_API_BEARER_TOKEN and/or run "npm run authorize" for OAuth user endpoints.',
    );
  }

  if (status === 401 || /unauthorized/i.test(message)) {
    return new Error(
      `X API request unauthorized for ${context}. Check token validity and permissions in https://console.x.com.`,
    );
  }

  return err instanceof Error ? err : new Error(message);
}

async function withXApiErrorContext<T>(context: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw normalizeXApiError(err, context);
  }
}

// Standard fields requested on every call
const TWEET_FIELDS = [
  'text', 'created_at', 'public_metrics', 'entities', 'author_id',
  'conversation_id', 'referenced_tweets', 'note_tweet', 'article', 'attachments', 'lang',
];

const USER_FIELDS = [
  'name', 'username', 'description', 'public_metrics', 'verified',
  'profile_image_url', 'profile_banner_url', 'created_at', 'location',
  'url', 'pinned_tweet_id',
];

const EXPANSIONS = ['author_id', 'referenced_tweets.id', 'attachments.media_keys'];

const MEDIA_FIELDS = ['url', 'preview_image_url', 'type', 'alt_text'];

// Common options for tweet-related queries
function tweetOptions(extra: Record<string, any> = {}) {
  return {
    tweetFields: TWEET_FIELDS,
    userFields: USER_FIELDS,
    expansions: EXPANSIONS,
    mediaFields: MEDIA_FIELDS,
    ...extra,
  };
}

// Common options for user-related queries
function userOptions(extra: Record<string, any> = {}) {
  return {
    userFields: USER_FIELDS,
    ...extra,
  };
}

// Singleton bearer client (optional)
let _bearerClient: Client | null = null;

export function getXClient(): Client {
  if (_bearerClient) return _bearerClient;
  const config = loadConfig();
  const bearer = config.X_API_BEARER_TOKEN?.trim();
  if (!bearer) {
    throw new Error('X_API_BEARER_TOKEN is not configured');
  }
  _bearerClient = new Client(bearer);
  return _bearerClient;
}

async function getPreferredClient(): Promise<Client> {
  const config = loadConfig();
  if (config.X_API_BEARER_TOKEN?.trim()) {
    return getXClient();
  }

  const oauthClient = await getUserClient();
  if (oauthClient) {
    return oauthClient;
  }

  throw new Error(
    'No X API authentication configured. Provide X_API_BEARER_TOKEN or run "npm run authorize" for OAuth user context.',
  );
}

function isAuthMissingError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /available:\s*none/i.test(message) || /authentication not configured/i.test(message);
}

function shouldTryOAuthFallback(err: unknown): boolean {
  const status = getErrorStatus(err);
  const message = err instanceof Error ? err.message : String(err);

  if (isAuthMissingError(err)) return true;
  if (status === 400 || status === 401 || status === 403) return true;
  return /unauthorized|forbidden|bad request/i.test(message);
}

async function withApiClient<T>(context: string, fn: (client: Client) => Promise<T>): Promise<T> {
  const config = loadConfig();
  const hasBearer = !!config.X_API_BEARER_TOKEN?.trim();
  const bearerClient = hasBearer ? getXClient() : null;

  if (bearerClient) {
    try {
      return await fn(bearerClient);
    } catch (err) {
      // Fallback to OAuth user client when bearer auth is unavailable for this request.
      if (shouldTryOAuthFallback(err) && hasOAuthTokens()) {
        const oauthClient = await getUserClient();
        if (oauthClient) {
          return fn(oauthClient);
        }
      }
      throw err;
    }
  }

  const client = await getPreferredClient();
  return fn(client);
}

// --- Includes joining ---

interface IncludesData {
  users?: Array<Record<string, any>>;
  media?: Array<Record<string, any>>;
  tweets?: Array<Record<string, any>>;
}

export interface JoinedTweet {
  tweet: Record<string, any>;
  author?: Record<string, any>;
  media?: Array<Record<string, any>>;
}

function buildLookups(includes?: IncludesData) {
  const userMap = new Map<string, Record<string, any>>();
  const mediaMap = new Map<string, Record<string, any>>();

  if (includes?.users) {
    for (const u of includes.users) {
      if (u.id) userMap.set(u.id, u);
    }
  }
  if (includes?.media) {
    for (const m of includes.media) {
      if (m.mediaKey || m.media_key) {
        mediaMap.set(m.mediaKey ?? m.media_key, m);
      }
    }
  }

  return { userMap, mediaMap };
}

function joinTweet(
  tweet: Record<string, any>,
  userMap: Map<string, Record<string, any>>,
  mediaMap: Map<string, Record<string, any>>,
): JoinedTweet {
  const author = tweet.authorId
    ? userMap.get(tweet.authorId)
    : tweet.author_id
      ? userMap.get(tweet.author_id)
      : undefined;

  const mediaKeys: string[] =
    tweet.attachments?.mediaKeys ?? tweet.attachments?.media_keys ?? [];
  const media = mediaKeys
    .map((key: string) => mediaMap.get(key))
    .filter(Boolean) as Array<Record<string, any>>;

  return { tweet, author, media: media.length > 0 ? media : undefined };
}

function joinIncludes(
  tweets: Array<Record<string, any>>,
  includes?: IncludesData,
): JoinedTweet[] {
  const { userMap, mediaMap } = buildLookups(includes);
  return tweets.map(t => joinTweet(t, userMap, mediaMap));
}

// --- Exported methods ---

export async function getPost(id: string): Promise<XPost> {
  return withXApiErrorContext(`get_post(${id})`, async () => {
    const response = await withApiClient(`get_post(${id})`, client =>
      client.posts.getById(id, tweetOptions()),
    );
    if (!response.data) throw new Error(`Post ${id} not found`);

    const { userMap, mediaMap } = buildLookups(response.includes);
    const joined = joinTweet(response.data as Record<string, any>, userMap, mediaMap);
    return normalizeTweet(joined);
  });
}

export async function getPostsByIds(ids: string[]): Promise<XPost[]> {
  return withXApiErrorContext('get_posts_by_ids', async () => {
    if (ids.length === 0) return [];
    const response = await withApiClient('get_posts_by_ids', client =>
      client.posts.getByIds(ids, tweetOptions()),
    );
    if (!response.data) return [];

    const joined = joinIncludes(response.data as Array<Record<string, any>>, response.includes);
    return joined.map(normalizeTweet);
  });
}

export async function searchRecent(
  query: string,
  maxResults: number,
  sortOrder?: 'recency' | 'relevancy',
): Promise<PaginatedResponse<XPost>> {
  return withXApiErrorContext('search_posts_raw', async () => {
    const response = await withApiClient('search_posts_raw', client =>
      client.posts.searchRecent(query, tweetOptions({
        maxResults: Math.min(maxResults, 100),
        sortOrder,
      })),
    );

    if (!response.data) return { data: [], has_more: false };

    const joined = joinIncludes(response.data as Array<Record<string, any>>, response.includes);
    const nextToken = (response.meta as any)?.next_token ?? (response.meta as any)?.nextToken;

    return {
      data: joined.map(normalizeTweet),
      cursor: nextToken,
      has_more: !!nextToken,
    };
  });
}

// Username → user ID cache
const userIdCache = new Map<string, string>();

async function resolveUserId(username: string): Promise<string> {
  return withXApiErrorContext(`resolve_user_id(@${username})`, async () => {
    const cached = userIdCache.get(username.toLowerCase());
    if (cached) return cached;

    const response = await withApiClient(`resolve_user_id(@${username})`, client =>
      client.users.getByUsername(username, userOptions()),
    );
    if (!response.data) throw new Error(`User @${username} not found`);

    const id = (response.data as any).id;
    userIdCache.set(username.toLowerCase(), id);
    return id;
  });
}

export async function getUserPosts(
  username: string,
  maxResults: number,
): Promise<PaginatedResponse<XPost>> {
  return withXApiErrorContext(`get_user_posts(@${username})`, async () => {
    const userId = await resolveUserId(username);
    const response = await withApiClient(`get_user_posts(@${username})`, client =>
      client.users.getPosts(userId, tweetOptions({
        maxResults: Math.min(maxResults, 100),
      })),
    );

    if (!response.data) return { data: [], has_more: false };

    const joined = joinIncludes(response.data as Array<Record<string, any>>, response.includes);
    const nextToken = (response.meta as any)?.next_token ?? (response.meta as any)?.nextToken;

    return {
      data: joined.map(normalizeTweet),
      cursor: nextToken,
      has_more: !!nextToken,
    };
  });
}

export async function getThread(
  conversationId: string,
  maxResults = 100,
): Promise<XPost[]> {
  return withXApiErrorContext(`get_thread(${conversationId})`, async () => {
    const response = await withApiClient(`get_thread(${conversationId})`, client =>
      client.posts.searchRecent(
        `conversation_id:${conversationId}`,
        tweetOptions({ maxResults: Math.min(maxResults, 100) }),
      ),
    );

    if (!response.data) return [];

    const joined = joinIncludes(response.data as Array<Record<string, any>>, response.includes);
    const posts = joined.map(normalizeTweet);

    // Sort chronologically
    posts.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    return posts;
  });
}

export async function getUserProfile(username: string): Promise<XUserProfile> {
  return withXApiErrorContext(`get_user_profile(@${username})`, async () => {
    const response = await withApiClient(`get_user_profile(@${username})`, client =>
      client.users.getByUsername(username, userOptions()),
    );
    if (!response.data) throw new Error(`User @${username} not found`);
    return normalizeProfile(response.data as Record<string, any>);
  });
}

// --- OAuth 2.0 user-context methods ---

async function requireUserClient(): Promise<{ client: Client; userId: string }> {
  const client = await getUserClient();
  if (!client) {
    throw new Error(
      'OAuth 2.0 user authentication required. Run "npm run authorize" to log in with your X account. ' +
      'Requires X_API_CLIENT_ID (and optionally X_API_CLIENT_SECRET) in your environment.',
    );
  }
  const userId = await getAuthUserId();
  return { client, userId };
}

export async function getHomeTimeline(
  maxResults: number,
  cursor?: string,
): Promise<PaginatedResponse<XPost>> {
  return withXApiErrorContext('get_home_timeline', async () => {
    const { client, userId } = await requireUserClient();
    const response = await client.users.getTimeline(userId, tweetOptions({
      maxResults: Math.min(maxResults, 100),
      ...(cursor ? { paginationToken: cursor } : {}),
    }));

    if (!response.data) return { data: [], has_more: false };

    const joined = joinIncludes(response.data as Array<Record<string, any>>, response.includes);
    const nextToken = (response.meta as any)?.next_token ?? (response.meta as any)?.nextToken;

    return {
      data: joined.map(normalizeTweet),
      cursor: nextToken,
      has_more: !!nextToken,
    };
  });
}

export async function listBookmarks(
  maxResults: number,
  cursor?: string,
): Promise<PaginatedResponse<XPost>> {
  return withXApiErrorContext('list_bookmarks', async () => {
    const { client, userId } = await requireUserClient();
    const response = await client.users.getBookmarks(userId, tweetOptions({
      maxResults: Math.min(maxResults, 100),
      ...(cursor ? { paginationToken: cursor } : {}),
    }));

    if (!response.data) return { data: [], has_more: false };

    const joined = joinIncludes(response.data as Array<Record<string, any>>, response.includes);
    const nextToken = (response.meta as any)?.next_token ?? (response.meta as any)?.nextToken;

    return {
      data: joined.map(normalizeTweet),
      cursor: nextToken,
      has_more: !!nextToken,
    };
  });
}
