import { describe, it, expect } from 'vitest';

import { normalizeXApiError } from '../../clients/x-api.js';

describe('normalizeXApiError', () => {
  it('maps HTTP 402 to actionable credits message', () => {
    const err = new Error('HTTP 402 Payment Required');
    const normalized = normalizeXApiError(err, 'list_bookmarks');

    expect(normalized.message).toContain('HTTP 402 Payment Required');
    expect(normalized.message).toContain('needs additional credits');
    expect(normalized.message).toContain('https://console.x.com');
  });

  it('maps auth none errors to config guidance', () => {
    const err = new Error('Authentication required. Available: none.');
    const normalized = normalizeXApiError(err, 'search_posts_raw');

    expect(normalized.message).toContain('authentication not configured');
    expect(normalized.message).toContain('X_API_BEARER_TOKEN and/or');
    expect(normalized.message).toContain('npm run authorize');
  });

  it('maps unauthorized errors to token guidance', () => {
    const err = Object.assign(new Error('Unauthorized'), { status: 401 });
    const normalized = normalizeXApiError(err, 'get_post');

    expect(normalized.message).toContain('request unauthorized');
    expect(normalized.message).toContain('console.x.com');
  });
});
