// packages/server/src/services/llm-client.ts

export interface LlmClientConfig {
  endpoint: string;
  model: string;
  temperature: number;
  timeout: number;
}

export interface SegmentBlock {
  title: string;
  body: string;
  type: string;
  lang: string;
}

export interface Classification {
  type: string;
  domain: string;
  tags: string[];
  confidence: number;
}

export class LlmClient {
  constructor(private config: LlmClientConfig) {}

  private async chat(content: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const res = await fetch(`${this.config.endpoint}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.config.model,
          temperature: this.config.temperature,
          messages: [{ role: 'user', content }],
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`LLM request failed: ${res.status} ${res.statusText}`);
      }

      const data = (await res.json()) as {
        choices: Array<{ message: { content: string } }>;
      };
      return data.choices[0]?.message?.content ?? '';
    } finally {
      clearTimeout(timer);
    }
  }

  private extractJson(text: string, expectArray: boolean): string | null {
    if (expectArray) {
      const arrayMatch = text.match(/\[[\s\S]*\]/);
      if (arrayMatch) return arrayMatch[0];
    } else {
      const objectMatch = text.match(/\{[\s\S]*\}/);
      if (objectMatch) return objectMatch[0];
    }
    return null;
  }

  async segment(markdown: string): Promise<SegmentBlock[]> {
    const prompt = `You are a content segmentation assistant. Analyze the following markdown document and identify reusable content blocks. Return a JSON array where each element has: title (string), body (string), type (string), lang (string).

Document:
${markdown}

Return ONLY a JSON array.`;

    try {
      const response = await this.chat(prompt);
      const json = this.extractJson(response, true);
      if (!json) return [];
      const parsed = JSON.parse(json);
      if (!Array.isArray(parsed)) return [];
      return parsed as SegmentBlock[];
    } catch {
      return [];
    }
  }

  async classify(
    blockText: string,
    existingTypes: string[],
    existingDomains: string[],
  ): Promise<Classification> {
    const prompt = `You are a content classification assistant. Classify the following text block. Available types: ${JSON.stringify(existingTypes)}. Available domains: ${JSON.stringify(existingDomains)}.

Text:
${blockText}

Return a JSON object with: type (string), domain (string), tags (string array), confidence (number 0-1).`;

    const fallback: Classification = {
      type: 'unknown',
      domain: 'unknown',
      tags: [],
      confidence: 0.1,
    };

    try {
      const response = await this.chat(prompt);
      const json = this.extractJson(response, false);
      if (!json) return fallback;
      const parsed = JSON.parse(json);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return fallback;
      return parsed as Classification;
    } catch {
      return fallback;
    }
  }
}
