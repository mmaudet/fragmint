import { listPayloadSchemas } from '../schema/payload-schemas.js';
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
  lang: string;
  tags: string[];
  new_proposals: {
    tags: string[];
    domains: string[];
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
    uploadHints: UploadHints = {},
  ): Promise<CombinedBlock[]> {
    const domainList = validDomains
      .map((d) => (domainHints[d] ? `"${d}": ${domainHints[d]}` : `"${d}"`))
      .join('\n  ');

    const tagHint =
      knownTags.length > 0
        ? `Use tags from this list when relevant: ${JSON.stringify(knownTags.slice(0, 60))}. For new tags not in the list, prefix with "NEW:" (e.g. "NEW:edge-computing"). All tags must be English lowercase kebab-case.`
        : 'English lowercase kebab-case only. Prefix unknown ones with "NEW:".';

    const hasAnyHint = !!(
      uploadHints.domain ||
      uploadHints.tags?.length
    );
    const hasClientTag = uploadHints.tags?.some((t) => t.startsWith('client:')) ?? false;
    const hintsBlock = hasAnyHint
      ? `\n# Operator hints (orientation — apply where relevant, not systematically to every block)\n${
          uploadHints.domain ? `- domain (suggested): ${uploadHints.domain}\n` : ''
        }${
          uploadHints.tags?.length ? `- tags (suggested): ${uploadHints.tags.join(', ')}\n` : ''
        }${
          hasClientTag
            ? `RULE — named-reference hints (client:*, produit:*, partner:*): apply these ONLY if the fragment body explicitly names or directly discusses that specific client, product, or organization. Generic contractual clauses, SLA commitments, methodology sections, and capability descriptions do NOT qualify unless the named reference appears in the text. Domain and general thematic tags (open-source, sovereignty, etc.) may be inferred from context — named references may not.\n`
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

## tags — ${tagHint}

  Entity tags — identify named organizations, products, and technologies using prefixed tags:
  Prefix format: client:name, produit:name, tech:name, partner:name, cert:name, reg:name
  Use lowercase kebab-case after the colon. Examples: client:dgfip, produit:linshare, tech:apache-james, cert:iso-27001, reg:rgpd
  Apply entity tags ONLY when the fragment body explicitly names the organization/product/technology.
  New entity proposals: prefix with NEW: (e.g. NEW:client:some-new-client). These go into new_proposals.tags.
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
    "type": "...",
    "lang": "fr",
    "tags": ["open-source"],
    "new_proposals": {
      "tags": [],
      "domains": []
    },
    "confidence": 0.72
  }
]`;

    try {
      const response = await this.chat(prompt);
      const json = this.extractJson(response, true);
      if (!json) {
        console.warn('[llm-client][segmentAndClassify] no JSON array in response — first 300 chars:', response.slice(0, 300));
        return [];
      }
      const parsed = JSON.parse(json);
      if (!Array.isArray(parsed)) return [];
      return parsed as CombinedBlock[];
    } catch (err) {
      console.error('[llm-client][segmentAndClassify] failed:', err instanceof Error ? err.message : err);
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

  async inferPayloadSchema(
    headers: string[],
    sampleRow: Record<string, string>,
  ): Promise<string> {
    const schemas = listPayloadSchemas();
    const known = schemas.map((s) => s.id);
    const schemaList = schemas
      .map((s) => `- ${s.id}: ${s.label} (champs: ${Object.keys((s.fields as any).shape ?? {}).join(', ')})`)
      .join('\n');

    const prompt = `Tu analyses les colonnes d'un tableau extrait d'un document.

En-têtes : ${headers.join(', ')}
Exemple de ligne : ${JSON.stringify(sampleRow)}

Schémas disponibles :
${schemaList}

Réponds UNIQUEMENT avec l'identifiant du schéma le plus adapté (ex: "pricing-line-v1"). Si aucun ne correspond, réponds "generic-row-v1". Aucune explication.`;

    try {
      const result = await this.chat(prompt);
      const id = result.trim().replace(/['"]/g, '');
      return known.includes(id) ? id : 'generic-row-v1';
    } catch {
      return 'generic-row-v1';
    }
  }
}
