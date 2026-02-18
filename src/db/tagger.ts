import { loadConfig } from '../config.js';
import type { XPost } from '../types.js';

export const TAG_TAXONOMY = [
  'solana-validator',
  'solana-defi',
  'solana-ecosystem',
  'ethereum',
  'bitcoin',
  'venture-capital',
  'macro-analysis',
  'market-making',
  'onchain-lending',
  'defi-general',
  'mev',
  'infrastructure',
  'regulation',
  'stablecoins',
  'nft',
  'ai-crypto',
  'trading',
  'security',
  'other',
] as const;

export type Tag = (typeof TAG_TAXONOMY)[number];

const TAG_SET = new Set<string>(TAG_TAXONOMY);

const BATCH_SIZE = 20;

/**
 * Auto-tag a batch of posts using Grok classification.
 * Returns a Map of post ID → array of valid tags.
 * On failure, returns an empty map (posts stored untagged).
 */
export async function autoTagPosts(posts: XPost[]): Promise<Map<string, string[]>> {
  if (posts.length === 0) return new Map();

  const results = new Map<string, string[]>();

  // Process in chunks of BATCH_SIZE
  for (let i = 0; i < posts.length; i += BATCH_SIZE) {
    const chunk = posts.slice(i, i + BATCH_SIZE);
    try {
      const chunkResults = await tagBatch(chunk);
      for (const [id, tags] of chunkResults) {
        results.set(id, tags);
      }
    } catch (err) {
      console.error('[x-recon] Auto-tagging batch failed, skipping:', err);
      // Graceful fallback: posts remain untagged
    }
  }

  return results;
}

async function tagBatch(posts: XPost[]): Promise<Map<string, string[]>> {
  const config = loadConfig();

  const postSummaries = posts.map(p => {
    const text = (p.note_tweet_text ?? p.text).slice(0, 280);
    return `- ID: ${p.id} | @${p.author.handle}: ${text}`;
  }).join('\n');

  const prompt = `Classify each post into 1-3 tags from this taxonomy:
${TAG_TAXONOMY.join(', ')}

Posts:
${postSummaries}

Return a JSON object mapping each post ID to an array of tags. Example:
{"1234": ["solana-validator", "infrastructure"], "5678": ["trading"]}

Only use tags from the taxonomy above. Return ONLY the JSON object, no other text.`;

  const response = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.XAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.GROK_TAGGING_MODEL,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Grok tagging API error ${response.status}: ${text}`);
  }

  const data = await response.json() as {
    choices: Array<{ message: { content: string } }>;
  };

  const content = data.choices?.[0]?.message?.content;
  if (!content) return new Map();

  const parsed = JSON.parse(content) as Record<string, string[]>;
  const result = new Map<string, string[]>();

  for (const [id, tags] of Object.entries(parsed)) {
    if (!Array.isArray(tags)) continue;
    const validTags = tags.filter(t => TAG_SET.has(t));
    if (validTags.length > 0) {
      result.set(id, validTags);
    }
  }

  return result;
}
