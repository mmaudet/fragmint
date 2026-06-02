// packages/server/src/services/quality-signals.ts

export function normalizeForComparison(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 200);
}

export function detectExactDuplicate(
  block: { type: string; body: string },
  existingFragments: { id: string; type: string; body: string }[],
): { id: string; score: 1.0 } | null {
  const normalized = normalizeForComparison(block.body);
  const match = existingFragments.find(
    (f) => f.type === block.type && normalizeForComparison(f.body) === normalized,
  );
  return match ? { id: match.id, score: 1.0 } : null;
}

// Kept for backward-compat: existing harvest_candidates rows in DB have quality_signals JSON
export interface CoherenceFlag {
  type: 'subject_coherence' | 'duplicate_check' | 'prototype_distance';
  level: 'ok' | 'warning' | 'error' | 'info';
  message: string;
}
