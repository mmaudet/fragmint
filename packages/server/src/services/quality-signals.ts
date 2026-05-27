// packages/server/src/services/quality-signals.ts
// Pure utility functions for local quality signal computation (no LLM, no Milvus required)

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

export interface CoherenceFlag {
  type:
    | 'subject_coherence'
    | 'entity_coverage'
    | 'hint_entity_coverage'
    | 'duplicate_check'
    | 'prototype_distance';
  level: 'ok' | 'warning' | 'error' | 'info';
  message: string;
}

const SUBJECT_KEYWORDS: Record<string, string[]> = {
  'twake-mail': ['twake mail', 'twake', 'messagerie', 'apache james', 'jmap', 'mail'],
  'twake-calendar': ['twake calendar', 'agenda', 'calendar', 'caldav'],
  'twake-drive': ['twake drive', 'drive', 'partage de fichiers'],
  'twake-chat': ['twake chat', 'matrix', 'chat', 'messagerie instantanée'],
  linshare: ['linshare', 'partage sécurisé', 'fichiers volumineux'],
  lincloud: ['lincloud', 'cloud souverain'],
  linto: ['linto', 'voix', 'assistant'],
  openrag: ['openrag', 'rag', 'retrieval'],
  'linagora-corp': ['linagora', 'notre société', 'notre entreprise'],
};

export function checkSubjectCoherence(block: { domain: string; body: string }): CoherenceFlag {
  const keywords = SUBJECT_KEYWORDS[block.domain];
  if (!keywords) {
    return {
      type: 'subject_coherence',
      level: 'info',
      message: `No keyword list for domain "${block.domain}"`,
    };
  }
  const bodyLower = block.body.toLowerCase();
  const matches = keywords.filter((kw) => bodyLower.includes(kw));
  if (matches.length === 0) {
    return {
      type: 'subject_coherence',
      level: 'warning',
      message: `Domain "${block.domain}" not mentioned in body`,
    };
  }
  return {
    type: 'subject_coherence',
    level: 'ok',
    message: `Keywords found: ${matches.join(', ')}`,
  };
}

const ENTITY_EXPECTATIONS: Record<string, string[]> = {
  technical: ['technologies', 'products'],
  commercial: ['products'],
  reference: ['clients'],
  legal: ['regulations', 'certifications'],
};

export function checkEntityCoverage(block: {
  function_type: string | null | undefined;
  entities: Record<string, string[]>;
}): CoherenceFlag {
  const expected = ENTITY_EXPECTATIONS[block.function_type ?? ''] ?? [];
  if (expected.length === 0) {
    return {
      type: 'entity_coverage',
      level: 'info',
      message: 'No entity expectations for this function',
    };
  }
  const missing = expected.filter((t) => !block.entities[t] || block.entities[t].length === 0);
  if (missing.length > 0) {
    return {
      type: 'entity_coverage',
      level: 'warning',
      message: `Missing expected entities: ${missing.join(', ')}`,
    };
  }
  return { type: 'entity_coverage', level: 'ok', message: 'Expected entities present' };
}

function duplicateSignal(dupResult: { id: string; score: number } | null): CoherenceFlag {
  if (!dupResult) {
    return { type: 'duplicate_check', level: 'ok', message: 'No duplicates detected' };
  }
  const pct = Math.round(dupResult.score * 100);
  if (dupResult.score >= 0.95) {
    return {
      type: 'duplicate_check',
      level: 'error',
      message: `Doublon quasi-exact de ${dupResult.id} (${pct}%)`,
    };
  }
  if (dupResult.score >= 0.8) {
    return {
      type: 'duplicate_check',
      level: 'warning',
      message: `Forte similarité avec ${dupResult.id} (${pct}%) — possible mise à jour`,
    };
  }
  // 0.70–0.80
  return {
    type: 'duplicate_check',
    level: 'info',
    message: `Similarité modérée avec ${dupResult.id} (${pct}%)`,
  };
}

/** Check that hint entities from upload hints are present in the fragment body. */
export function checkHintEntityCoverage(
  body: string,
  hintEntities: string[],
): CoherenceFlag | null {
  if (hintEntities.length === 0) return null;
  const missing = hintEntities.filter((name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return !new RegExp(`\\b${escaped}\\b`, 'i').test(body);
  });
  if (missing.length === 0) return null;
  return {
    type: 'hint_entity_coverage',
    level: 'info',
    message: `Entité(s) hint non trouvée(s) dans ce fragment : ${missing.join(', ')}`,
  };
}

export function computeQualitySignals(
  block: {
    type: string;
    body: string;
    domain: string;
    function_type?: string | null;
    entities?: Record<string, string[]>;
  },
  dupResult: { id: string; score: number } | null,
  hintEntities: string[] = [],
): CoherenceFlag[] {
  const signals: CoherenceFlag[] = [
    checkSubjectCoherence({ domain: block.domain, body: block.body }),
    checkEntityCoverage({ function_type: block.function_type, entities: block.entities ?? {} }),
    duplicateSignal(dupResult),
  ];
  const hintSignal = checkHintEntityCoverage(block.body, hintEntities);
  if (hintSignal) signals.push(hintSignal);
  return signals;
}
