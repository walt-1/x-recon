import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config.js', () => ({
  loadConfig: () => ({
    XAI_API_KEY: 'test-xai-key',
    X_API_BEARER_TOKEN: 'test-bearer',
    GROK_MODEL: 'grok-test-model',
    LOG_LEVEL: 'info',
  }),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { searchX, extractGrokText, extractCitations } from '../../clients/grok.js';

describe('searchX', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mockOkResponse(body: any) {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(body),
    });
  }

  function mockErrorResponse(status: number, text: string) {
    mockFetch.mockResolvedValue({
      ok: false,
      status,
      text: () => Promise.resolve(text),
    });
  }

  it('sends POST to the correct URL', async () => {
    mockOkResponse({ id: '1', output: [] });
    await searchX({ query: 'test' });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.x.ai/v1/responses',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('includes Authorization header with API key', async () => {
    mockOkResponse({ id: '1', output: [] });
    await searchX({ query: 'test' });

    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers['Authorization']).toBe('Bearer test-xai-key');
  });

  it('sends input as message array (bug fix #1)', async () => {
    mockOkResponse({ id: '1', output: [] });
    await searchX({ query: 'my search' });

    const [, options] = mockFetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.input).toEqual([
      { role: 'user', content: expect.stringContaining('my search') },
    ]);
  });

  it('includes model and tools in request body', async () => {
    mockOkResponse({ id: '1', output: [] });
    await searchX({ query: 'my search' });

    const [, options] = mockFetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.model).toBe('grok-test-model');
    expect(body.tools).toEqual([{ type: 'x_search' }]);
  });

  it('puts tool params on tool object, not body.parameters (bug fix #2)', async () => {
    mockOkResponse({ id: '1', output: [] });
    await searchX({ query: 'test', handles: ['user1'], from_date: '2025-01-01', to_date: '2025-12-31' });

    const [, options] = mockFetch.mock.calls[0];
    const body = JSON.parse(options.body);
    // Tool params should be ON the tool object
    expect(body.tools[0].allowed_x_handles).toEqual(['user1']);
    expect(body.tools[0].from_date).toBe('2025-01-01');
    expect(body.tools[0].to_date).toBe('2025-12-31');
    // NOT on body.parameters
    expect(body.parameters).toBeUndefined();
  });

  it('omits tool params when none provided', async () => {
    mockOkResponse({ id: '1', output: [] });
    await searchX({ query: 'basic' });

    const [, options] = mockFetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.tools).toEqual([{ type: 'x_search' }]);
    expect(body.tools[0].allowed_x_handles).toBeUndefined();
  });

  it('returns parsed JSON on success', async () => {
    const response = { id: '1', output: [{ type: 'message', role: 'assistant', content: [] }] };
    mockOkResponse(response);

    const result = await searchX({ query: 'test' });
    expect(result).toEqual(response);
  });

  it('throws on non-ok response with status and body', async () => {
    mockErrorResponse(429, 'Rate limit exceeded');

    await expect(searchX({ query: 'test' })).rejects.toThrow('Grok API error 429: Rate limit exceeded');
  });

  it('throws on server error', async () => {
    mockErrorResponse(500, 'Internal server error');

    await expect(searchX({ query: 'test' })).rejects.toThrow('Grok API error 500');
  });
});

describe('extractGrokText', () => {
  it('extracts text from output messages', () => {
    const response = {
      id: '1',
      output: [
        {
          type: 'message' as const,
          role: 'assistant',
          content: [
            { type: 'output_text', text: 'Hello' },
            { type: 'output_text', text: 'World' },
          ],
        },
      ],
    };
    expect(extractGrokText(response)).toBe('Hello\nWorld');
  });

  it('skips x_search_call items', () => {
    const response = {
      id: '1',
      output: [
        { type: 'x_search_call' as const, id: 'call1', status: 'completed' },
        {
          type: 'message' as const,
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Result' }],
        },
      ],
    };
    expect(extractGrokText(response)).toBe('Result');
  });

  it('returns empty string for empty output', () => {
    expect(extractGrokText({ id: '1', output: [] })).toBe('');
  });
});

describe('extractCitations', () => {
  it('extracts URLs from annotations (bug fix #3)', () => {
    const response = {
      id: '1',
      output: [
        {
          type: 'message' as const,
          role: 'assistant',
          content: [
            {
              type: 'output_text',
              text: 'Some text',
              annotations: [
                { type: 'url_citation', url: 'https://x.com/user/status/123' },
                { type: 'url_citation', url: 'https://x.com/user/status/456' },
              ],
            },
          ],
        },
      ],
    };
    expect(extractCitations(response)).toEqual([
      'https://x.com/user/status/123',
      'https://x.com/user/status/456',
    ]);
  });

  it('returns empty array when no annotations', () => {
    const response = {
      id: '1',
      output: [
        {
          type: 'message' as const,
          role: 'assistant',
          content: [{ type: 'output_text', text: 'No citations' }],
        },
      ],
    };
    expect(extractCitations(response)).toEqual([]);
  });
});
