import { loadConfig } from '../config.js';

export interface GrokSearchParams {
  query: string;
  handles?: string[];
  from_date?: string;
  to_date?: string;
}

export interface GrokOutputMessage {
  type: 'message';
  role: string;
  content: Array<{
    type: string;
    text: string;
    annotations?: Array<{
      type: string;
      url?: string;
      title?: string;
    }>;
  }>;
}

export interface GrokSearchCall {
  type: 'x_search_call';
  id: string;
  status: string;
}

export type GrokOutputItem = GrokOutputMessage | GrokSearchCall;

export interface GrokResponse {
  id: string;
  output: GrokOutputItem[];
}

/**
 * Extract plain text from a Grok response.
 */
export function extractGrokText(response: GrokResponse): string {
  const parts: string[] = [];
  for (const item of response.output) {
    if (item.type === 'message') {
      for (const block of item.content) {
        if (block.type === 'output_text' && block.text) {
          parts.push(block.text);
        }
      }
    }
  }
  return parts.join('\n');
}

/**
 * Extract citation URLs from a Grok response (from annotations).
 */
export function extractCitations(response: GrokResponse): string[] {
  const urls: string[] = [];
  for (const item of response.output) {
    if (item.type === 'message') {
      for (const block of item.content) {
        if (block.annotations) {
          for (const ann of block.annotations) {
            if (ann.url) urls.push(ann.url);
          }
        }
      }
    }
  }
  return urls;
}

export async function searchX(params: GrokSearchParams): Promise<GrokResponse> {
  const config = loadConfig();

  const tool: Record<string, any> = { type: 'x_search' };
  if (params.handles?.length) tool.allowed_x_handles = params.handles;
  if (params.from_date) tool.from_date = params.from_date;
  if (params.to_date) tool.to_date = params.to_date;

  const body = {
    model: config.GROK_MODEL,
    tools: [tool],
    input: [
      {
        role: 'user',
        content: `Search X posts for: ${params.query}. Return all relevant posts with their URLs.`,
      },
    ],
  };

  const response = await fetch('https://api.x.ai/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.XAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Grok API error ${response.status}: ${text}`);
  }

  return response.json() as Promise<GrokResponse>;
}
