import { z } from 'zod';
import { tagPost, untagPost } from '../db/index.js';

export const tagPostsSchema = {
  post_ids: z.array(z.string()).min(1).describe('Post IDs to tag'),
  tags: z.array(z.string()).min(1).describe('Tags to apply'),
  remove: z.boolean().default(false).describe('If true, remove these tags instead of adding them'),
};

export async function tagPostsHandler(params: {
  post_ids: string[];
  tags: string[];
  remove: boolean;
}) {
  let changes = 0;

  for (const postId of params.post_ids) {
    for (const tag of params.tags) {
      if (params.remove) {
        untagPost(postId, tag);
      } else {
        tagPost(postId, tag);
      }
      changes++;
    }
  }

  return {
    action: params.remove ? 'removed' : 'added',
    changes,
    post_count: params.post_ids.length,
    tag_count: params.tags.length,
  };
}
