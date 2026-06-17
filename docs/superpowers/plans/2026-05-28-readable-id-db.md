# readable_id persistant en DB Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter `readable_id TEXT UNIQUE` à la table `fragments`, le générer automatiquement à l'ingestion selon le pattern `LS-ref-003`, migrer les fragments existants, et l'exposer dans tous les endpoints REST et tools MCP — permettant au LLM (et aux humains) de référencer les fragments par ID lisible stable.

**Architecture:** Le readable_id est généré par un utilitaire `readable-id.ts` appelé dans `FragmentService.create()` et dans `reindex()`. Il est persisté en DB (stable), remplaçant le calcul à la volée de `index-service.ts` qui change à chaque ajout/suppression. `GET /v1/fragments/:id` accepte UUID ou readable_id. Les tools MCP passent l'ID tel quel au backend.

**Tech Stack:** TypeScript, Drizzle ORM (SQLite), Fastify 5, Vitest, `drizzle-orm` (`like`, `eq`, `desc`).

---

## File map

### Create
- `packages/server/src/services/readable-id.ts` — utilitaire SUBJECT_ABBR, TYPE_ABBR, generateReadableId()
- `packages/server/src/services/readable-id.test.ts` — tests unitaires
- `packages/server/src/scripts/migrate-readable-ids.ts` — script one-shot migration

### Modify
- `packages/server/src/db/schema.ts:3-27` — ajouter `readable_id` à la table `fragments`
- `packages/server/src/db/connection.ts` — ALTER TABLE + CREATE UNIQUE INDEX + CREATE TABLE initial
- `packages/server/src/services/fragment-service.ts` — `create()` : générer readable_id ; `reindex()` : idem
- `packages/server/src/services/index-service.ts` — utiliser readable_id depuis DB au lieu de le recalculer
- `packages/server/src/routes/fragment-routes.ts:133-147` — dual lookup UUID ou readable_id
- `packages/mcp/src/tools/fragment-get.ts` — mettre à jour description du paramètre `id`

---

## Task 1 : Ajouter readable_id au schema DB

**Files:**
- Modify: `packages/server/src/db/schema.ts:3-27`
- Modify: `packages/server/src/db/connection.ts`

- [ ] **Step 1 : Ajouter la colonne dans le schema Drizzle**

Dans `packages/server/src/db/schema.ts`, après la ligne `git_hash: text('git_hash'),` (ligne ~18), ajouter :

```typescript
  readable_id: text('readable_id').unique(),
```

Résultat attendu dans la table `fragments` :
```typescript
export const fragments = sqliteTable('fragments', {
  id: text('id').primaryKey(),
  // ... autres colonnes ...
  git_hash: text('git_hash'),
  readable_id: text('readable_id').unique(),   // ← NOUVEAU
  origin: text('origin').notNull().default('manual'),
  // ...
});
```

- [ ] **Step 2 : Ajouter la migration idempotente dans connection.ts**

Lire `packages/server/src/db/connection.ts` pour trouver la fin du bloc des migrations `try/catch`. Ajouter APRÈS le dernier bloc :

```typescript
try {
  sqlite.exec('ALTER TABLE fragments ADD COLUMN readable_id TEXT');
} catch (_) {}
try {
  sqlite.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_fragments_readable_id ON fragments(readable_id)',
  );
} catch (_) {}
```

- [ ] **Step 3 : Mettre à jour le CREATE TABLE initial dans connection.ts**

Dans le bloc `CREATE TABLE IF NOT EXISTS fragments` (début du fichier, vers ligne 14), ajouter `readable_id TEXT UNIQUE` juste avant la fermeture `)`. Ce bloc initialise les bases `:memory:` des tests.

- [ ] **Step 4 : Vérifier les types**

```bash
pnpm --filter @fragmint/server typecheck
```

Expected : exit 0, aucune erreur.

- [ ] **Step 5 : Vérifier les tests existants**

```bash
pnpm --filter @fragmint/server test
```

Expected : les tests qui utilisent `createDb(':memory:')` passent toujours (la colonne nullable ne casse rien).

- [ ] **Step 6 : Commit**

```bash
git add packages/server/src/db/schema.ts packages/server/src/db/connection.ts
git commit -m "feat(db): add readable_id column to fragments"
```

---

## Task 2 : Créer l'utilitaire readable-id.ts

**Files:**
- Create: `packages/server/src/services/readable-id.ts`
- Create: `packages/server/src/services/readable-id.test.ts`

- [ ] **Step 1 : Écrire le test unitaire (fail first)**

Créer `packages/server/src/services/readable-id.test.ts` :

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { createDb } from '../db/connection.js';
import { fragments } from '../db/schema.js';
import { generateReadableId } from './readable-id.js';

describe('generateReadableId', () => {
  let db: ReturnType<typeof createDb>;

  beforeEach(() => {
    db = createDb(':memory:');
  });

  it('génère LS-ref-001 pour le premier fragment linshare/reference', async () => {
    const id = await generateReadableId(db, 'linshare', 'reference');
    expect(id).toBe('LS-ref-001');
  });

  it('génère LS-ref-002 si LS-ref-001 existe déjà', async () => {
    await db.insert(fragments).values({
      id: 'frag-test', type: 'reference', domain: 'linshare', lang: 'fr',
      quality: 'draft', author: 'test', title: 'Test',
      body_excerpt: '', collection_slug: 'common',
      created_at: '2026-01-01', updated_at: '2026-01-01',
      file_path: 'test.md', origin: 'manual', uses: 0,
      readable_id: 'LS-ref-001',
    });
    const id = await generateReadableId(db, 'linshare', 'reference');
    expect(id).toBe('LS-ref-002');
  });

  it('utilise un préfixe de 3 chars uppercase pour domaine inconnu', async () => {
    const id = await generateReadableId(db, 'my-custom-domain', 'argument');
    expect(id).toBe('MYC-arg-001');
  });

  it('génère indépendamment par (domain, type)', async () => {
    const id1 = await generateReadableId(db, 'linshare', 'reference');
    const id2 = await generateReadableId(db, 'linshare', 'argument');
    expect(id1).toBe('LS-ref-001');
    expect(id2).toBe('LS-arg-001');
  });
});
```

- [ ] **Step 2 : Vérifier que le test échoue**

```bash
pnpm --filter @fragmint/server test readable-id
```

Expected : FAIL — `Cannot find module './readable-id.js'`.

- [ ] **Step 3 : Créer `packages/server/src/services/readable-id.ts`**

```typescript
import { like } from 'drizzle-orm';
import type { DrizzleDb } from '../db/connection.js';
import { fragments } from '../db/schema.js';

export const SUBJECT_ABBR: Record<string, string> = {
  linshare: 'LS',
  'twake-mail': 'TM',
  'twake-calendar': 'TC',
  'twake-drive': 'TD',
  'twake-chat': 'TCH',
  lincloud: 'LC',
  linto: 'LT',
  openrag: 'OR',
  'linagora-corp': 'LIN',
};

export const TYPE_ABBR: Record<string, string> = {
  reference: 'ref',
  argument: 'arg',
  'use-case': 'uc',
  description: 'desc',
  pricing: 'pri',
  clause: 'cla',
  faq: 'faq',
  introduction: 'intro',
  engagement: 'eng',
  methodology: 'meth',
  bio: 'bio',
  temoignage: 'temo',
  conclusion: 'conc',
};

function domainAbbr(domain: string): string {
  return SUBJECT_ABBR[domain] ?? domain.replace(/-/g, '').slice(0, 3).toUpperCase();
}

function typeAbbr(type: string): string {
  return TYPE_ABBR[type] ?? type.slice(0, 3).toLowerCase();
}

/**
 * Génère un readable_id unique et monotone croissant pour un fragment.
 * Format : {DOMAIN_ABBR}-{TYPE_ABBR}-{NNN} ex: LS-ref-003
 * Utilise LIKE pour trouver le MAX numéro existant pour ce (domain, type).
 */
export async function generateReadableId(
  db: DrizzleDb,
  domain: string,
  type: string,
): Promise<string> {
  const da = domainAbbr(domain);
  const ta = typeAbbr(type);
  const prefix = `${da}-${ta}-`;

  const rows = await db
    .select({ readable_id: fragments.readable_id })
    .from(fragments)
    .where(like(fragments.readable_id, `${prefix}%`));

  let maxNum = 0;
  for (const row of rows) {
    if (row.readable_id) {
      const match = row.readable_id.match(/-(\d+)$/);
      if (match) maxNum = Math.max(maxNum, parseInt(match[1], 10));
    }
  }

  return `${prefix}${String(maxNum + 1).padStart(3, '0')}`;
}
```

- [ ] **Step 4 : Vérifier que le type `DrizzleDb` est bien exporté depuis connection.ts**

```bash
grep -n "DrizzleDb\|export.*createDb\|export.*db" packages/server/src/db/connection.ts | head -10
```

Si `DrizzleDb` n'est pas exporté, l'ajouter dans `connection.ts` :
```typescript
export type DrizzleDb = ReturnType<typeof drizzle>;
```

- [ ] **Step 5 : Lancer les tests**

```bash
pnpm --filter @fragmint/server test readable-id
```

Expected : 4 tests PASS.

- [ ] **Step 6 : Commit**

```bash
git add packages/server/src/services/readable-id.ts packages/server/src/services/readable-id.test.ts
git commit -m "feat(fragments): readable-id generation utility"
```

---

## Task 3 : Générer readable_id à l'ingestion (fragment-service.ts)

**Files:**
- Modify: `packages/server/src/services/fragment-service.ts`

- [ ] **Step 1 : Ajouter l'import**

Dans `packages/server/src/services/fragment-service.ts`, ajouter en haut des imports :

```typescript
import { generateReadableId } from './readable-id.js';
```

- [ ] **Step 2 : Modifier la méthode `create()`**

Trouver la méthode `create()` (ligne ~70). Après `const id = generateId();`, ajouter :

```typescript
const readableId = await generateReadableId(this.db, input.domain, input.type);
```

Puis dans le `.values({...})` de l'INSERT (ligne ~126-152), ajouter :

```typescript
readable_id: readableId,
```

- [ ] **Step 3 : Modifier la méthode `reindex()` (sync Git)**

Trouver `reindex()` (ligne ~874). Dans la boucle qui insère les fragments depuis Git, avant l'upsert, générer le readable_id si le fichier YAML frontmatter n'en contient pas. Ajouter après la lecture du fichier :

```typescript
// Générer readable_id si absent du frontmatter
const readableId = frontmatter.readable_id as string | undefined
  ?? await generateReadableId(this.db, frontmatter.domain as string, frontmatter.type as string);
```

Et inclure `readable_id: readableId` dans le `.values({...})` de l'upsert.

- [ ] **Step 4 : Vérifier les types**

```bash
pnpm --filter @fragmint/server typecheck
```

Expected : exit 0.

- [ ] **Step 5 : Test d'intégration rapide**

```bash
pnpm --filter @fragmint/server test fragments.integration
```

Vérifier que la réponse de `POST /v1/fragments` inclut maintenant un champ `readable_id`.

- [ ] **Step 6 : Commit**

```bash
git add packages/server/src/services/fragment-service.ts
git commit -m "feat(fragments): generate readable_id on create and reindex"
```

---

## Task 4 : Script de migration des fragments existants

**Files:**
- Create: `packages/server/src/scripts/migrate-readable-ids.ts`

- [ ] **Step 1 : Créer le script**

```typescript
#!/usr/bin/env tsx
// packages/server/src/scripts/migrate-readable-ids.ts
// Usage: npx tsx packages/server/src/scripts/migrate-readable-ids.ts
// Assigne un readable_id à tous les fragments qui n'en ont pas encore.
// Idempotent : ne modifie pas les fragments qui ont déjà un readable_id.

import { isNull } from 'drizzle-orm';
import { createDb } from '../db/connection.js';
import { fragments } from '../db/schema.js';
import { generateReadableId } from '../services/readable-id.js';

const DB_PATH = process.env.FRAGMINT_DB_PATH ?? '/data/vault/.fragmint.db';

const db = createDb(DB_PATH);

// Récupérer tous les fragments sans readable_id
const toMigrate = await db
  .select({ id: fragments.id, domain: fragments.domain, type: fragments.type })
  .from(fragments)
  .where(isNull(fragments.readable_id));

console.log(`Found ${toMigrate.length} fragments without readable_id`);

let count = 0;
for (const frag of toMigrate) {
  const readableId = await generateReadableId(db, frag.domain, frag.type);
  await db
    .update(fragments)
    .set({ readable_id: readableId })
    .where(eq(fragments.id, frag.id));
  count++;
  if (count % 50 === 0) console.log(`  Migrated ${count}/${toMigrate.length}...`);
}

console.log(`Done. Migrated ${count} fragments.`);
```

Ajouter l'import manquant en haut : `import { isNull, eq } from 'drizzle-orm';`

- [ ] **Step 2 : Lancer la migration (sur DB de dev locale si disponible)**

```bash
npx tsx packages/server/src/scripts/migrate-readable-ids.ts
```

Expected output :
```
Found N fragments without readable_id
Done. Migrated N fragments.
```

- [ ] **Step 3 : Vérifier qu'il ne reste aucun fragment sans readable_id**

```bash
sqlite3 /data/vault/.fragmint.db "SELECT COUNT(*) FROM fragments WHERE readable_id IS NULL"
```

Expected : `0`

- [ ] **Step 4 : Commit**

```bash
git add packages/server/src/scripts/migrate-readable-ids.ts
git commit -m "feat(scripts): migrate-readable-ids one-shot script"
```

---

## Task 5 : Dual lookup dans GET /v1/fragments/:id

**Files:**
- Modify: `packages/server/src/services/fragment-service.ts` — ajouter `getByReadableId()`
- Modify: `packages/server/src/routes/fragment-routes.ts:133-147`

- [ ] **Step 1 : Écrire le test d'intégration (fail first)**

Dans `packages/server/src/routes/fragments.integration.test.ts`, ajouter un test :

```typescript
it('GET /v1/fragments/:readableId retourne le fragment par readable_id', async () => {
  // Créer un fragment (il reçoit un readable_id auto)
  const createRes = await api('POST', '/v1/fragments', {
    type: 'argument', domain: 'linshare', lang: 'fr', body: 'Test body for readable id lookup',
  });
  expect(createRes.statusCode).toBe(201);
  const created = JSON.parse(createRes.body).data;
  const readableId = created.readable_id;
  expect(readableId).toMatch(/^LS-arg-\d+$/);

  // Lookup par readable_id
  const getRes = await api('GET', `/v1/fragments/${readableId}`);
  expect(getRes.statusCode).toBe(200);
  expect(JSON.parse(getRes.body).data.id).toBe(created.id);
});
```

- [ ] **Step 2 : Run pour vérifier FAIL**

```bash
pnpm --filter @fragmint/server test fragments.integration
```

Expected : nouveau test FAIL avec 404.

- [ ] **Step 3 : Ajouter `getByReadableId` dans fragment-service.ts**

Dans `packages/server/src/services/fragment-service.ts`, après la méthode `getById()`, ajouter :

```typescript
async getByReadableId(readableId: string): Promise<Fragment | null> {
  const rows = await this.db
    .select()
    .from(fragments)
    .where(eq(fragments.readable_id, readableId))
    .limit(1);
  if (!rows[0]) return null;
  return this.enrichFragment(rows[0]);
}
```

(Remplacer `enrichFragment` par le pattern réel utilisé dans `getById()` — copier exactement ce que `getById()` fait après son SELECT.)

- [ ] **Step 4 : Modifier le handler GET /v1/fragments/:id**

Dans `packages/server/src/routes/fragment-routes.ts`, modifier le handler `GET /v1/fragments/:id` (ligne ~133) :

```typescript
app.get(`${prefix}/fragments/:id`, { preHandler: readHandlers }, async (request, reply) => {
  const { id } = request.params as { id: string };
  // Essayer par UUID d'abord, puis par readable_id
  let frag = await fragmentService.getById(id);
  if (!frag && !id.startsWith('frag-')) {
    frag = await fragmentService.getByReadableId(id);
  }
  if (!frag)
    return reply.status(404).send({ data: null, meta: null, error: 'Fragment not found' });
  const data = {
    ...frag,
    tags: frag.tags
      ? typeof frag.tags === 'string'
        ? (JSON.parse(frag.tags) as string[])
        : frag.tags
      : [],
  };
  return { data, meta: null, error: null };
});
```

- [ ] **Step 5 : Lancer les tests**

```bash
pnpm --filter @fragmint/server test fragments.integration
```

Expected : tous les tests passent, y compris le nouveau.

- [ ] **Step 6 : Commit**

```bash
git add packages/server/src/services/fragment-service.ts packages/server/src/routes/fragment-routes.ts
git commit -m "feat(fragments): GET /v1/fragments/:id accepts readable_id"
```

---

## Task 6 : Mettre à jour index-service.ts

**Files:**
- Modify: `packages/server/src/services/index-service.ts`

- [ ] **Step 1 : Modifier `generate()` pour utiliser readable_id depuis DB**

Dans `index-service.ts`, dans la méthode `generate()`, le SELECT des fragments depuis DB doit inclure `readable_id`. Ajouter `readable_id: fragments.readable_id` dans le select si pas déjà présent.

Dans la boucle qui construit `IndexFragment`, utiliser le readable_id DB avec fallback sur l'ancien calcul :

```typescript
// Avant (calcul à la volée non stable) :
f.readable_id = `${prefix}-${short}-${String(i + 1).padStart(3, '0')}`;

// Après (DB d'abord, fallback sur calcul) :
f.readable_id = row.readable_id ?? `${prefix}-${short}-${String(i + 1).padStart(3, '0')}`;
```

- [ ] **Step 2 : Vérifier les types**

```bash
pnpm --filter @fragmint/server typecheck
```

Expected : exit 0.

- [ ] **Step 3 : Lancer tous les tests**

```bash
pnpm --filter @fragmint/server test
```

Expected : tous les tests existants passent.

- [ ] **Step 4 : Commit**

```bash
git add packages/server/src/services/index-service.ts
git commit -m "feat(index): use DB readable_id instead of computed value"
```

---

## Task 7 : Mettre à jour le tool MCP fragment_get

**Files:**
- Modify: `packages/mcp/src/tools/fragment-get.ts`

- [ ] **Step 1 : Mettre à jour la description du param `id`**

Dans `packages/mcp/src/tools/fragment-get.ts`, changer la description du paramètre `id` :

```typescript
// Avant :
id: { type: 'string', description: 'Fragment ID (e.g. "frag-f1a2b3c4-...")' },

// Après :
id: {
  type: 'string',
  description: 'Fragment UUID (frag-xxxx) or readable_id (LS-ref-003, TM-arg-012)',
},
```

- [ ] **Step 2 : Build MCP**

```bash
pnpm --filter @fragmint/mcp build
```

Expected : exit 0.

- [ ] **Step 3 : Commit final**

```bash
git add packages/mcp/src/tools/fragment-get.ts
git commit -m "feat(mcp): fragment_get accepts readable_id"
```

---

## Validation finale

```bash
# Types
pnpm --filter @fragmint/server typecheck
pnpm --filter @fragmint/mcp build

# Tests
pnpm --filter @fragmint/server test

# Migration (si DB locale disponible)
npx tsx packages/server/src/scripts/migrate-readable-ids.ts
sqlite3 /data/vault/.fragmint.db "SELECT id, readable_id FROM fragments LIMIT 10"
# → Chaque fragment a un readable_id non-null

# E2E curl (si serveur démarré)
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3210/v1/fragments/LS-arg-001 | jq .data.readable_id
# → "LS-arg-001"
```
