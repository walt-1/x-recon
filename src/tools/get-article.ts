import { z } from 'zod';
import { extractTweetId } from '../parsers/citation.js';
import { getPost } from '../clients/x-api.js';
import type { XArticle } from '../types.js';

export const getArticleSchema = {
  url: z.string().describe('URL of the X article'),
};

export async function getArticle(params: { url: string }): Promise<XArticle> {
  const id = extractTweetId(params.url);
  const post = await getPost(id);
  const content = post.article?.text ?? post.note_tweet_text ?? post.text;

  return {
    id: post.id,
    title: post.article?.title ?? '',
    content,
    author: {
      handle: post.author.handle,
      name: post.author.name,
      id: post.author.id,
    },
    timestamp: post.timestamp,
    cover_image: post.media[0]?.url,
    source_url: post.source_url,
  };
}
