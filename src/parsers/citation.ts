const TWEET_ID_FROM_X_URL = /x\.com\/(?:i|[a-zA-Z0-9_]+)\/status\/(\d+)/;
const TWEET_ID_FROM_TWITTER_URL = /twitter\.com\/(?:i|[a-zA-Z0-9_]+)\/status\/(\d+)/;

/**
 * Extract tweet IDs from Grok x_search citation URLs.
 * Deduplicates and preserves order.
 */
export function extractTweetIds(citations: string[]): string[] {
  const ids = new Set<string>();
  for (const url of citations) {
    const id = matchTweetId(url);
    if (id) ids.add(id);
  }
  return Array.from(ids);
}

/**
 * Extract a tweet ID from a user-provided string.
 * Accepts: raw numeric ID, full x.com URL, twitter.com URL.
 */
export function extractTweetId(input: string): string {
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) return trimmed;

  const id = matchTweetId(trimmed);
  if (id) return id;

  throw new Error(`Cannot extract tweet ID from: ${input}`);
}

function matchTweetId(input: string): string | null {
  const xMatch = input.match(TWEET_ID_FROM_X_URL);
  if (xMatch) return xMatch[1];

  const twitterMatch = input.match(TWEET_ID_FROM_TWITTER_URL);
  if (twitterMatch) return twitterMatch[1];

  return null;
}

const TWEET_URL_IN_TEXT_RE = /(?:x\.com|twitter\.com)\/(?:i|[a-zA-Z0-9_]+)\/status\/(\d+)/g;

export function extractTweetIdsFromUrls(urls: string[]): string[] {
  const ids = new Set<string>();
  for (const url of urls) {
    const id = matchTweetId(url);
    if (id) ids.add(id);
  }
  return Array.from(ids);
}

export function extractTweetIdsFromText(text: string): string[] {
  const ids = new Set<string>();
  for (const match of text.matchAll(TWEET_URL_IN_TEXT_RE)) {
    ids.add(match[1]);
  }
  return Array.from(ids);
}
