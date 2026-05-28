// packages/server/src/services/llm-client.ts
import type { UploadHints } from '../schema/trust-source.js';

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

export interface CombinedBlock {
  title: string;
  body: string;
  type: string;
  domain: string;
  function_type: string;
  audience: string[];
  maturity: string;
  lang: string;
  tags: string[];
  entities: {
    clients: string[];
    products: string[];
    technologies: string[];
    partners: string[];
    certifications: string[];
    regulations: string[];
  };
  new_proposals: {
    tags: string[];
    domains: string[];
    entities: Partial<Record<string, string[]>>;
  };
  confidence: number;
}

export class LlmClient {
  constructor(private config: LlmClientConfig) {}

  private async chat(content: string): Promise<string> {
    return this.chatMessages([{ role: 'user', content }]);
  }

  async chatMessages(messages: ChatMessage[], options?: { temperature?: number }): Promise<string> {
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
          temperature: options?.temperature ?? this.config.temperature,
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

  async segmentAndClassify(
    markdown: string,
    validTypes: string[],
    validDomains: string[],
    knownTags: string[] = [],
    domainHints: Record<string, string> = {},
    validFunctions: string[] = [],
    validEntities: Array<{ type: string; canonicalName: string }> = [],
    uploadHints: UploadHints = {},
  ): Promise<CombinedBlock[]> {
    const functionList =
      validFunctions.length > 0
        ? validFunctions.join(' | ')
        : 'technical | commercial | legal | operational | strategic | reference';

    const domainList = validDomains
      .map((d) => (domainHints[d] ? `"${d}": ${domainHints[d]}` : `"${d}"`))
      .join('\n  ');

    const entityListByType = validEntities.reduce<Record<string, string[]>>((acc, e) => {
      if (!acc[e.type]) acc[e.type] = [];
      acc[e.type].push(e.canonicalName);
      return acc;
    }, {});
    const entityBlock = Object.entries(entityListByType)
      .map(([type, names]) => `  ${type}s: ${names.join(', ')}`)
      .join('\n');

    const tagHint =
      knownTags.length > 0
        ? `Use tags from this list when relevant: ${JSON.stringify(knownTags.slice(0, 60))}. For new tags not in the list, prefix with "NEW:" (e.g. "NEW:edge-computing"). All tags must be English lowercase kebab-case.`
        : 'English lowercase kebab-case only. Prefix unknown ones with "NEW:".';

    const hasAnyHint = !!(
      uploadHints.domain ||
      uploadHints.function_type ||
      uploadHints.maturity ||
      uploadHints.audience?.length ||
      uploadHints.tags?.length ||
      uploadHints.entities?.length
    );
    const hintsBlock = hasAnyHint
      ? `\n# Operator hints (high confidence — prefer these unless content clearly contradicts them)\n${
          uploadHints.domain ? `- domain: ${uploadHints.domain}\n` : ''
        }${uploadHints.function_type ? `- function_type: ${uploadHints.function_type}\n` : ''}${
          uploadHints.audience?.length ? `- audience: ${uploadHints.audience.join(', ')}\n` : ''
        }${uploadHints.maturity ? `- maturity: ${uploadHints.maturity}\n` : ''}${
          uploadHints.tags?.length ? `- tags (suggested): ${uploadHints.tags.join(', ')}\n` : ''
        }${
          uploadHints.entities?.length
            ? `- entities (suggested): ${uploadHints.entities.join(', ')}\n`
            : ''
        }`
      : '';

    const prompt = `You are a document analysis assistant.
Extract reusable content blocks from the document and classify each one using structured metadata.

# Extraction rules
- body: EXACT verbatim text from the document. Do NOT translate, paraphrase, or summarize.
- title: short label (3-8 words) in the SAME language as the body. Do NOT write an English title for French content.
- lang: ISO 639-1 code of the body language (fr, en, ...)

# Classification rules

## domain — the subject area or product this block is about. MUST be one of:
  ${domainList}
  Use "other" for content not clearly tied to one specific domain.
  If the content belongs to a domain NOT in the list, add it to new_proposals.domains with "NEW:" prefix.

## function_type — the rhetorical function of this block. MUST be one of:
  ${functionList}

## type — the content type. MUST be one of:
  ${JSON.stringify(validTypes)}

  Type disambiguation (use these definitions to pick the right type):
  - "introduction": general product/company/service overview
  - "argument": commercial or technical argument, competitive advantage
  - "use-case": generic usage scenario WITHOUT naming a specific client or organization
  - "reference": named organization's deployment with specific context or measurable results (référence client)
  - "testimonial": direct quote or explicit endorsement from a named client
  - "methodology": technical approach, architecture, process description
  - "pricing": pricing, offers, licensing models
  - "faq": questions and answers format
  - "clause": contractual clause, SLA, legal commitment
  - "engagement": service commitment, guarantee, support level
  - "conclusion": synthesis, closing statement
  - "bio": person or organization profile
  KEY DISTINCTION — "use-case" vs "reference":
    → "reference" if: a named organization is cited + specific deployment details OR measurable results
    → "use-case" if: describes a generic scenario or workflow without naming a real client

## audience — who this block targets. JSON array with 1-3 values from:
  ["technical", "decision-maker", "user", "legal"]

## maturity — lifecycle stage of the described feature/offer. MUST be one of:
  production | beta | roadmap | archive

## entities — use canonical names from the referential. Use exact spelling.
${entityBlock || '  (no referential available — use best judgment)'}
  If you detect an entity NOT in the referential above, add it to new_proposals.entities with "NEW:" prefix.

## tags — ${tagHint}
${hintsBlock}
# Document
${markdown}

## confidence — your confidence that ALL classification fields are correct (0–1).
  Scale: 0.95+ only when all metadata is unambiguous. 0.70-0.94 when confident
  but some ambiguity exists. 0.50-0.69 when uncertain. Below 0.50 when likely
  misclassified. Default toward lower values when unsure.

Return ONLY a valid JSON array. Each element must contain ALL fields:
[
  {
    "title": "...",
    "body": "...",
    "domain": "...",
    "function_type": "...",
    "type": "...",
    "audience": ["technical"],
    "maturity": "production",
    "lang": "fr",
    "tags": ["open-source"],
    "entities": {
      "clients": [], "products": [], "technologies": [],
      "partners": [], "certifications": [], "regulations": []
    },
    "new_proposals": {
      "tags": [],
      "domains": [],
      "entities": {}
    },
    "confidence": 0.72
  }
]`;

    try {
      const response = await this.chat(prompt);
      const json = this.extractJson(response, true);
      if (!json) return [];
      const parsed = JSON.parse(json);
      if (!Array.isArray(parsed)) return [];
      return parsed as CombinedBlock[];
    } catch {
      return [];
    }
  }

  async classify(
    blockText: string,
    existingTypes: string[],
    existingDomains: string[],
    knownTags: string[] = [],
  ): Promise<Classification> {
    const tagHint =
      knownTags.length > 0
        ? `Prefer tags from this known list when relevant: ${JSON.stringify(knownTags)}. You may add new tags if needed, but they MUST be in English.`
        : 'MUST be in English, lowercase, single words or hyphen-separated. Never use French words.';
    const prompt = `You are a content classification assistant. Classify the following text block.

- type: the rhetorical function of the block. Choose the BEST match from: ${JSON.stringify(existingTypes)}.
- domain: the SUBJECT MATTER (which product or thematic area this is about). Choose the BEST match from: ${JSON.stringify(existingDomains)}. Domain is about WHAT the text is about, not HOW it is written. A technical paragraph about Twake → domain "twake", not "technical".
- tags: keywords describing the nature and audience of the content. ${tagHint}
- confidence: your confidence in this classification (0–1).
  Scale: 0.95+ only when all metadata is unambiguous. 0.70-0.94 when confident
  but some ambiguity exists. 0.50-0.69 when uncertain. Below 0.50 when likely
  misclassified. Default toward lower values when unsure.

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
