# Multi-Agent Self-Consistency (Phase 2 agentic-only) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** En mode `agentic-only`, lancer 2 appels LLM en parallèle lors de la Phase 2 (jugement fragment-par-fragment) avec des températures différentes (0.2 et 0.4) et utiliser le score minimum comme consensus, éliminant les faux positifs dus à l'instabilité du LLM.

**Architecture:** Modifier `LlmClient.chatMessages()` pour accepter un override de température par appel. Ajouter un flag `selfConsistency` à `AgenticRetriever` (activé uniquement via le factory pour `agentic-only`). Extraire la logique de jugement dans `judgeFragmentWithTemp()` et créer `judgeFragmentPair()` pour les 2 agents en parallèle.

**Tech Stack:** TypeScript, Vitest, fichiers impactés dans `packages/server/src/`

---

## File Structure

| Action | Fichier | Responsabilité |
|--------|---------|----------------|
| Modify | `packages/server/src/services/llm-client.ts` | Ajouter `options?: { temperature?: number }` à `chatMessages()` |
| Modify | `packages/server/src/retrieval/agentic-retriever.ts` | Ajouter `selfConsistency` option, `judgeFragmentWithTemp()`, `judgeFragmentPair()` |
| Modify | `packages/server/src/retrieval/factory.ts` | Passer `{ selfConsistency: true }` pour `agentic-only` |
| Modify | `packages/server/src/retrieval/retrieval.test.ts` | Ajouter tests self-consistency |

---

## Task 1: Étendre LlmClient.chatMessages() pour override de température par appel

**Files:**
- Modify: `packages/server/src/services/llm-client.ts`

- [ ] **Step 1: Écrire le test qui vérifie l'override de température**

```typescript
// À ajouter dans packages/server/src/retrieval/retrieval.test.ts
// (ou dans un nouveau fichier packages/server/src/services/llm-client.test.ts)

import { describe, it, expect, vi } from 'vitest';
import { LlmClient, type LlmClientConfig } from '../services/llm-client.js';

describe('LlmClient.chatMessages temperature override', () => {
  function makeClient(defaultTemp = 0.3): LlmClient {
    const config: LlmClientConfig = {
      endpoint: 'http://fake-llm',
      model: 'test-model',
      temperature: defaultTemp,
      timeout: 5000,
    };
    return new LlmClient(config);
  }

  it('uses config.temperature by default', async () => {
    const client = makeClient(0.3);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    } as Response);

    await client.chatMessages([{ role: 'user', content: 'test' }]);

    const body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string);
    expect(body.temperature).toBe(0.3);
    fetchSpy.mockRestore();
  });

  it('uses options.temperature when provided, overriding config', async () => {
    const client = makeClient(0.3);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    } as Response);

    await client.chatMessages([{ role: 'user', content: 'test' }], { temperature: 0.7 });

    const body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string);
    expect(body.temperature).toBe(0.7);
    fetchSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue (chatMessages ne prend pas encore d'options)**

```bash
cd packages/server && pnpm vitest run src/retrieval/retrieval.test.ts 2>&1 | tail -20
```

Attendu: erreur TypeScript ou test fail car signature ne correspond pas.

- [ ] **Step 3: Modifier `LlmClient.chatMessages()` pour accepter l'override**

Dans `packages/server/src/services/llm-client.ts`, modifier la signature et le body de fetch:

```typescript
// Avant:
async chatMessages(messages: ChatMessage[]): Promise<string> {

// Après:
async chatMessages(messages: ChatMessage[], options?: { temperature?: number }): Promise<string> {
```

Et dans le `JSON.stringify` du body:

```typescript
// Avant:
body: JSON.stringify({
  model: this.config.model,
  temperature: this.config.temperature,
  messages,
}),

// Après:
body: JSON.stringify({
  model: this.config.model,
  temperature: options?.temperature ?? this.config.temperature,
  messages,
}),
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

```bash
cd packages/server && pnpm vitest run src/retrieval/retrieval.test.ts 2>&1 | tail -20
```

Attendu: PASS — les 2 tests `LlmClient.chatMessages temperature override` passent.

- [ ] **Step 5: Typecheck**

```bash
cd packages/server && pnpm typecheck 2>&1 | head -20
```

Attendu: 0 erreur.

---

## Task 2: Refactoriser judgeFragment en judgeFragmentWithTemp

**Files:**
- Modify: `packages/server/src/retrieval/agentic-retriever.ts`

- [ ] **Step 1: Écrire le test qui vérifie que judgeFragment passe la température au LLM**

Ajouter dans `retrieval.test.ts`, describe `AgenticRetriever` existant:

```typescript
it('judgeFragment passes temperature to LlmClient when provided', async () => {
  // On va vérifier que chatMessages reçoit le bon call count
  // Le fakeLlmClient ne capture pas temperature, donc on teste via vi.fn spy
  const llmSpy = vi.fn(async (_msgs: unknown[], opts?: { temperature?: number }) => {
    // On log pour vérification
    return opts?.temperature === 0.4
      ? '{"score": 6, "reason": "temp-0.4"}'
      : '{"score": 8, "reason": "default"}';
  });
  const fakeLlm = { chatMessages: llmSpy } as unknown as LlmClient;

  // AgenticRetriever avec selfConsistency=false (pas encore implémenté, juste judgeFragmentWithTemp)
  const retriever = new AgenticRetriever(
    fakeIndexService(),
    fakeLlm,
    fakeFragmentService({ 'frag-uuid-1': 'body' }),
  );

  await retriever.searchForSection({ text: 'test', filters: {}, collectionSlug: null });

  // Phase1 call + Phase2 call — vérifier que le 2e call n'a pas de temperature override
  // (selfConsistency=false par défaut)
  const phase2Call = llmSpy.mock.calls[1];
  expect(phase2Call).toBeDefined();
  // Par défaut, aucun options override
  expect(phase2Call?.[1]).toBeUndefined();
});
```

- [ ] **Step 2: Lancer pour voir fail (la méthode judgeFragmentWithTemp n'existe pas encore)**

```bash
cd packages/server && pnpm vitest run src/retrieval/retrieval.test.ts 2>&1 | tail -20
```

- [ ] **Step 3: Renommer `judgeFragment` en `judgeFragmentWithTemp` et ajouter le paramètre temperature**

Dans `packages/server/src/retrieval/agentic-retriever.ts`:

```typescript
// Remplacer:
private async judgeFragment(
  query: SectionQuery,
  fragmentId: string,
): Promise<RetrievedFragment | null> {

// Par:
private async judgeFragmentWithTemp(
  query: SectionQuery,
  fragmentId: string,
  temperature?: number,
): Promise<RetrievedFragment | null> {
```

Et dans le corps, modifier l'appel chatMessages:

```typescript
// Avant:
const response = await this.llm.chatMessages([{ role: 'user', content: prompt }]);

// Après:
const response = await this.llm.chatMessages(
  [{ role: 'user', content: prompt }],
  temperature !== undefined ? { temperature } : undefined,
);
```

Mettre à jour l'appel dans `searchForSection` (Phase 2):

```typescript
// Avant:
const scored = (
  await Promise.all(candidateIds.map((id) => this.judgeFragment(query, id)))
).filter((r): r is RetrievedFragment => r !== null && r.score >= PHASE2_SCORE_MIN);

// Après:
const scored = (
  await Promise.all(candidateIds.map((id) => this.judgeFragmentWithTemp(query, id)))
).filter((r): r is RetrievedFragment => r !== null && r.score >= PHASE2_SCORE_MIN);
```

- [ ] **Step 4: Lancer tous les tests existants pour vérifier qu'ils passent encore**

```bash
cd packages/server && pnpm vitest run src/retrieval/retrieval.test.ts 2>&1 | tail -30
```

Attendu: tous les tests existants PASS (le rename est transparent).

- [ ] **Step 5: Typecheck**

```bash
cd packages/server && pnpm typecheck 2>&1 | head -20
```

---

## Task 3: Implémenter judgeFragmentPair() avec self-consistency

**Files:**
- Modify: `packages/server/src/retrieval/agentic-retriever.ts`

- [ ] **Step 1: Écrire les tests de self-consistency**

Ajouter dans `retrieval.test.ts`:

```typescript
describe('AgenticRetriever — self-consistency (Phase 2)', () => {
  it('calls judgeFragment twice with different temperatures (0.2 and 0.4)', async () => {
    const temperatures: number[] = [];
    const llmSpy = vi.fn(async (_msgs: unknown[], opts?: { temperature?: number }) => {
      // Phase1 call has no temperature override
      if (opts?.temperature !== undefined) temperatures.push(opts.temperature);
      if (temperatures.length === 0) return '["frag-uuid-1"]'; // phase1
      return '{"score": 8, "reason": "ok"}'; // phase2
    });
    const fakeLlm = { chatMessages: llmSpy } as unknown as LlmClient;

    const retriever = new AgenticRetriever(
      fakeIndexService(),
      fakeLlm,
      fakeFragmentService({ 'frag-uuid-1': 'body' }),
      { selfConsistency: true },
    );

    await retriever.searchForSection({ text: 'test', filters: {}, collectionSlug: null });

    // Phase2 doit avoir 2 calls avec temperature (les 2 agents)
    expect(temperatures).toHaveLength(2);
    expect(temperatures).toContain(0.2);
    expect(temperatures).toContain(0.4);
  });

  it('uses minimum of 2 agent scores as final score', async () => {
    let callCount = 0;
    const llmSpy = vi.fn(async () => {
      callCount++;
      if (callCount === 1) return '["frag-uuid-1"]'; // phase1
      if (callCount === 2) return '{"score": 8, "reason": "agent1"}'; // agent1 score=8 → 0.8
      return '{"score": 3, "reason": "agent2"}'; // agent2 score=3 → 0.3
    });
    const fakeLlm = { chatMessages: llmSpy } as unknown as LlmClient;

    const retriever = new AgenticRetriever(
      fakeIndexService(),
      fakeLlm,
      fakeFragmentService({ 'frag-uuid-1': 'body' }),
      { selfConsistency: true },
    );

    const results = await retriever.searchForSection({ text: 'test', filters: {}, collectionSlug: null });

    // Score final = min(0.8, 0.3) = 0.3
    expect(results).toHaveLength(1);
    expect(results[0].score).toBeCloseTo(0.3);
  });

  it('drops fragment when min score is below threshold (0.3)', async () => {
    let callCount = 0;
    const llmSpy = vi.fn(async () => {
      callCount++;
      if (callCount === 1) return '["frag-uuid-1"]'; // phase1
      if (callCount === 2) return '{"score": 8, "reason": "agent1"}'; // 0.8
      return '{"score": 2, "reason": "agent2"}'; // 0.2 < 0.3 threshold
    });
    const fakeLlm = { chatMessages: llmSpy } as unknown as LlmClient;

    const retriever = new AgenticRetriever(
      fakeIndexService(),
      fakeLlm,
      fakeFragmentService({ 'frag-uuid-1': 'body' }),
      { selfConsistency: true },
    );

    const results = await retriever.searchForSection({ text: 'test', filters: {}, collectionSlug: null });

    // min(0.8, 0.2) = 0.2 < 0.3 → dropped
    expect(results).toHaveLength(0);
  });

  it('logs STRONG_DISAGREEMENT when agents differ by > 0.3', async () => {
    let callCount = 0;
    const llmSpy = vi.fn(async () => {
      callCount++;
      if (callCount === 1) return '["frag-uuid-1"]';
      if (callCount === 2) return '{"score": 9, "reason": "agent1"}'; // 0.9
      return '{"score": 4, "reason": "agent2"}'; // 0.4 → diff = 0.5 > 0.3
    });
    const fakeLlm = { chatMessages: llmSpy } as unknown as LlmClient;

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const retriever = new AgenticRetriever(
      fakeIndexService(),
      fakeLlm,
      fakeFragmentService({ 'frag-uuid-1': 'body' }),
      { selfConsistency: true },
    );

    await retriever.searchForSection({ text: 'test', filters: {}, collectionSlug: null });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('STRONG_DISAGREEMENT'),
    );
    warnSpy.mockRestore();
  });

  it('does NOT use self-consistency when selfConsistency=false (default)', async () => {
    let callCount = 0;
    const llmSpy = vi.fn(async () => {
      callCount++;
      if (callCount === 1) return '["frag-uuid-1"]';
      return '{"score": 7, "reason": "ok"}';
    });
    const fakeLlm = { chatMessages: llmSpy } as unknown as LlmClient;

    const retriever = new AgenticRetriever(
      fakeIndexService(),
      fakeLlm,
      fakeFragmentService({ 'frag-uuid-1': 'body' }),
      // selfConsistency absent → false
    );

    await retriever.searchForSection({ text: 'test', filters: {}, collectionSlug: null });

    // Phase1 (1 call) + Phase2 single agent (1 call) = 2 total
    expect(llmSpy.mock.calls).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Lancer les tests pour voir fail**

```bash
cd packages/server && pnpm vitest run src/retrieval/retrieval.test.ts --reporter verbose 2>&1 | grep "FAIL\|PASS\|self-consistency"
```

Attendu: erreur TypeScript car `AgenticRetriever` ne prend pas encore `options`.

- [ ] **Step 3: Ajouter les constantes et le constructeur avec selfConsistency**

En tête de `packages/server/src/retrieval/agentic-retriever.ts`, ajouter après les constantes existantes:

```typescript
const SELF_CONSISTENCY_AGENT1_TEMP = 0.2;
const SELF_CONSISTENCY_AGENT2_TEMP = 0.4;
const STRONG_DISAGREEMENT_THRESHOLD = 0.3;
```

Modifier le constructeur:

```typescript
// Avant:
export class AgenticRetriever implements FragmentRetriever {
  constructor(
    private indexService: IndexService,
    private llm: LlmClient,
    private fragmentService: FragmentService,
  ) {}

// Après:
export class AgenticRetriever implements FragmentRetriever {
  private selfConsistency: boolean;

  constructor(
    private indexService: IndexService,
    private llm: LlmClient,
    private fragmentService: FragmentService,
    options: { selfConsistency?: boolean } = {},
  ) {
    this.selfConsistency = options.selfConsistency ?? false;
  }
```

- [ ] **Step 4: Ajouter judgeFragmentPair() après judgeFragmentWithTemp()**

Ajouter après la méthode `judgeFragmentWithTemp` dans `agentic-retriever.ts`:

```typescript
private async judgeFragmentPair(
  query: SectionQuery,
  fragmentId: string,
): Promise<RetrievedFragment | null> {
  const [result1, result2] = await Promise.all([
    this.judgeFragmentWithTemp(query, fragmentId, SELF_CONSISTENCY_AGENT1_TEMP),
    this.judgeFragmentWithTemp(query, fragmentId, SELF_CONSISTENCY_AGENT2_TEMP),
  ]);

  if (!result1 && !result2) return null;
  if (!result1) {
    console.warn(
      `[retrieval][agentic-only][phase2][${fragmentId.slice(0, 8)}] Agent 1 failed, using agent 2 only`,
    );
    return result2;
  }
  if (!result2) {
    console.warn(
      `[retrieval][agentic-only][phase2][${fragmentId.slice(0, 8)}] Agent 2 failed, using agent 1 only`,
    );
    return result1;
  }

  const finalScore = Math.min(result1.score, result2.score);
  const disagreement = Math.abs(result1.score - result2.score);

  console.debug(
    `[retrieval][agentic-only][phase2][${fragmentId.slice(0, 8)}] ` +
      `agent1=${result1.score.toFixed(2)} agent2=${result2.score.toFixed(2)} ` +
      `→ final=${finalScore.toFixed(2)} (min)`,
  );

  if (disagreement > STRONG_DISAGREEMENT_THRESHOLD) {
    console.warn(
      `[retrieval][agentic-only][phase2][${fragmentId.slice(0, 8)}] ` +
        `STRONG_DISAGREEMENT: scores=${result1.score.toFixed(2)}/${result2.score.toFixed(2)} ` +
        `(diff=${disagreement.toFixed(2)}, threshold=${STRONG_DISAGREEMENT_THRESHOLD})`,
    );
  }

  // Justification de l'agent qui a donné le score le plus bas (cohérent avec la stratégie min)
  const finalAgent = result1.score <= result2.score ? result1 : result2;
  return {
    ...finalAgent,
    score: finalScore,
  };
}
```

- [ ] **Step 5: Brancher judgeFragmentPair dans searchForSection (Phase 2)**

Remplacer la boucle Phase 2 dans `searchForSection` :

```typescript
// Avant:
const scored = (
  await Promise.all(candidateIds.map((id) => this.judgeFragmentWithTemp(query, id)))
).filter((r): r is RetrievedFragment => r !== null && r.score >= PHASE2_SCORE_MIN);
console.debug(
  `[retrieval][agentic-only][phase2] section "${query.text.slice(0, 50)}" → kept ${scored.length}/${candidateIds.length} (score >= ${PHASE2_SCORE_MIN})`,
);

// Après:
const judgeOnce = (id: string) => this.judgeFragmentWithTemp(query, id);
const judgeWithConsistency = (id: string) => this.judgeFragmentPair(query, id);
const judge = this.selfConsistency ? judgeWithConsistency : judgeOnce;

const allResults = await Promise.all(candidateIds.map(judge));
const scored = allResults.filter(
  (r): r is RetrievedFragment => r !== null && r.score >= PHASE2_SCORE_MIN,
);

console.info(
  `[retrieval][agentic-only][phase2] section "${query.text.slice(0, 50)}" ` +
    `kept ${scored.length}/${candidateIds.length} ` +
    `(threshold=${PHASE2_SCORE_MIN}, self-consistency=${this.selfConsistency})`,
);
```

- [ ] **Step 6: Lancer les tests**

```bash
cd packages/server && pnpm vitest run src/retrieval/retrieval.test.ts --reporter verbose 2>&1 | tail -40
```

Attendu: tous les tests PASS, y compris les 5 nouveaux tests self-consistency.

- [ ] **Step 7: Typecheck**

```bash
cd packages/server && pnpm typecheck 2>&1 | head -20
```

---

## Task 4: Activer selfConsistency dans le factory pour agentic-only

**Files:**
- Modify: `packages/server/src/retrieval/factory.ts`

- [ ] **Step 1: Écrire le test qui vérifie que agentic-only utilise selfConsistency**

Ajouter dans le describe `factory` existant de `retrieval.test.ts`:

```typescript
it('agentic-only retriever has selfConsistency enabled (2 LLM calls for Phase2)', async () => {
  let callCount = 0;
  const llmSpy = vi.fn(async () => {
    callCount++;
    if (callCount === 1) return '["frag-uuid-1"]';
    return '{"score": 7, "reason": "ok"}';
  });

  const deps: RetrieverDeps = {
    searchService: fakeSearchService(),
    llm: { chatMessages: llmSpy } as unknown as LlmClient,
    indexService: fakeIndexService(),
    fragmentService: fakeFragmentService({ 'frag-uuid-1': 'body' }),
  };

  const retriever = createRetriever('agentic-only', deps);
  await retriever.searchForSection({ text: 'test', filters: {}, collectionSlug: null });

  // Phase1 (1 call) + Phase2 dual-agent (2 calls) = 3 total
  expect(llmSpy.mock.calls).toHaveLength(3);
});

it('hybrid retriever does NOT use selfConsistency (1 LLM call for Phase2)', async () => {
  const candidates = [
    { ...SAMPLE_RESULT, id: 'f1' },
    { ...SAMPLE_RESULT, id: 'f2' },
  ];
  const svc = fakeSearchService(candidates);
  // HybridRetriever: 1 LLM call for re-ranking (no double agent)
  let callCount = 0;
  const llmSpy = vi.fn(async () => {
    callCount++;
    return JSON.stringify([{ id: 'f1', score: 9 }, { id: 'f2', score: 5 }]);
  });
  const deps: RetrieverDeps = {
    searchService: svc,
    llm: { chatMessages: llmSpy } as unknown as LlmClient,
    indexService: fakeIndexService(),
    fragmentService: fakeFragmentService(),
  };
  const retriever = createRetriever('hybrid', deps);
  await retriever.searchForSection({ text: 'x', filters: {}, collectionSlug: null }, 2);
  expect(llmSpy.mock.calls).toHaveLength(1); // 1 seul appel (pas 2)
});
```

- [ ] **Step 2: Lancer le test pour le voir fail**

```bash
cd packages/server && pnpm vitest run src/retrieval/retrieval.test.ts -t "selfConsistency enabled" 2>&1 | tail -15
```

Attendu: FAIL (agentic-only ne passe pas encore `selfConsistency: true`).

- [ ] **Step 3: Modifier le factory**

Dans `packages/server/src/retrieval/factory.ts`, modifier le `switch`:

```typescript
// Avant:
case 'agentic-only':
  return new AgenticRetriever(deps.indexService, deps.llm, deps.fragmentService);

// Après:
case 'agentic-only':
  return new AgenticRetriever(deps.indexService, deps.llm, deps.fragmentService, {
    selfConsistency: true,
  });
```

- [ ] **Step 4: Lancer tous les tests**

```bash
cd packages/server && pnpm vitest run src/retrieval/retrieval.test.ts --reporter verbose 2>&1 | tail -40
```

Attendu: tous les tests PASS.

- [ ] **Step 5: Lancer la suite complète**

```bash
cd packages/server && pnpm test 2>&1 | tail -20
```

Attendu: 0 échec.

- [ ] **Step 6: Vérifier la cohérence d'échelle 0-10 → 0-1 dans tout agentic-retriever.ts**

```bash
# Chercher toute comparaison >= 3 ou <= 3 qui trahirait une confusion d'échelle
grep -n ">= 3\|<= 3\|> 3\|< 3\b\|score.*[^0]\.[0-9]" packages/server/src/retrieval/agentic-retriever.ts
```

Vérifier manuellement que :
- Le LLM retourne `{"score": 8}` (0-10 brut)
- La normalisation `rawScore / 10` se fait bien dans `judgeFragmentWithTemp`
- `PHASE2_SCORE_MIN = 0.3` (échelle 0-1) — cohérent avec `3/10`
- `STRONG_DISAGREEMENT_THRESHOLD = 0.3` (échelle 0-1) — cohérent avec `3/10`
- Aucun endroit ne compare `score >= 3` directement (le `>= 3` existant dans le code serait un bug)

- [ ] **Step 7: Typecheck final**

```bash
pnpm --filter @fragmint/server typecheck && echo "OK"
```

---

## Task 5: Validation manuelle

- [ ] **Step 1: Démarrer le stack dev**

```bash
docker compose -f docker/docker-compose.dev.yml up -d
```

- [ ] **Step 2: Switcher en agentic-only et observer les logs**

```bash
# Récupérer un token admin depuis la DB ou les logs de démarrage
TOKEN="frag_tok_..."

# Activer agentic-only
curl -s -X POST http://localhost:3210/v1/admin/retrieval/mode \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"mode":"agentic-only"}' | jq .

# Vérifier
curl -s http://localhost:3210/v1/admin/retrieval/mode \
  -H "Authorization: Bearer $TOKEN" | jq .
```

- [ ] **Step 3: Lancer une validation de plan et observer les logs Phase 2**

```bash
# Watch les logs filtré sur phase2
docker compose -f docker/docker-compose.dev.yml logs fragmint-server -f | grep "phase2"

# Dans un autre terminal, valider un plan existant
curl -s -X POST "http://localhost:3210/v1/plans/<PLAN_ID>/validate-fragments" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

Attendu dans les logs :
```
[retrieval][agentic-only][phase2][<uuid8>] agent1=0.80 agent2=0.75 → final=0.75 (min)
[retrieval][agentic-only][phase2][<uuid8>] agent1=0.90 agent2=0.35 → final=0.35 (min)
[retrieval][agentic-only][phase2][<uuid8>] STRONG_DISAGREEMENT: scores=0.90/0.35 (diff=0.55, threshold=0.3)
[retrieval][agentic-only][phase2] section "..." kept 4/15 (threshold=0.3, self-consistency=true)
```

- [ ] **Step 4: Vérifier que le nombre d'appels LLM est bien doublé en Phase 2**

Observer que pour N candidats en Phase 2, il y a bien 2N appels LLM (et non N).

- [ ] **Step 5: Comparer avec vector-only pour vérifier que la précision est différente**

```bash
curl -s -X POST http://localhost:3210/v1/admin/retrieval/mode \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"mode":"vector-only"}'

# Relancer la validation du même plan, noter les fragments choisis
```

---

## Résumé des changements

| Fichier | Lignes impactées | Nature |
|---------|-----------------|--------|
| `packages/server/src/services/llm-client.ts` | ~5 lignes | Signature + body JSON |
| `packages/server/src/retrieval/agentic-retriever.ts` | ~50 lignes | Constantes, constructeur, 2 méthodes, branchement Phase 2 |
| `packages/server/src/retrieval/factory.ts` | ~3 lignes | Option `selfConsistency: true` pour agentic-only |
| `packages/server/src/retrieval/retrieval.test.ts` | ~120 lignes | 7 nouveaux tests |

**Estimation** : 1.5-2h

**Impact runtime** : Phase 2 double le nombre d'appels LLM (de `N` à `2N`). Latence quasi-identique grâce au parallélisme (`Promise.all`). En hybrid et vector-only : aucun changement.
