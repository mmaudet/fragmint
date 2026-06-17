import { z } from 'zod';

export type TrustSource = 'human-direct' | 'llm-confirmed' | 'llm-deviation' | 'llm-inferred';

export interface UploadHints {
  domain?: string;
  tags?: string[];
}

export const UploadHintsSchema = z
  .object({
    domain: z.string().max(100).optional(),
    tags: z.array(z.string().max(80)).max(20).optional(),
  })
  .strict();

export type TrustSourcesPerMetadata = Partial<Record<keyof UploadHints, TrustSource>>;

/**
 * Normalize a value to an array of lowercase strings, handling edge cases.
 */
function normalizeToArray(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string').map((v) => v.toLowerCase());
  }
  if (typeof value === 'string') {
    return value.trim() === '' ? [] : [value.toLowerCase()];
  }
  return [];
}

/**
 * Check if two arrays are equal (case-insensitive).
 */
function arraysEqual(arr1: string[], arr2: string[]): boolean {
  if (arr1.length !== arr2.length) return false;
  const sorted1 = [...arr1].sort((x, y) => x.localeCompare(y));
  const sorted2 = [...arr2].sort((x, y) => x.localeCompare(y));
  return sorted1.every((item, idx) => item === sorted2[idx]);
}

/**
 * Determine trust source for a single metadata field.
 *
 * Logic:
 * 1. No hint (null/undefined/empty) → 'llm-inferred'
 * 2. Hint present AND LLM agrees → 'llm-confirmed'
 * 3. Hint present AND LLM disagrees → 'llm-deviation'
 *
 * Note: 'human-direct' is NEVER set here — it only comes from an explicit admin correction action.
 */
export function determineTrustSource(hint: unknown, llmValue: unknown): TrustSource {
  const hintArray = normalizeToArray(hint);

  if (hintArray.length === 0) {
    return 'llm-inferred';
  }

  const llmArray = normalizeToArray(llmValue);

  if (arraysEqual(hintArray, llmArray)) {
    return 'llm-confirmed';
  }

  return 'llm-deviation';
}

/**
 * Compute trust sources for all metadata fields.
 * Returns a mapping of field name to trust source.
 */
export function computeTrustSources(
  hints: UploadHints,
  block: Record<string, unknown>,
  referential: Record<string, string[]>,
): TrustSourcesPerMetadata {
  const sources: TrustSourcesPerMetadata = {};

  const fields: (keyof UploadHints)[] = [
    'domain',
    'tags',
  ];

  for (const field of fields) {
    sources[field] = determineTrustSource(hints[field], block[field]);
  }

  return sources;
}

/**
 * Determine the overall trust source across all fields.
 * Returns the "worst" trust source (lowest trust):
 * Priority: llm-deviation > llm-inferred > llm-confirmed > human-direct
 */
export function overallTrustSource(sources: TrustSourcesPerMetadata): TrustSource {
  const values = Object.values(sources);

  if (values.some((v) => v === 'llm-deviation')) {
    return 'llm-deviation';
  }
  if (values.some((v) => v === 'llm-inferred')) {
    return 'llm-inferred';
  }
  if (values.some((v) => v === 'llm-confirmed')) {
    return 'llm-confirmed';
  }

  return 'human-direct';
}
