# Confidence Signals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer l'affichage du score de confiance LLM (ancré à 0.85, non fiable) par des signaux qualitatifs concrets et déterministes sur chaque fragment candidat à valider.

**Architecture:** Trois niveaux indépendants et cumulatifs. Niveau 1 (fixes immédiats) : détection de doublons exacts sans Milvus + suppression du slider trompeur + remplacement du badge %. Niveau 2 : 4 signaux qualitatifs locaux stockés en DB + affichage par badges. Niveau 3 (optionnel) : LLM-as-judge déclenché uniquement sur les fragments en warning.

**Tech Stack:** TypeScript, Fastify 5, Drizzle ORM (SQLite), React 19 + shadcn/ui, Vitest

---

## Fichiers touchés

| Fichier | Action | Niveau |
|---------|--------|--------|
| `packages/server/src/services/harvester-pipeline.ts` | Modifier — exact dupe + quality signals + judge trigger | 1, 2, 3 |
| `packages/server/src/services/llm-client.ts` | Modifier — fix ancrage confidence 0.85 | 1 |
| `packages/server/src/db/schema.ts` | Modifier — ajouter colonnes `quality_signals`, `judge_result` | 2, 3 |
| `packages/server/src/services/quality-signals.ts` | Créer — 4 fonctions de signal | 2 |
| `packages/server/src/services/quality-judge.ts` | Créer — LLM-as-judge prompt + appel | 3 |
| `packages/server/src/schema/__tests__/quality-signals.test.ts` | Créer — tests unitaires signaux | 2 |
| `packages/web/src/pages/harvest.tsx` | Modifier — retirer slider min_confidence | 1 |
| `packages/web/src/api/hooks/use-harvest.ts` | Modifier — retirer minConfidence du payload | 1 |
| `packages/web/src/api/types.ts` | Modifier — ajouter CoherenceFlag, quality_signals, judge_result | 2, 3 |
| `packages/web/src/components/candidate-card.tsx` | Modifier — badge % → badge Doublon/OK, puis badges signaux | 1, 2 |
| `packages/web/src/components/candidate-detail-sheet.tsx` | Modifier — afficher signaux + judge result | 2, 3 |

---

## Task 1: Niveau 1 — Fix immédiat (ne plus mentir)

**Files:**
- Modify: `packages/server/src/services/harvester-pipeline.ts:33-210`
- Modify: `packages/server/src/services/llm-client.ts:244`
- Modify: `packages/web/src/pages/harvest.tsx:24,67`
- Modify: `packages/web/src/api/hooks/use-harvest.ts:25-36`
- Modify: `packages/web/src/components/candidate-card.tsx:17-42`

### 1.1 — Fix détection de doublons exacts (sans Milvus)

- [ ] **Écrire le test**

Créer `packages/server/src/schema/__tests__/quality-signals.test.ts` :

```typescript
import { describe, it, expect } from 'vitest';
import { normalizeForComparison, detectExactDuplicate } from '../../services/quality-signals.js';

describe('normalizeForComparison', () => {
  it('lowercases and collapses whitespace', () => {
    expect(normalizeForComparison('  Hello   World  ')).toBe('hello world');
    expect(normalizeForComparison('A\nB\tC')).toBe('a b c');
  });
  it('truncates to 200 chars', () => {
    const long = 'a'.repeat(300);
    expect(normalizeForComparison(long)).toHaveLength(200);
  });
});

describe('detectExactDuplicate', () => {
  const existingFragments = [
    { id: 'frag-1', type: 'argument', body: 'Open source réel, sans dual licensing.' },
    { id: 'frag-2', type: 'description', body: 'Twake Mail est une messagerie souveraine.' },
  ];

  it('returns matching fragment id when exact match found', () => {
    const result = detectExactDuplicate(
      { type: 'argument', body: 'Open source réel, sans dual licensing.' },
      existingFragments,
    );
    expect(result).toEqual({ id: 'frag-1', score: 1.0 });
  });

  it('returns null when no match', () => {
    const result = detectExactDuplicate(
      { type: 'argument', body: 'Contenu différent.' },
      existingFragments,
    );
    expect(result).toBeNull();
  });

  it('returns null when type differs even if body matches', () => {
    const result = detectExactDuplicate(
      { type: 'description', body: 'Open source réel, sans dual licensing.' },
      existingFragments,
    );
    expect(result).toBeNull();
  });

  it('matches despite different whitespace', () => {
    const result = detectExactDuplicate(
      { type: 'argument', body: '  Open source  réel,   sans dual licensing.  ' },
      existingFragments,
    );
    expect(result).toEqual({ id: 'frag-1', score: 1.0 });
  });
});
```

- [ ] **Vérifier que le test échoue**

```bash
pnpm test --filter @fragmint/server
```
Expected: `Cannot find module '../../services/quality-signals.js'`

- [ ] **Créer `packages/server/src/services/quality-signals.ts`** avec les deux fonctions :

```typescript
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
```

- [ ] **Vérifier que le test passe**

```bash
pnpm test --filter @fragmint/server
```
Expected: tous les tests `normalizeForComparison` et `detectExactDuplicate` passent.

- [ ] **Intégrer dans `harvester-pipeline.ts`**

Ajouter l'import en haut du fichier :

```typescript
import { normalizeForComparison, detectExactDuplicate } from './quality-signals.js';
import { fragments } from '../db/schema.js';
import { inArray } from 'drizzle-orm';
```

Avant la boucle `for (let i = 0; i < files.length; i++)`, charger les fragments existants **une seule fois** :

```typescript
// Load reviewed/approved fragments for exact duplicate detection (Milvus-independent)
const existingFragmentRows = await db
  .select({ id: fragments.id, type: fragments.type, body: fragments.body })
  .from(fragments)
  .where(inArray(fragments.quality, ['reviewed', 'approved']));
```

Dans la boucle de traitement, **remplacer** le bloc de duplicate detection (lignes 136-158) :

```typescript
// Parallel duplicate detection — exact match always, Milvus near-match if available
const t1 = Date.now();
const dupeChecks = await Promise.all(
  blocks.map(async (block) => {
    // 1. Exact match — always runs, Milvus-independent
    const exactDup = detectExactDuplicate(block, existingFragmentRows);
    if (exactDup) return exactDup;

    // 2. Near match via Milvus cosine — only if Milvus available
    try {
      const results = await searchService.search(block.body, undefined, 1);
      if (results.length > 0 && results[0].score > 0.8) {
        return { id: results[0].id, score: results[0].score };
      }
    } catch {
      // Milvus not available — silently skip near-duplicate check
    }
    return null;
  }),
);
console.log(`[harvest:${jobId}] dupe detection: ${((Date.now() - t1) / 1000).toFixed(1)}s`);
```

- [ ] **Commit**

```bash
git add packages/server/src/services/quality-signals.ts \
        packages/server/src/schema/__tests__/quality-signals.test.ts \
        packages/server/src/services/harvester-pipeline.ts
git commit -m "fix(harvest): exact duplicate detection independent of Milvus"
```

---

### 1.2 — Fix ancrage confidence 0.85 dans le prompt LLM

- [ ] **Modifier `packages/server/src/services/llm-client.ts` ligne 244**

Remplacer :
```typescript
    "confidence": 0.85
```

Par :
```typescript
    "confidence": 0.72
```

Et ajouter juste après la fermeture du JSON example (chercher la ligne `]`;) une instruction dans le prompt — repérer la ligne qui se termine par `` ]`; `` et chercher où est défini le commentaire sur `confidence` autour de la ligne 275 :

```typescript
- confidence: your confidence in this classification (0–1).
```

Remplacer cette ligne par :

```typescript
- confidence: your confidence in this classification (0–1).
  Scale: 0.95+ only when all metadata is unambiguous. 0.70-0.94 when confident
  but some ambiguity exists. 0.50-0.69 when uncertain. Below 0.50 when likely
  misclassified. Default toward lower values when unsure.
```

- [ ] **Vérifier que le typage compile**

```bash
npx tsc --project packages/server/tsconfig.json --noEmit
```
Expected: aucune erreur.

- [ ] **Commit**

```bash
git add packages/server/src/services/llm-client.ts
git commit -m "fix(llm): remove 0.85 anchor in confidence prompt instruction"
```

---

### 1.3 — Supprimer le slider min_confidence de la page Ingestion

- [ ] **Modifier `packages/web/src/api/hooks/use-harvest.ts`**

Supprimer `minConfidence` du type et du payload :

```typescript
// Avant
export function useStartHarvest(collection: string) {
  return useMutation({
    mutationFn: async ({ files, minConfidence, uploadHints }: {
      files: File[];
      minConfidence: number;
      uploadHints?: UploadHints;
    }) => {
      const form = new FormData();
      files.forEach((f) => form.append('files', f));
      form.append('options', JSON.stringify({ min_confidence: minConfidence }));
      // ...
    },
  });
}
```

```typescript
// Après
export function useStartHarvest(collection: string) {
  return useMutation({
    mutationFn: async ({ files, uploadHints }: {
      files: File[];
      uploadHints?: UploadHints;
    }) => {
      const form = new FormData();
      files.forEach((f) => form.append('files', f));
      form.append('options', JSON.stringify({ min_confidence: 0 }));
      // ... reste identique
    },
  });
}
```

- [ ] **Modifier `packages/web/src/pages/harvest.tsx`**

Retirer `const [minConfidence, setMinConfidence] = useState(0.65);` (ligne 24).

Retirer `minConfidence` de l'appel à `startHarvest.mutateAsync` (ligne 67) :

```typescript
// Avant
const result = await startHarvest.mutateAsync({ files, minConfidence, uploadHints });

// Après
const result = await startHarvest.mutateAsync({ files, uploadHints });
```

Retirer le bloc entier du slider dans le JSX (le bloc commenté `{/* Confidence slider */}` et le `Slider` qui suit, environ lignes 255-270).

- [ ] **Vérifier le typage**

```bash
npx tsc --project packages/web/tsconfig.json --noEmit
```
Expected: aucune erreur.

- [ ] **Commit**

```bash
git add packages/web/src/pages/harvest.tsx \
        packages/web/src/api/hooks/use-harvest.ts
git commit -m "fix(harvest): remove min_confidence slider — LLM confidence score is not filterable"
```

---

### 1.4 — Remplacer le badge % par badge Doublon/OK

- [ ] **Modifier `packages/web/src/components/candidate-card.tsx`**

Supprimer la fonction `confidenceColor` (lignes 17-22) — elle ne sera plus utilisée.

Remplacer le badge de confiance (lignes 40-42) :

```tsx
// Avant
<Badge className={cn('text-xs shrink-0', confidenceColor(candidate.confidence))}>
  {Math.round(candidate.confidence * 100)}%
</Badge>
```

```tsx
// Après
{candidate.duplicate_of ? (
  <Badge className="text-xs shrink-0 bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">
    Doublon
  </Badge>
) : (
  <Badge variant="outline" className="text-xs shrink-0 text-muted-foreground">
    OK
  </Badge>
)}
```

- [ ] **Vérifier le typage**

```bash
npx tsc --project packages/web/tsconfig.json --noEmit
```
Expected: aucune erreur.

- [ ] **Commit**

```bash
git add packages/web/src/components/candidate-card.tsx
git commit -m "fix(harvest): replace confidence % badge with Doublon/OK status badge"
```

---

## Task 2: Niveau 2 — Signaux qualitatifs locaux

**Files:**
- Modify: `packages/server/src/services/quality-signals.ts`
- Create: `packages/server/src/schema/__tests__/quality-signals.test.ts` (extension du fichier Task 1)
- Modify: `packages/server/src/db/schema.ts`
- Modify: `packages/server/src/services/harvester-pipeline.ts`
- Modify: `packages/server/src/services/harvester-service.ts` (getJob)
- Modify: `packages/web/src/api/types.ts`
- Modify: `packages/web/src/components/candidate-card.tsx`
- Modify: `packages/web/src/components/candidate-detail-sheet.tsx`

### 2.1 — Implémenter les 4 fonctions de signal dans quality-signals.ts

- [ ] **Ajouter les tests des 4 signaux dans `quality-signals.test.ts`**

Ajouter à la suite du fichier existant :

```typescript
describe('checkSubjectCoherence', () => {
  it('returns ok when subject keyword found in body', () => {
    const result = checkSubjectCoherence({ domain: 'twake-mail', body: 'Twake Mail est une messagerie basée sur Apache James et JMAP.' });
    expect(result.level).toBe('ok');
  });

  it('returns warning when no keyword matches', () => {
    const result = checkSubjectCoherence({ domain: 'twake-mail', body: 'Contenu totalement sans rapport.' });
    expect(result.level).toBe('warning');
    expect(result.type).toBe('subject_coherence');
  });

  it('returns info for unknown domain', () => {
    const result = checkSubjectCoherence({ domain: 'unknown-product', body: 'Quelque chose.' });
    expect(result.level).toBe('info');
  });
});

describe('checkEntityCoverage', () => {
  it('returns ok when expected entities present for function', () => {
    const result = checkEntityCoverage({
      function_type: 'commercial',
      entities: { products: ['Twake Mail'], clients: [], technologies: [], partners: [], certifications: [], regulations: [] },
    });
    expect(result.level).toBe('ok');
  });

  it('returns warning when expected entities missing', () => {
    const result = checkEntityCoverage({
      function_type: 'reference',
      entities: { products: [], clients: [], technologies: [], partners: [], certifications: [], regulations: [] },
    });
    expect(result.level).toBe('warning');
    expect(result.message).toContain('clients');
  });

  it('returns info for function with no expectations', () => {
    const result = checkEntityCoverage({
      function_type: 'strategic',
      entities: { products: [], clients: [], technologies: [], partners: [], certifications: [], regulations: [] },
    });
    expect(result.level).toBe('info');
  });
});
```

- [ ] **Vérifier que les tests échouent**

```bash
pnpm test --filter @fragmint/server
```
Expected: `checkSubjectCoherence is not a function`

- [ ] **Compléter `packages/server/src/services/quality-signals.ts`** avec les 4 signaux :

```typescript
export interface CoherenceFlag {
  type: 'subject_coherence' | 'entity_coverage' | 'duplicate_check' | 'prototype_distance';
  level: 'ok' | 'warning' | 'error' | 'info';
  message: string;
}

// --- existing exports normalizeForComparison, detectExactDuplicate ---

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
    return { type: 'subject_coherence', level: 'info', message: `No keyword list for domain "${block.domain}"` };
  }
  const bodyLower = block.body.toLowerCase();
  const matches = keywords.filter((kw) => bodyLower.includes(kw));
  if (matches.length === 0) {
    return { type: 'subject_coherence', level: 'warning', message: `Domain "${block.domain}" not mentioned in body` };
  }
  return { type: 'subject_coherence', level: 'ok', message: `Keywords found: ${matches.join(', ')}` };
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
    return { type: 'entity_coverage', level: 'info', message: 'No entity expectations for this function' };
  }
  const missing = expected.filter((t) => !block.entities[t] || block.entities[t].length === 0);
  if (missing.length > 0) {
    return { type: 'entity_coverage', level: 'warning', message: `Missing expected entities: ${missing.join(', ')}` };
  }
  return { type: 'entity_coverage', level: 'ok', message: 'Expected entities present' };
}

export function computeQualitySignals(
  block: { type: string; body: string; domain: string; function_type?: string | null; entities?: Record<string, string[]> },
  existingFragments: { id: string; type: string; body: string }[],
): CoherenceFlag[] {
  return [
    checkSubjectCoherence({ domain: block.domain, body: block.body }),
    checkEntityCoverage({ function_type: block.function_type, entities: block.entities ?? {} }),
    (() => {
      const dup = detectExactDuplicate(block, existingFragments);
      if (dup) return { type: 'duplicate_check' as const, level: 'error' as const, message: `Exact duplicate of ${dup.id}` };
      return { type: 'duplicate_check' as const, level: 'ok' as const, message: 'No duplicates detected' };
    })(),
  ];
}
```

- [ ] **Vérifier que tous les tests passent**

```bash
pnpm test --filter @fragmint/server
```
Expected: tous les tests passent.

- [ ] **Commit**

```bash
git add packages/server/src/services/quality-signals.ts \
        packages/server/src/schema/__tests__/quality-signals.test.ts
git commit -m "feat(signals): add 4 local quality signal functions"
```

---

### 2.2 — Migration DB : ajouter la colonne quality_signals

- [ ] **Modifier `packages/server/src/db/schema.ts`**

Ajouter `quality_signals` à la table `harvestCandidates` (après la ligne `trust_sources_json`) :

```typescript
export const harvestCandidates = sqliteTable('harvest_candidates', {
  // ... colonnes existantes ...
  trust_sources_json: text('trust_sources_json'),
  quality_signals: text('quality_signals'),   // JSON: CoherenceFlag[]
});
```

- [ ] **Ajouter la migration SQL** dans `packages/server/src/db/migrations/` ou via le mécanisme de migration Drizzle existant.

Vérifier comment les migrations se font dans le projet :

```bash
grep -r "migrate\|migration" packages/server/src/db/ --include="*.ts" -l
```

Si pas de système de migration auto, la colonne SQLite s'ajoute à la volée via :

```typescript
// packages/server/src/db/connection.ts — chercher où les tables sont créées/vérifiées
// Ajouter après la création de la table si elle n'existe pas :
db.run(`ALTER TABLE harvest_candidates ADD COLUMN IF NOT EXISTS quality_signals TEXT`);
```

Si la DB est recréée à chaque démarrage dev (`:memory:`), le schéma suffit.

- [ ] **Vérifier le typage serveur**

```bash
npx tsc --project packages/server/tsconfig.json --noEmit
```
Expected: aucune erreur.

- [ ] **Commit**

```bash
git add packages/server/src/db/schema.ts packages/server/src/db/connection.ts
git commit -m "feat(db): add quality_signals column to harvest_candidates"
```

---

### 2.3 — Intégrer quality signals dans le pipeline

- [ ] **Modifier `packages/server/src/services/harvester-pipeline.ts`**

Ajouter l'import :

```typescript
import { computeQualitySignals } from './quality-signals.js';
```

Après le bloc `dupeChecks`, calculer les signaux pour tous les blocs :

```typescript
// Compute quality signals for all blocks
const qualitySignalsPerBlock = blocks.map((block, j) => {
  const entities = block.entities ?? {};
  return computeQualitySignals(
    { type: block.type, body: block.body, domain: block.domain, function_type: block.function_type, entities },
    existingFragmentRows,
  );
});
```

Dans le `db.insert(harvestCandidates).values(blocks.map(...))`, ajouter la colonne :

```typescript
quality_signals: JSON.stringify(qualitySignalsPerBlock[j]),
```

- [ ] **Modifier la fonction `getJob`** dans `packages/server/src/services/harvester-service.ts`

Dans le `.map((c) => ...)` qui construit les candidates (lignes ~144-163), ajouter :

```typescript
quality_signals: c.quality_signals ? (JSON.parse(c.quality_signals) as CoherenceFlag[]) : [],
```

Ajouter l'import en haut du fichier :

```typescript
import type { CoherenceFlag } from './quality-signals.js';
```

- [ ] **Vérifier le typage serveur**

```bash
npx tsc --project packages/server/tsconfig.json --noEmit
```
Expected: aucune erreur.

- [ ] **Commit**

```bash
git add packages/server/src/services/harvester-pipeline.ts \
        packages/server/src/services/harvester-service.ts
git commit -m "feat(harvest): compute and persist quality signals per candidate"
```

---

### 2.4 — Mettre à jour les types API et l'affichage

- [ ] **Modifier `packages/web/src/api/types.ts`**

Ajouter l'interface `CoherenceFlag` et la mettre dans `HarvestCandidate` :

```typescript
export interface CoherenceFlag {
  type: 'subject_coherence' | 'entity_coverage' | 'duplicate_check' | 'prototype_distance';
  level: 'ok' | 'warning' | 'error' | 'info';
  message: string;
}

// Dans HarvestCandidate, ajouter :
quality_signals: CoherenceFlag[];
```

- [ ] **Modifier `packages/web/src/components/candidate-card.tsx`**

Ajouter l'import de `CoherenceFlag` depuis `@/api/types`.

Après le bloc du `duplicate_of` (lignes ~61-69), ajouter l'affichage compact des signaux warning/error :

```tsx
{(candidate.quality_signals ?? [])
  .filter((s) => s.level === 'warning' || s.level === 'error')
  .map((s) => (
    <div key={s.type} className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
      <AlertTriangle className="h-3 w-3 shrink-0" />
      <span className="truncate">{s.message}</span>
    </div>
  ))}
```

- [ ] **Modifier `packages/web/src/components/candidate-detail-sheet.tsx`**

Dans le panel détail, ajouter une section "Signaux qualitatifs" après les métadonnées :

```tsx
{candidate.quality_signals && candidate.quality_signals.length > 0 && (
  <div className="space-y-1">
    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Signaux qualitatifs</p>
    {candidate.quality_signals.map((s) => (
      <div key={s.type} className={cn(
        'flex items-start gap-2 text-xs rounded px-2 py-1',
        s.level === 'ok' && 'text-green-700 bg-green-50 dark:text-green-300 dark:bg-green-950/30',
        s.level === 'warning' && 'text-amber-700 bg-amber-50 dark:text-amber-300 dark:bg-amber-950/30',
        s.level === 'error' && 'text-red-700 bg-red-50 dark:text-red-300 dark:bg-red-950/30',
        s.level === 'info' && 'text-muted-foreground bg-muted/40',
      )}>
        <span className="font-medium shrink-0">
          {s.level === 'ok' ? '✓' : s.level === 'warning' ? '⚠' : s.level === 'error' ? '✗' : 'ℹ'}
        </span>
        <span>{s.message}</span>
      </div>
    ))}
  </div>
)}
```

- [ ] **Vérifier le typage web**

```bash
npx tsc --project packages/web/tsconfig.json --noEmit
```
Expected: aucune erreur.

- [ ] **Commit**

```bash
git add packages/web/src/api/types.ts \
        packages/web/src/components/candidate-card.tsx \
        packages/web/src/components/candidate-detail-sheet.tsx
git commit -m "feat(harvest): display quality signals badges on candidate cards"
```

---

### 2.5 — Trier les candidats par sévérité de signaux

Les candidats avec `error` d'abord, puis `warning`, puis `ok`.

- [ ] **Trouver où les candidats sont triés/affichés** dans `harvest.tsx` ou le composant parent

```bash
grep -n "sort\|candidates\|CandidateCard" packages/web/src/pages/harvest.tsx
```

- [ ] **Ajouter la fonction de tri et l'appliquer**

Dans le fichier qui liste les candidats (probablement dans `harvest-debrief.tsx` ou similaire), ajouter :

```typescript
function signalSortKey(candidate: HarvestCandidate): number {
  const signals = candidate.quality_signals ?? [];
  if (signals.some((s) => s.level === 'error')) return -1000;
  const warningCount = signals.filter((s) => s.level === 'warning').length;
  if (warningCount > 0) return -warningCount;
  return 0;
}

// Puis au moment d'afficher :
const sorted = [...candidates].sort((a, b) => signalSortKey(a) - signalSortKey(b));
```

- [ ] **Vérifier le typage web**

```bash
npx tsc --project packages/web/tsconfig.json --noEmit
```

- [ ] **Commit**

```bash
git add packages/web/src/
git commit -m "feat(harvest): sort candidates by quality signal severity (errors first)"
```

---

## Task 3: Niveau 3 — LLM-as-judge (optionnel, ~6-8h)

> Déclencher uniquement sur les fragments avec au moins un signal `warning` (et pas `error` de doublon exact — déjà invalides). Coût : ~1 centime par fragment ambigu.

**Files:**
- Create: `packages/server/src/services/quality-judge.ts`
- Modify: `packages/server/src/db/schema.ts`
- Modify: `packages/server/src/services/harvester-pipeline.ts`
- Modify: `packages/web/src/api/types.ts`
- Modify: `packages/web/src/components/candidate-detail-sheet.tsx`

### 3.1 — Créer quality-judge.ts

- [ ] **Créer `packages/server/src/services/quality-judge.ts`**

```typescript
import type { LlmClient } from './llm-client.js';
import type { CoherenceFlag } from './quality-signals.js';

export interface JudgeVerdict {
  verdict: 'pass' | 'partial' | 'fail';
  reason: string;
}

export interface JudgeResult {
  reusability: JudgeVerdict;
  semantic_coherence: JudgeVerdict;
  classification_accuracy: JudgeVerdict;
  overall_recommendation: 'accept' | 'review' | 'reject';
  overall_reason: string;
}

export function shouldRunJudge(signals: CoherenceFlag[]): boolean {
  const hasWarning = signals.some((s) => s.level === 'warning');
  const isExactDuplicate = signals.some(
    (s) => s.type === 'duplicate_check' && s.level === 'error',
  );
  return hasWarning && !isExactDuplicate;
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
): Promise<JudgeResult | null> {
  const signalsSummary = signals
    .map((s) => `- [${s.level.toUpperCase()}] ${s.type}: ${s.message}`)
    .join('\n');

  const prompt = `You are evaluating the quality of a content fragment extracted from a Linagora commercial document.

# Fragment to evaluate
Title: ${block.title}
Body: ${block.body}

# Metadata assigned by ingestion
Domain: ${block.domain} / Function: ${block.function_type ?? 'unknown'} / Type: ${block.type}
Audience: ${(block.audience ?? []).join(', ')} / Entities: ${JSON.stringify(block.entities ?? {})}

# Quality signals already detected
${signalsSummary}

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
PASS: domain is actual topic, function/type align
FAIL: domain ≠ body topic, function or type mismatch

Return ONLY valid JSON:
{
  "reusability": { "verdict": "pass", "reason": "..." },
  "semantic_coherence": { "verdict": "pass", "reason": "..." },
  "classification_accuracy": { "verdict": "pass", "reason": "..." },
  "overall_recommendation": "accept",
  "overall_reason": "1-2 sentences"
}`;

  try {
    const response = await llmClient.complete([
      { role: 'system', content: 'You are a content quality evaluator. Output valid JSON only.' },
      { role: 'user', content: prompt },
    ]);
    const parsed = JSON.parse(response) as JudgeResult;
    return parsed;
  } catch {
    return null;
  }
}
```

- [ ] **Vérifier le typage serveur**

```bash
npx tsc --project packages/server/tsconfig.json --noEmit
```
Expected: aucune erreur.

---

### 3.2 — Ajouter la colonne judge_result en DB

- [ ] **Modifier `packages/server/src/db/schema.ts`**

```typescript
export const harvestCandidates = sqliteTable('harvest_candidates', {
  // ... colonnes existantes ...
  quality_signals: text('quality_signals'),
  judge_result: text('judge_result'),   // JSON: JudgeResult | null
});
```

Si migration manuelle nécessaire (SQLite existant) :

```sql
ALTER TABLE harvest_candidates ADD COLUMN judge_result TEXT;
```

---

### 3.3 — Intégrer le judge dans le pipeline

- [ ] **Modifier `packages/server/src/services/harvester-pipeline.ts`**

Ajouter l'import :

```typescript
import { shouldRunJudge, runQualityJudge } from './quality-judge.js';
import type { JudgeResult } from './quality-judge.js';
```

Après le calcul des quality signals, déclencher le judge en parallèle sur les fragments éligibles :

```typescript
// Run LLM-as-judge on ambiguous fragments (warnings but not exact duplicates)
const judgeResults: (JudgeResult | null)[] = await Promise.all(
  blocks.map(async (block, j) => {
    const signals = qualitySignalsPerBlock[j];
    if (!shouldRunJudge(signals)) return null;
    return runQualityJudge(llmClient, block, signals);
  }),
);
```

Dans le `db.insert(harvestCandidates).values(...)`, ajouter :

```typescript
judge_result: judgeResults[j] ? JSON.stringify(judgeResults[j]) : null,
```

Dans `getJob`, ajouter à la map des candidates :

```typescript
judge_result: c.judge_result ? (JSON.parse(c.judge_result) as JudgeResult) : null,
```

---

### 3.4 — Afficher le résultat du judge dans le detail sheet

- [ ] **Modifier `packages/web/src/api/types.ts`**

Ajouter :

```typescript
export interface JudgeVerdict {
  verdict: 'pass' | 'partial' | 'fail';
  reason: string;
}

export interface JudgeResult {
  reusability: JudgeVerdict;
  semantic_coherence: JudgeVerdict;
  classification_accuracy: JudgeVerdict;
  overall_recommendation: 'accept' | 'review' | 'reject';
  overall_reason: string;
}

// Dans HarvestCandidate :
judge_result: JudgeResult | null;
```

- [ ] **Modifier `packages/web/src/components/candidate-detail-sheet.tsx`**

Ajouter la section judge après les quality signals :

```tsx
{candidate.judge_result && (
  <div className="space-y-2 border-t pt-3">
    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
      Évaluation LLM-as-judge
    </p>
    <div className={cn(
      'text-xs rounded px-3 py-2 font-medium',
      candidate.judge_result.overall_recommendation === 'accept' && 'bg-green-50 text-green-800 dark:bg-green-950/30',
      candidate.judge_result.overall_recommendation === 'review' && 'bg-amber-50 text-amber-800 dark:bg-amber-950/30',
      candidate.judge_result.overall_recommendation === 'reject' && 'bg-red-50 text-red-800 dark:bg-red-950/30',
    )}>
      {candidate.judge_result.overall_recommendation.toUpperCase()} — {candidate.judge_result.overall_reason}
    </div>
    {(['reusability', 'semantic_coherence', 'classification_accuracy'] as const).map((dim) => {
      const v = candidate.judge_result![dim];
      return (
        <div key={dim} className="text-xs text-muted-foreground">
          <span className="font-medium capitalize">{dim.replace('_', ' ')}</span>
          {' '}
          <span className={cn(
            v.verdict === 'pass' && 'text-green-700',
            v.verdict === 'partial' && 'text-amber-700',
            v.verdict === 'fail' && 'text-red-700',
          )}>[{v.verdict}]</span>
          {' '}{v.reason}
        </div>
      );
    })}
  </div>
)}
```

- [ ] **Vérifier le typage web**

```bash
npx tsc --project packages/web/tsconfig.json --noEmit
```
Expected: aucune erreur.

- [ ] **Commit final Niveau 3**

```bash
git add packages/server/src/services/quality-judge.ts \
        packages/server/src/db/schema.ts \
        packages/server/src/services/harvester-pipeline.ts \
        packages/server/src/services/harvester-service.ts \
        packages/web/src/api/types.ts \
        packages/web/src/components/candidate-detail-sheet.tsx
git commit -m "feat(harvest): LLM-as-judge on ambiguous fragments (warnings, not exact dupes)"
```

---

## Critères de succès (section 4.10 du plan)

- [ ] Aucun fragment ne s'affiche avec un score numérique `%` seul
- [ ] Les fragments dupliqués exacts sont systématiquement détectés **même Milvus off** (score 1.0)
- [ ] Les flags qualitatifs (au moins 3 signaux) apparaissent pour chaque fragment
- [ ] Le tri en page Validation met les fragments `error`/`warning` en premier
- [ ] Le slider `min_confidence` n'apparaît plus en page Ingestion
- [ ] **Métrique de validation** : injecter un fragment `pricing` classé en `function_type: technical` → doit déclencher au moins 2 warnings (subject_coherence + entity_coverage)
