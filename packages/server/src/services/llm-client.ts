// packages/server/src/services/llm-client.ts

export interface LlmClientConfig {
  endpoint: string;
  model: string;
  temperature: number;
  timeout: number;
  apiKey?: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
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
    return this.chatMessages([{ role: 'user', content }]);
  }

  async chatMessages(messages: ChatMessage[]): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (this.config.apiKey) {
        headers.Authorization = `Bearer ${this.config.apiKey}`;
      }
      const res = await fetch(`${this.config.endpoint}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: this.config.model,
          temperature: this.config.temperature,
          messages,
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

  async segment(markdown: string, validTypes: string[]): Promise<SegmentBlock[]> {
    const typeList = validTypes.join(', ');
    const prompt = `You are a content segmentation assistant. Extract reusable content blocks from the following document.

Rules:
- body: copy the EXACT original text verbatim. Do NOT translate, paraphrase, or summarize. Preserve the source language.
- title: a short label (3-8 words) in the SAME language as the body. Do NOT write an English title for French content. Do NOT write a French title for English content.
- type: MUST be one of: ${typeList}. Do NOT use any other value.
- lang: ISO 639-1 code (fr, en, de, ...).

Document:
${markdown}

Return ONLY a JSON array where each element has: title (string), body (string), type (string), lang (string).`;

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
    const prompt = `You are a content classification assistant. Classify the following text block.

- type: the rhetorical function of the block. Choose the BEST match from: ${JSON.stringify(existingTypes)}.
- domain: the SUBJECT MATTER (which product or thematic area this is about). Choose the BEST match from: ${JSON.stringify(existingDomains)}. Domain is about WHAT the text is about, not HOW it is written. A technical paragraph about Twake → domain "twake", not "technical".
- tags: keywords describing the nature and audience of the content. MUST be in English, lowercase, single words or hyphen-separated (e.g. ["technical", "commercial", "legal", "sla", "security", "pricing"]). Never use French words.
- confidence: your confidence in this classification (0–1).

Do not invent domain or type values outside the provided lists. Use "other" if nothing fits.

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
