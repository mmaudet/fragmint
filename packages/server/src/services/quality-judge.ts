// packages/server/src/services/quality-judge.ts
// LLM-as-judge: quality evaluation + metadata suggestions for harvest candidates
import type { LlmClient } from './llm-client.js';
import type { CoherenceFlag } from './quality-signals.js';

export interface JudgeVerdict {
  verdict: 'pass' | 'partial' | 'fail';
  reason: string;
}

export interface SuggestedMetadata {
  type?: string;
  domain?: string;
  tags?: string[];
  reason: string;
}

export interface JudgeResult {
  reusability: JudgeVerdict;
  semantic_coherence: JudgeVerdict;
  classification_accuracy: JudgeVerdict;
  overall_recommendation: 'accept' | 'review' | 'reject';
  overall_reason: string;
  suggested_metadata?: SuggestedMetadata;
}

// Run on all non-duplicate fragments — suggestions are valuable even for clean content
export function shouldRunJudge(_signals: CoherenceFlag[], hasDuplicate: boolean): boolean {
  return !hasDuplicate;
}

export async function runQualityJudge(
  llmClient: LlmClient,
  block: {
    title: string;
    body: string;
    domain: string;
    function_type?: string | null;
    type: string;
    audience?: string[];
    entities?: Record<string, string[]>;
  },
  signals: CoherenceFlag[],
  taxonomy?: { domains: string[]; types: string[]; tags: string[] },
): Promise<JudgeResult | null> {
  const signalsSummary = signals.length > 0
    ? signals.map((s) => `- [${s.level.toUpperCase()}] ${s.type}: ${s.message}`).join('\n')
    : '- No issues detected';

  const taxonomySection = taxonomy
    ? `
# Corpus referential (validated values in the library)
Domains: ${taxonomy.domains.join(', ')}
Types: ${taxonomy.types.join(', ')}
Tags (validated): ${taxonomy.tags.slice(0, 40).join(', ')}${taxonomy.tags.length > 40 ? '...' : ''}`
    : '';

  const prompt = `You are evaluating the quality of a content fragment extracted from a Linagora commercial document.

# Fragment to evaluate
Title: ${block.title}
Body: ${block.body}

# Metadata assigned by ingestion
Domain: ${block.domain} / Function: ${block.function_type ?? 'unknown'} / Type: ${block.type}
Audience: ${(block.audience ?? []).join(', ')} / Entities: ${JSON.stringify(block.entities ?? {})}

# Quality signals already detected
${signalsSummary}
${taxonomySection}

# Your task
Evaluate along 3 dimensions. For each: verdict "pass" | "partial" | "fail" + 1-sentence reason.

## Dimension 1: Reusability
Can this fragment be inserted as-is in another proposal without requiring external context?
PASS: stands alone, no "as mentioned above", no dangling pronouns
FAIL: starts with "Furthermore/Moreover", refers to "previous section", undefined entities

## Dimension 2: Semantic Coherence
Does the fragment express ONE coherent idea, readable in isolation?
PASS: single topic, logical flow
FAIL: multiple distinct ideas bundled, abrupt topic shifts

## Dimension 3: Classification Accuracy
Do the assigned metadata (domain, function, type) match the actual content?
PASS: domain is actual topic, function/type align with corpus referential
FAIL: domain ≠ body topic, function or type mismatch or not in referential

## Metadata suggestions
If the current type, domain, or tags could better match the content AND the corpus referential, suggest corrections. Use only values from the referential when possible. If metadata is already accurate, omit suggested_metadata.

Return ONLY valid JSON:
{
  "reusability": { "verdict": "pass", "reason": "..." },
  "semantic_coherence": { "verdict": "pass", "reason": "..." },
  "classification_accuracy": { "verdict": "pass", "reason": "..." },
  "overall_recommendation": "accept",
  "overall_reason": "1-2 sentences",
  "suggested_metadata": { "type": "...", "domain": "...", "tags": ["..."], "reason": "..." }
}`;

  try {
    const response = await llmClient.chatMessages([
      { role: 'system', content: 'You are a content quality evaluator. Output valid JSON only.' },
      { role: 'user', content: prompt },
    ]);
    const jsonStr = response.match(/\{[\s\S]*\}/)?.[0] ?? response;
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
    const dims = ['reusability', 'semantic_coherence', 'classification_accuracy'] as const;
    const validVerdicts = ['pass', 'partial', 'fail'];
    const validRecs = ['accept', 'review', 'reject'];
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !dims.every((d) => validVerdicts.includes((parsed[d] as Record<string, unknown>)?.verdict as string)) ||
      !validRecs.includes(parsed.overall_recommendation as string)
    ) {
      return null;
    }

    const result = parsed as unknown as JudgeResult;

    // Validate suggested_metadata if present
    if (result.suggested_metadata) {
      const s = result.suggested_metadata;
      if (typeof s.reason !== 'string') {
        result.suggested_metadata = undefined;
      } else {
        if (s.type && typeof s.type !== 'string') delete s.type;
        if (s.domain && typeof s.domain !== 'string') delete s.domain;
        if (s.tags && !Array.isArray(s.tags)) delete s.tags;
      }
    }

    return result;
  } catch {
    return null;
  }
}
