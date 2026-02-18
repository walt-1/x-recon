# X-Recon Build Specification

> A hybrid MCP server + OpenCode skill that uses Grok API for intelligent X platform search and `agent-twitter-client` for raw post/article/bookmark data fetching. All data is returned as structured JSON — no AI summaries baked in. The user's agents handle all synthesis and analysis.

---

## 1. Project Structure

```
~/_workspace/x-recon/
├── package.json
├── tsconfig.json
├── .env.example                # documents required env vars (no values)
├── src/
│   ├── index.ts                # MCP server entry point (STDIO transport)
│   ├── auth.ts                 # Login + cookie management module
│   ├── tools/
│   │   ├── search-posts.ts     # Grok-powered search → raw data hydration
│   │   ├── search-posts-raw.ts # Direct keyword search (no Grok)
│   │   ├── get-post.ts         # Single post by ID or URL
│   │   ├── get-user-posts.ts   # Recent posts from a user handle
│   │   ├── get-thread.ts       # Full conversation thread
│   │   ├── get-article.ts      # X article (long-form content)
│   │   ├── get-user-profile.ts # User profile data
│   │   ├── get-home-timeline.ts# Authenticated home timeline
│   │   ├── list-bookmarks.ts   # Paginated bookmark listing
│   │   └── search-bookmarks.ts # Search within bookmarks
│   ├── clients/
│   │   ├── twitter.ts          # agent-twitter-client wrapper
│   │   ├── grok.ts             # xAI Responses API client
│   │   └── graphql.ts          # Direct Twitter GraphQL client (bookmarks)
│   ├── parsers/
│   │   ├── citation.ts         # Extract tweet IDs from Grok x_search citations
│   │   └── tweet.ts            # Normalize tweet objects into XPost shape
│   ├── types.ts                # All shared TypeScript interfaces
│   └── config.ts               # Env var loading + validation
├── BUILD_SPEC.md               # This file
└── dist/                       # Compiled output
```

---

## 2. Dependencies

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "latest",
    "agent-twitter-client": "^0.0.19",
    "zod": "^3.23"
  },
  "devDependencies": {
    "typescript": "^5.5",
    "@types/node": "^22",
    "vitest": "^2.0"
  }
}
```

- **@modelcontextprotocol/sdk** — MCP server framework (STDIO transport)
- **agent-twitter-client** — Twitter scraper, session cookie auth, no API keys needed for reads
- **zod** — Input validation for all tool parameters
- No xAI SDK needed — Grok API is a single `fetch` call to an OpenAI-compatible endpoint

---

## 3. Environment Variables

```bash
# xAI Grok API (for search_posts tool)
XAI_API_KEY=           # From 1Password: op://Private/grok-api-key/credential

# X/Twitter login (for agent-twitter-client + GraphQL bookmarks)
X_USERNAME=            # From 1Password
X_PASSWORD=            # From 1Password
X_EMAIL=               # From 1Password

# Optional
X_COOKIES_PATH=        # Path to cache cookies (default: ~/.x-recon-cookies.json)
GROK_MODEL=            # Default: grok-4-1-fast-reasoning
LOG_LEVEL=             # Default: info
```

### Config module (`src/config.ts`)

Use Zod to validate all env vars at startup. Fail fast with clear error messages if required vars are missing. Do not log or echo any credential values.

---

## 4. Authentication Module (`src/auth.ts`)

### Login Flow

1. On MCP server startup, attempt to load cached cookies from `X_COOKIES_PATH`
2. If cookies exist and are valid, reuse them (skip login)
3. If no cookies or expired, call `scraper.login(X_USERNAME, X_PASSWORD, X_EMAIL)`
4. After successful login, persist cookies to disk for reuse across restarts
5. No 2FA — user confirmed it is disabled on their account
6. Export two things:
   - The authenticated `Scraper` instance (for agent-twitter-client calls)
   - The raw cookie strings `ct0` and `auth_token` (for direct GraphQL bookmark calls)

### Cookie Extraction

```typescript
// After login, extract cookies for GraphQL reuse
const cookies = await scraper.getCookies();
const ct0 = cookies.find(c => c.name === 'ct0')?.value;
const authToken = cookies.find(c => c.name === 'auth_token')?.value;
```

### Error Handling

- If login fails, retry once after 3 seconds
- If retry fails, log the error and start the MCP server in degraded mode (Grok search still works, raw fetch tools return errors explaining auth failure)
- Expose a `reconnect` tool or handle re-auth lazily on next tool call

---

## 5. Data Contracts (`src/types.ts`)

### XPost — returned by all post-fetching tools

```typescript
interface XPost {
  id: string;
  text: string;
  author: {
    handle: string;
    name: string;
    id: string;
    verified: boolean;
  };
  timestamp: string;              // ISO 8601
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
  urls: string[];                 // Extracted URLs from tweet entities
  hashtags: string[];
  mentions: string[];             // @handles mentioned
  in_reply_to?: string;           // Tweet ID this replies to
  quoted_tweet_id?: string;
  quoted_tweet?: XPost;           // Inline quoted tweet data if available
  is_thread: boolean;
  thread_id?: string;             // ID of first tweet in thread
  language?: string;
  source_url: string;             // https://x.com/{handle}/status/{id}
}
```

### XArticle — returned by get_article

```typescript
interface XArticle {
  id: string;
  title: string;
  content: string;                // Full article body (HTML or plain text)
  author: {
    handle: string;
    name: string;
    id: string;
  };
  timestamp: string;
  cover_image?: string;
  source_url: string;
}
```

### XUserProfile — returned by get_user_profile

```typescript
interface XUserProfile {
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
```

### Paginated Responses

```typescript
interface PaginatedResponse<T> {
  data: T[];
  cursor?: string;                // Pass to next call for more results
  has_more: boolean;
}
```

### Tweet Normalizer (`src/parsers/tweet.ts`)

agent-twitter-client returns its own `Tweet` type. Write a `normalizeTweet(tweet: Tweet): XPost` function that maps their shape to our `XPost` contract. Handle missing fields gracefully (default metrics to 0, etc.). This normalizer is used by EVERY tool that returns posts — single source of truth for the output shape.

---

## 6. Tool Specifications

### 6.1 `search_posts` — Grok-Powered Search

**Purpose:** Semantic search across X using Grok's internal access to the platform. Finds posts the user would never match with keywords alone. Returns raw post data (not Grok's summary).

**Parameters (Zod schema):**
```typescript
{
  query: z.string().describe("Natural language search query"),
  max_results: z.number().min(1).max(20).default(10).describe("Max posts to return"),
  from_date: z.string().optional().describe("ISO 8601 start date filter"),
  to_date: z.string().optional().describe("ISO 8601 end date filter"),
  handles: z.array(z.string()).max(10).optional().describe("Filter to these X handles (no @ prefix)")
}
```

**Implementation:**

Step 1 — Call Grok x_search:
```
POST https://api.x.ai/v1/responses
Authorization: Bearer ${XAI_API_KEY}
Content-Type: application/json

{
  "model": "grok-4-1-fast-reasoning",
  "tools": [{ "type": "x_search" }],
  "input": "Search X for: ${query}. Return all relevant post URLs.",
  "tool_choice": { "type": "x_search" },
  "parameters": {
    "allowed_x_handles": handles || [],
    "from_date": from_date || undefined,
    "to_date": to_date || undefined
  }
}
```

Step 2 — Extract tweet IDs from citations (`src/parsers/citation.ts`):
```typescript
// response.citations contains URLs like:
// https://x.com/i/status/1234567890123456789
// https://x.com/username/status/1234567890123456789
const TWEET_URL_REGEX = /x\.com\/(?:i|[^/]+)\/status\/(\d+)/g;

function extractTweetIds(citations: string[]): string[] {
  return citations
    .map(url => url.match(TWEET_URL_REGEX))
    .filter(Boolean)
    .map(match => match[1])
    .slice(0, max_results);
}
```

Step 3 — Hydrate with raw data:
```typescript
// For each extracted tweet ID, fetch full data via agent-twitter-client
const posts = await Promise.all(
  tweetIds.map(id => scraper.getTweet(id))
);
return posts.map(normalizeTweet);
```

**Returns:** `PaginatedResponse<XPost>`

---

### 6.2 `search_posts_raw` — Direct Keyword Search

**Purpose:** Fast keyword search without Grok. Uses agent-twitter-client's searchTweets directly. Better for exact phrases, hashtags, from:user queries.

**Parameters:**
```typescript
{
  query: z.string().describe("Search query (supports Twitter search operators: from:, to:, #, exact phrases in quotes)"),
  max_results: z.number().min(1).max(50).default(20),
  mode: z.enum(["latest", "top"]).default("latest").describe("Sort by recency or engagement")
}
```

**Implementation:**
```typescript
import { SearchMode } from 'agent-twitter-client';

const mode = params.mode === 'top' ? SearchMode.Top : SearchMode.Latest;
const tweets = [];
const iterator = scraper.searchTweets(query, max_results, mode);
for await (const tweet of iterator) {
  tweets.push(normalizeTweet(tweet));
  if (tweets.length >= max_results) break;
}
return { data: tweets, has_more: false };
```

**Returns:** `PaginatedResponse<XPost>`

---

### 6.3 `get_post` — Single Post by ID or URL

**Purpose:** Fetch complete data for a single post.

**Parameters:**
```typescript
{
  post: z.string().describe("Tweet ID (e.g. '1234567890') or full URL (e.g. 'https://x.com/user/status/1234567890')")
}
```

**Implementation:**
```typescript
// Extract ID from URL if needed
const id = extractTweetId(params.post); // handles both raw ID and URL
const tweet = await scraper.getTweet(id);
if (!tweet) throw new Error(`Post ${id} not found`);
return normalizeTweet(tweet);
```

**Returns:** `XPost`

---

### 6.4 `get_user_posts` — Recent Posts from a User

**Purpose:** Fetch a user's recent posts.

**Parameters:**
```typescript
{
  handle: z.string().describe("X handle without @ prefix"),
  max_results: z.number().min(1).max(100).default(20),
  include_replies: z.boolean().default(false).describe("Include reply tweets")
}
```

**Implementation:**
```typescript
const tweets = [];
const iterator = scraper.getTweets(handle, max_results);
for await (const tweet of iterator) {
  if (!include_replies && tweet.inReplyToStatusId) continue;
  tweets.push(normalizeTweet(tweet));
  if (tweets.length >= max_results) break;
}
return { data: tweets, has_more: false };
```

**Returns:** `PaginatedResponse<XPost>`

---

### 6.5 `get_thread` — Full Conversation Thread

**Purpose:** Given any post in a thread, fetch the entire thread in order.

**Parameters:**
```typescript
{
  post: z.string().describe("Tweet ID or URL of any post in the thread"),
  include_replies: z.boolean().default(false).describe("Include replies from other users")
}
```

**Implementation:**

Walk the reply chain. Start from the given tweet, follow `in_reply_to` upward to find the thread root. Then fetch the thread author's tweets and filter to those in the thread chain. Order chronologically.

```typescript
// 1. Get the starting tweet
let current = await scraper.getTweet(extractTweetId(post));

// 2. Walk UP to find thread root
while (current.inReplyToStatusId) {
  const parent = await scraper.getTweet(current.inReplyToStatusId);
  if (!parent || parent.username !== current.username) break; // different author = not a self-thread
  current = parent;
}
const rootId = current.id;

// 3. Walk DOWN from root collecting thread tweets
// Fetch the author's recent tweets and filter to those in the thread
// (agent-twitter-client doesn't have a direct "get thread" method)
// Alternative: use the conversation_id if available in tweet data
```

This is the trickiest tool to implement. If `agent-twitter-client` exposes `conversationId` on tweet objects, use that to filter. Otherwise, implement the walk-up/walk-down approach above.

**Returns:** `PaginatedResponse<XPost>` (ordered chronologically)

---

### 6.6 `get_article` — X Article (Long-form)

**Purpose:** Fetch an X article by URL or ID.

**Parameters:**
```typescript
{
  url: z.string().describe("URL of the X article")
}
```

**Implementation:**
```typescript
// agent-twitter-client v0.0.19 added getArticle()
const article = await scraper.getArticle(url);
return normalizeArticle(article);
```

Note: Verify `getArticle()` method signature in agent-twitter-client. If it doesn't exist or doesn't work, fall back to fetching the tweet that contains the article and extracting the article URL/content.

**Returns:** `XArticle`

---

### 6.7 `get_user_profile` — User Profile Data

**Parameters:**
```typescript
{
  handle: z.string().describe("X handle without @ prefix")
}
```

**Implementation:**
```typescript
const profile = await scraper.getProfile(handle);
return normalizeProfile(profile);
```

**Returns:** `XUserProfile`

---

### 6.8 `get_home_timeline` — Home Timeline

**Parameters:**
```typescript
{
  max_results: z.number().min(1).max(100).default(20)
}
```

**Implementation:**
```typescript
const tweets = await scraper.fetchHomeTimeline(max_results);
return { data: tweets.map(normalizeTweet), has_more: true };
```

**Returns:** `PaginatedResponse<XPost>`

---

### 6.9 `list_bookmarks` — Paginated Bookmark Listing

**Purpose:** Fetch the user's bookmarked posts with full raw data. Paginated — bookmarks can be large.

**Parameters:**
```typescript
{
  max_results: z.number().min(1).max(100).default(20),
  cursor: z.string().optional().describe("Pagination cursor from previous response")
}
```

**Implementation (`src/clients/graphql.ts`):**

This tool uses the Twitter internal GraphQL API directly because agent-twitter-client does not support bookmarks. Reuse the session cookies (`ct0`, `auth_token`) obtained during login.

```typescript
const BOOKMARK_TIMELINE_URL = 'https://x.com/i/api/graphql/{queryId}/BookmarkTimeline';

// The queryId changes periodically. It can be extracted from Twitter's
// main.js bundle, or hardcoded and updated when it breaks. Known approach:
// Fetch https://x.com and parse the main JS bundle for the BookmarkTimeline
// query ID. Or use a known-working queryId and handle failures gracefully.

async function fetchBookmarks(ct0: string, authToken: string, cursor?: string, count = 20) {
  const variables = {
    count,
    includePromotedContent: false,
    ...(cursor ? { cursor } : {})
  };

  const features = {
    // Required feature flags — these change occasionally
    // Reference: https://github.com/fa0311/TwitterInternalAPIDocument
    graphql_timeline_v2_bookmark_timeline: true,
    rweb_tipjar_consumption_enabled: true,
    responsive_web_graphql_exclude_directive_enabled: true,
    verified_phone_label_enabled: false,
    creator_subscriptions_tweet_preview_api_enabled: true,
    responsive_web_graphql_timeline_navigation_enabled: true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    communities_web_enable_tweet_community_results_fetch: true,
    c9s_tweet_anatomy_moderator_badge_enabled: true,
    articles_preview_enabled: true,
    responsive_web_edit_tweet_api_enabled: true,
    tweetypie_unmention_optimization_enabled: true,
    responsive_web_uc_gql_enabled: true,
    vibe_api_enabled: true,
    responsive_web_tweet_result_extensions_enabled: true,
    freedom_of_speech_not_reach_fetch_enabled: true,
    standardized_nudges_misinfo: true,
    tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
    responsive_web_media_download_video_enabled: true,
    longform_notetweets_inline_media_enabled: true,
    responsive_web_enhance_cards_enabled: false
  };

  const params = new URLSearchParams({
    variables: JSON.stringify(variables),
    features: JSON.stringify(features)
  });

  const response = await fetch(`${BOOKMARK_TIMELINE_URL}?${params}`, {
    headers: {
      'Authorization': `Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs=1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA`,
      'Cookie': `ct0=${ct0}; auth_token=${authToken}`,
      'X-Csrf-Token': ct0,
      'Content-Type': 'application/json',
      'X-Twitter-Active-User': 'yes',
      'X-Twitter-Auth-Type': 'OAuth2Session',
      'X-Twitter-Client-Language': 'en'
    }
  });

  const data = await response.json();

  // Parse the GraphQL response — timeline entries are nested deep
  // data.data.bookmark_timeline_v2.timeline.instructions[0].entries
  const entries = data.data?.bookmark_timeline_v2?.timeline?.instructions
    ?.find((i: any) => i.type === 'TimelineAddEntries')
    ?.entries || [];

  const tweets = entries
    .filter((e: any) => e.content?.entryType === 'TimelineTimelineItem')
    .map((e: any) => e.content.itemContent.tweet_results.result)
    .map(normalizeGraphQLTweet);  // Need a separate normalizer for GraphQL tweet shape

  const nextCursor = entries
    .find((e: any) => e.content?.cursorType === 'Bottom')
    ?.content?.value;

  return {
    data: tweets,
    cursor: nextCursor,
    has_more: !!nextCursor
  };
}
```

**IMPORTANT:** The `Authorization` bearer token above is Twitter's public/static bearer token used by the web client. It is NOT a user-specific token. It is the same for all users and is embedded in Twitter's public JavaScript bundle. The user-specific auth comes from the cookies (`ct0` + `auth_token`).

**GraphQL Response Normalizer:**

The GraphQL API returns tweets in a different shape than agent-twitter-client. Write a `normalizeGraphQLTweet()` function:

```typescript
function normalizeGraphQLTweet(result: any): XPost {
  const tweet = result.legacy || result;
  const user = result.core?.user_results?.result?.legacy;
  return {
    id: tweet.id_str,
    text: tweet.full_text,
    author: {
      handle: user?.screen_name,
      name: user?.name,
      id: user?.id_str,
      verified: result.core?.user_results?.result?.is_blue_verified || false
    },
    timestamp: new Date(tweet.created_at).toISOString(),
    metrics: {
      likes: tweet.favorite_count || 0,
      retweets: tweet.retweet_count || 0,
      replies: tweet.reply_count || 0,
      views: parseInt(result.views?.count || '0'),
      bookmarks: tweet.bookmark_count || 0
    },
    media: (tweet.entities?.media || []).map((m: any) => ({
      type: m.type,
      url: m.media_url_https,
      alt: m.ext_alt_text
    })),
    urls: (tweet.entities?.urls || []).map((u: any) => u.expanded_url),
    hashtags: (tweet.entities?.hashtags || []).map((h: any) => h.text),
    mentions: (tweet.entities?.user_mentions || []).map((m: any) => m.screen_name),
    in_reply_to: tweet.in_reply_to_status_id_str || undefined,
    quoted_tweet_id: tweet.quoted_status_id_str || undefined,
    is_thread: false, // Can't reliably determine from bookmark context
    source_url: `https://x.com/${user?.screen_name}/status/${tweet.id_str}`
  };
}
```

**Returns:** `PaginatedResponse<XPost>`

---

### 6.10 `search_bookmarks` — Search Within Bookmarks

**Purpose:** Search within the user's bookmarks by keyword.

**Parameters:**
```typescript
{
  query: z.string().describe("Keyword to search within bookmarks"),
  max_results: z.number().min(1).max(100).default(20),
  cursor: z.string().optional()
}
```

**Implementation:**

Uses the `BookmarkSearchTimeline` GraphQL endpoint. Same auth pattern as `list_bookmarks` but with a different endpoint and query variable:

```typescript
const BOOKMARK_SEARCH_URL = 'https://x.com/i/api/graphql/{queryId}/BookmarkSearchTimeline';

// Same as list_bookmarks but add query to variables:
const variables = {
  count,
  query: params.query,
  includePromotedContent: false,
  ...(cursor ? { cursor } : {})
};
```

Same response parsing and normalization as `list_bookmarks`.

**Returns:** `PaginatedResponse<XPost>`

---

## 7. Grok API Client (`src/clients/grok.ts`)

Minimal client — just a typed `fetch` wrapper:

```typescript
interface GrokSearchParams {
  query: string;
  handles?: string[];
  from_date?: string;
  to_date?: string;
}

interface GrokResponse {
  id: string;
  output: Array<{
    type: string;
    content?: Array<{ type: string; text: string }>;
  }>;
  citations?: string[];
}

async function searchX(params: GrokSearchParams): Promise<GrokResponse> {
  const tools: any[] = [{ type: 'x_search' }];

  // Build tool parameters
  const toolParams: Record<string, any> = {};
  if (params.handles?.length) toolParams.allowed_x_handles = params.handles;
  if (params.from_date) toolParams.from_date = params.from_date;
  if (params.to_date) toolParams.to_date = params.to_date;

  const body = {
    model: process.env.GROK_MODEL || 'grok-4-1-fast-reasoning',
    tools,
    input: `Search X posts for: ${params.query}. Return all relevant posts with their URLs.`,
  };

  const response = await fetch('https://api.x.ai/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.XAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`Grok API error: ${response.status} ${await response.text()}`);
  }

  return response.json();
}
```

**Note on the Grok Responses API:** The exact request shape may need adjustment. The xAI API is OpenAI-compatible but the `tools` parameter for `x_search` uses `type: 'x_search'` (not a function definition). Consult https://docs.x.ai/developers/tools/x-search for the latest request format if the above doesn't work. The key fields are `model`, `tools`, and `input`.

---

## 8. Citation Parser (`src/parsers/citation.ts`)

```typescript
const TWEET_ID_FROM_URL = /x\.com\/(?:i|[a-zA-Z0-9_]+)\/status\/(\d+)/;

/**
 * Extract tweet IDs from Grok x_search citation URLs.
 * Citations come as an array of URLs in the response.
 */
export function extractTweetIds(citations: string[]): string[] {
  const ids = new Set<string>();
  for (const url of citations) {
    const match = url.match(TWEET_ID_FROM_URL);
    if (match) ids.add(match[1]);
  }
  return Array.from(ids);
}

/**
 * Extract a tweet ID from a user-provided string.
 * Accepts: raw ID, full URL, or x.com short URL.
 */
export function extractTweetId(input: string): string {
  // If it's just digits, it's already an ID
  if (/^\d+$/.test(input)) return input;
  // Try to extract from URL
  const match = input.match(TWEET_ID_FROM_URL);
  if (match) return match[1];
  // Also handle twitter.com URLs
  const twitterMatch = input.match(/twitter\.com\/(?:i|[a-zA-Z0-9_]+)\/status\/(\d+)/);
  if (twitterMatch) return twitterMatch[1];
  throw new Error(`Cannot extract tweet ID from: ${input}`);
}
```

---

## 9. MCP Server Entry Point (`src/index.ts`)

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

// Import all tools
// Import auth module

async function main() {
  const server = new McpServer({
    name: 'x-recon',
    version: '1.0.0',
    description: 'X platform search, raw post fetching, and bookmark access'
  });

  // Initialize auth (login + cookie cache)
  const auth = await initAuth();

  // Register all 11 tools with Zod schemas
  // Each tool handler receives validated params and the auth context

  server.tool('search_posts', searchPostsSchema, async (params) => { ... });
  server.tool('search_posts_raw', searchPostsRawSchema, async (params) => { ... });
  server.tool('get_post', getPostSchema, async (params) => { ... });
  server.tool('get_user_posts', getUserPostsSchema, async (params) => { ... });
  server.tool('get_thread', getThreadSchema, async (params) => { ... });
  server.tool('get_article', getArticleSchema, async (params) => { ... });
  server.tool('get_user_profile', getUserProfileSchema, async (params) => { ... });
  server.tool('get_home_timeline', getHomeTimelineSchema, async (params) => { ... });
  server.tool('list_bookmarks', listBookmarksSchema, async (params) => { ... });
  server.tool('search_bookmarks', searchBookmarksSchema, async (params) => { ... });

  // Connect via STDIO
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
```

---

## 10. GraphQL Query ID Discovery

The `BookmarkTimeline` and `BookmarkSearchTimeline` GraphQL endpoints require a `queryId` that Twitter rotates periodically. Strategies to handle this:

### Option A: Hardcode + update on failure (simplest)

```typescript
let BOOKMARK_QUERY_ID = 'sWsI1bCNhlmq_YjPcMEG5Q';  // Known working as of early 2025
let BOOKMARK_SEARCH_QUERY_ID = '4Qb3mVVG4UY6FRq1kfIBJA';  // Known working

// If a 400/404 response comes back, attempt to refresh the query ID
```

### Option B: Scrape from Twitter's JS bundle (resilient)

```typescript
async function discoverQueryIds(): Promise<{ bookmark: string; bookmarkSearch: string }> {
  // 1. Fetch https://x.com (with auth cookies)
  // 2. Find script tags pointing to main.*.js
  // 3. Fetch the JS bundle
  // 4. Regex for BookmarkTimeline queryId: /queryId:"([^"]+)".*?operationName:"BookmarkTimeline"/
  // 5. Same for BookmarkSearchTimeline
}
```

**Recommendation:** Start with Option A. Add Option B as a fallback if the hardcoded ID fails. The query IDs typically last 2-4 weeks before rotation.

---

## 11. Error Handling

All tools should return MCP-compliant error responses:

```typescript
// Tool-level errors
{ isError: true, content: [{ type: 'text', text: 'Post not found: 1234567890' }] }

// Auth errors — suggest user check credentials
{ isError: true, content: [{ type: 'text', text: 'Authentication failed. Check X_USERNAME/X_PASSWORD/X_EMAIL in environment.' }] }

// Rate limit errors — include retry-after if available
{ isError: true, content: [{ type: 'text', text: 'Rate limited. Try again in 60 seconds.' }] }

// Grok API errors — include status code
{ isError: true, content: [{ type: 'text', text: 'Grok API returned 429. API rate limit reached.' }] }
```

### Retry Logic

- agent-twitter-client calls: retry once after 2s on 5xx errors
- Grok API calls: retry once after 3s on 429/5xx
- GraphQL bookmark calls: retry once after 2s, if 400/404 attempt query ID refresh

---

## 12. OpenCode Skill

Create: `~/.config/opencode/skills/x-platform/SKILL.md`

```markdown
---
name: x-platform
description: >
  Search, fetch, and analyze X posts and articles using Grok-powered discovery
  and raw data retrieval. Use when researching topics on X, evaluating bookmarked
  posts, or gathering structured data from the platform. Triggers on X/Twitter
  research, post fetching, bookmark review, social media analysis, or training
  data collection.
---

# X Platform Research & Data Access

## Available MCP Tools

This skill requires the `x-recon` MCP server to be running.

### Search Tools

| Tool | Use When | Example |
|------|----------|---------|
| `search_posts` | You need semantic/intelligent search. Finds posts you'd never match with keywords. | "What are people saying about Solana MEV?" |
| `search_posts_raw` | You need exact keyword/hashtag/user search. Fast, no AI overhead. | `from:VitalikButerin ethereum roadmap` |

### Fetch Tools

| Tool | Use When | Example |
|------|----------|---------|
| `get_post` | You have a specific post ID or URL | `get_post({ post: "https://x.com/user/status/123" })` |
| `get_user_posts` | You want a user's recent output | `get_user_posts({ handle: "elonmusk", max_results: 10 })` |
| `get_thread` | You need full thread context for a post | `get_thread({ post: "123456789" })` |
| `get_article` | You need long-form X article content | `get_article({ url: "https://x.com/..." })` |
| `get_user_profile` | You need user bio, follower counts, etc. | `get_user_profile({ handle: "naval" })` |
| `get_home_timeline` | You want to see what's in the user's feed | `get_home_timeline({ max_results: 20 })` |

### Bookmark Tools

| Tool | Use When | Example |
|------|----------|---------|
| `list_bookmarks` | Browse all saved bookmarks (paginated) | `list_bookmarks({ max_results: 50 })` |
| `search_bookmarks` | Find specific bookmarks by keyword | `search_bookmarks({ query: "DeFi yield" })` |

## Decision Tree

```text
Need to find posts about a topic?
├── Broad/semantic search → search_posts (Grok-powered)
└── Exact keyword/hashtag/handle → search_posts_raw

Have a specific post?
├── By URL or ID → get_post
└── Need full thread → get_thread

Researching a person?
├── Profile info → get_user_profile
└── Their posts → get_user_posts

Working with bookmarks?
├── Browse all → list_bookmarks (use cursor for pagination)
└── Find specific → search_bookmarks

Need articles?
└── get_article
```

## Workflow Patterns

### Topic Research
1. `search_posts({ query: "..." })` — discover relevant posts
2. `get_thread()` on the most engaged posts — get full context
3. Synthesize findings (you do this, not Grok)

### Person Research
1. `get_user_profile({ handle })` — who are they
2. `get_user_posts({ handle, max_results: 30 })` — what do they post about
3. `get_thread()` on key posts — deep context

### Bookmark Review
1. `list_bookmarks({ max_results: 50 })` — get first page
2. Agent evaluates each bookmark for relevance
3. `get_thread()` on promising ones for full context
4. Continue with cursor for more pages

### Training Data Collection
1. `list_bookmarks()` — paginate through ALL bookmarks
2. Or `search_posts_raw()` — collect posts by topic
3. Return structured XPost data for corpus building

## Data Shape

All post tools return `XPost` objects:
- `id`, `text`, `author` (handle, name, verified)
- `timestamp` (ISO 8601)
- `metrics` (likes, retweets, replies, views, bookmarks)
- `media` (photos, videos with URLs)
- `urls`, `hashtags`, `mentions`
- `in_reply_to`, `quoted_tweet_id`
- `source_url` (direct link to post)

All list endpoints return `{ data: XPost[], cursor?: string, has_more: boolean }`.

## Important Notes

- **search_posts** uses your Grok API credits (xAI billing). Use search_posts_raw for high-volume keyword searches to save credits.
- **Bookmarks** are paginated. For large bookmark collections, iterate with the cursor.
- **Rate limiting**: All tools have built-in rate limiting. If you hit limits, wait and retry.
- **All data is raw**: No AI summaries are baked into responses. You handle all analysis.
```

---

## 13. Config Wiring

### OpenCode (`~/.config/opencode/opencode.json`)

Add to the `mcp` section:

```json
"x-recon": {
  "type": "local",
  "command": "node",
  "args": ["/Users/lukewoodward/_workspace/x-recon/dist/index.js"],
  "env": {
    "XAI_API_KEY": "{env:XAI_API_KEY}",
    "X_USERNAME": "{env:X_USERNAME}",
    "X_PASSWORD": "{env:X_PASSWORD}",
    "X_EMAIL": "{env:X_EMAIL}"
  }
}
```

### Claude (`~/.config/Claude/Claude.json`)

Create this file if it doesn't exist:

```json
{
  "mcpServers": {
    "x-recon": {
      "command": "node",
      "args": ["/Users/lukewoodward/_workspace/x-recon/dist/index.js"],
      "env": {
        "XAI_API_KEY": "{env:XAI_API_KEY}",
        "X_USERNAME": "{env:X_USERNAME}",
        "X_PASSWORD": "{env:X_PASSWORD}",
        "X_EMAIL": "{env:X_EMAIL}"
      }
    }
  }
}
```

### Environment Variables

Set in shell profile or `.env` (loaded via 1Password):

```bash
export XAI_API_KEY=$(op read "op://Private/grok-api-key/credential")
export X_USERNAME=$(op read "op://Private/x-login/username")
export X_PASSWORD=$(op read "op://Private/x-login/password")
export X_EMAIL=$(op read "op://Private/x-login/email")
```

Or use `mcp.env` per the user's global rules for `op://` references.

After config changes, run `mcp-sync` to propagate to Cursor.

---

## 14. Build Order

Execute phases sequentially. Each phase should be testable before moving to the next.

### Phase 1: Scaffold
- `npm init`, install dependencies, configure TypeScript
- Create directory structure
- Set up `.env.example`

### Phase 2: Config + Types
- Implement `src/config.ts` (Zod validation of env vars)
- Implement `src/types.ts` (all interfaces)

### Phase 3: Auth
- Implement `src/auth.ts` (login, cookie cache, cookie extraction)
- Test: verify login works and cookies persist

### Phase 4: Clients
- Implement `src/clients/twitter.ts` (agent-twitter-client wrapper)
- Implement `src/clients/grok.ts` (fetch wrapper for xAI API)
- Implement `src/clients/graphql.ts` (bookmark GraphQL client)
- Implement `src/parsers/citation.ts` and `src/parsers/tweet.ts`

### Phase 5: Raw Fetch Tools (no Grok dependency)
- Implement: `get_post`, `get_user_posts`, `get_user_profile`, `get_home_timeline`, `search_posts_raw`, `get_thread`, `get_article`
- Test each individually

### Phase 6: Grok Search Tool
- Implement: `search_posts`
- Test: verify citation extraction and hydration pipeline

### Phase 7: Bookmark Tools
- Implement: `list_bookmarks`, `search_bookmarks`
- Test: verify GraphQL calls with cookie auth

### Phase 8: MCP Server
- Implement `src/index.ts` — wire all tools into MCP server
- Test: run server via STDIO and call tools manually

### Phase 9: Skill + Config
- Create `~/.config/opencode/skills/x-platform/SKILL.md`
- Update `opencode.json` and create `Claude.json`
- Run `mcp-sync`

### Phase 10: Integration Testing
- Test full flow: search → fetch → thread
- Test bookmarks pagination
- Test error handling (bad IDs, rate limits, auth failures)

---

## 15. Future Enhancements

See [`FUTURE.md`](./FUTURE.md) for DDIA-informed enhancement proposals covering tail latency, degradation strategies, defensive parsing, observability, complexity reduction, schema evolution, and pipeline idempotency.
