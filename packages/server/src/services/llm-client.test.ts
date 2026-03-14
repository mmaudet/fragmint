import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LlmClient } from './llm-client.js';

function makeChatResponse(content: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content } }],
    }),
  };
}

describe('LlmClient', () => {
  const config = {
    endpoint: 'http://localhost:11434/v1',
    model: 'mistral-nemo:12b',
    temperature: 0.2,
    timeout: 60000,
  };

  let client: LlmClient;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    client = new LlmClient(config);
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('segment() parses valid JSON array response', async () => {
    const blocks = [
      { title: 'Intro', body: 'Welcome text', type: 'paragraph', lang: 'en' },
      { title: 'Setup', body: 'Install steps', type: 'procedure', lang: 'en' },
    ];
    mockFetch.mockResolvedValueOnce(
      makeChatResponse('```json\n' + JSON.stringify(blocks) + '\n```'),
    );

    const result = await client.segment('# My Doc\nSome content');

    expect(result).toEqual(blocks);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('segment() returns empty array on malformed response', async () => {
    mockFetch.mockResolvedValueOnce(
      makeChatResponse('This is not JSON at all, sorry!'),
    );

    const result = await client.segment('# Doc');

    expect(result).toEqual([]);
  });

  it('classify() parses valid JSON object response', async () => {
    const classification = {
      type: 'procedure',
      domain: 'devops',
      tags: ['docker', 'setup'],
      confidence: 0.92,
    };
    mockFetch.mockResolvedValueOnce(
      makeChatResponse(JSON.stringify(classification)),
    );

    const result = await client.classify(
      'Install Docker on Ubuntu',
      ['procedure', 'reference', 'faq'],
      ['devops', 'frontend', 'backend'],
    );

    expect(result).toEqual(classification);
  });

  it('classify() returns low-confidence fallback on parse error', async () => {
    mockFetch.mockResolvedValueOnce(
      makeChatResponse('I cannot classify this text properly'),
    );

    const result = await client.classify('Some text', ['procedure'], ['devops']);

    expect(result).toEqual({
      type: 'unknown',
      domain: 'unknown',
      tags: [],
      confidence: 0.1,
    });
  });
});
