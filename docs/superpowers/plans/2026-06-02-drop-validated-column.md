# Drop `validated` Column — Referential Tables

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Supprimer la colonne `validated INTEGER` des tables `fragment_tags`, `fragment_domains`, `fragment_types`, `fragment_functions` et remplacer tous les usages par `status = 'active'`.

**Architecture:** `validated = 1` ↔ `status = 'active'` est invariant dans toute la codebase. Le refacto consiste à (1) supprimer la colonne en DB via migration SQLite, (2) mettre à jour le Drizzle schema, (3) remplacer chaque `eq(table.validated, 1/0)` et chaque `.set({ validated: ... })` côté serveur, (4) nettoyer le type et les composants côté web.

**Tech Stack:** SQLite 3.46.1 (supporte `ALTER TABLE ... DROP COLUMN`), Drizzle ORM, TypeScript, React.

---

## Mapping des remplacements

| Avant | Après |
|---|---|
| `eq(table.validated, 1)` | `eq(table.status, 'active')` |
| `eq(table.validated, 0)` (liste proposals) | `eq(table.status, 'pending')` |
| `eq(table.validated, 0)` (count pendants) | `ne(table.status, 'active')` |
| `.set({ validated: 1, status: 'active' })` | `.set({ status: 'active' })` |
| `.set({ validated: 0, status: 'rejected' })` | `.set({ status: 'rejected' })` |
| `.set({ status: 'archived', validated: 0 })` | `.set({ status: 'archived' })` |
| `validated: tagAutoValidated` dans insert | supprimer le champ |

---

## File Map

| Fichier | Action |
|---|---|
| `packages/server/src/db/schema.ts` | Supprimer `validated` des 4 tables |
| `packages/server/src/db/connection.ts` | Ajouter migration DROP COLUMN |
| `packages/server/src/routes/admin-metadata-routes.ts` | Remplacer tous les `validated` |
| `packages/server/src/routes/admin-metadata-helpers.ts` | Remplacer `validated` dans count + validatedTags |
| `packages/server/src/routes/admin-metadata-mutation-routes.ts` | Supprimer `validated` des `.set()` |
| `packages/server/src/routes/admin-referential-routes.ts` | Remplacer `validated` dans select + set |
| `packages/server/src/routes/admin-metadata-lookup-routes.ts` | Remplacer `eq(validated, 1)` |
| `packages/server/src/routes/harvest-routes.ts` | Supprimer `validated: 1` des inserts |
| `packages/server/src/services/harvest-hint-processor.ts` | Supprimer `validated` des inserts |
| `packages/server/src/services/fragment-service.ts` | Supprimer `validated: 1` des inserts |
| `packages/server/src/services/harvester-pipeline.ts` | Remplacer `eq(fragmentTags.validated, 1)` |
| `packages/web/src/types/admin-metadata.ts` | Supprimer `validated: boolean` |
| `packages/web/src/components/admin/referential-item-sheet.tsx` | Supprimer calcul `validated:` |
| `packages/web/src/components/admin/metadata/unified-metadata-card.tsx` | Supprimer calcul `validated:` |

---

## Task 1 — DB Schema + Migration

**Files:**
- Modify: `packages/server/src/db/schema.ts`
- Modify: `packages/server/src/db/connection.ts`

- [ ] **Step 1 : Supprimer `validated` du Drizzle schema**

Dans `packages/server/src/db/schema.ts`, retirer la ligne `validated: integer('validated').notNull().default(1),` des 4 tables :

```typescript
// fragment_types (autour de la ligne 205-215) — retirer :
validated: integer('validated').notNull().default(1),

// fragment_domains (autour de la ligne 220-230) — retirer :
validated: integer('validated').notNull().default(1),

// fragment_tags (autour de la ligne 235-245) — retirer :
validated: integer('validated').notNull().default(1),

// fragment_functions (autour de la ligne 260-265) — retirer :
validated: integer('validated').notNull().default(1),
```

- [ ] **Step 2 : Ajouter la migration DROP COLUMN dans `connection.ts`**

Trouver le dernier bloc `if (!columnExists(...))` ou la dernière migration numérotée dans `packages/server/src/db/connection.ts`. Ajouter à la fin des migrations :

```typescript
// Migration: drop redundant `validated` boolean — status='active' is the single source of truth
const validatedExistsOnTags = sqlite.prepare(
  "SELECT COUNT(*) as c FROM pragma_table_info('fragment_tags') WHERE name='validated'"
).get() as { c: number };
if (validatedExistsOnTags.c > 0) {
  sqlite.exec('ALTER TABLE fragment_tags DROP COLUMN validated');
  sqlite.exec('ALTER TABLE fragment_domains DROP COLUMN validated');
  sqlite.exec('ALTER TABLE fragment_types DROP COLUMN validated');
  sqlite.exec('ALTER TABLE fragment_functions DROP COLUMN validated');
}
```

- [ ] **Step 3 : Vérifier que le typecheck passe**

```bash
npx tsc --noEmit -p packages/server/tsconfig.json 2>&1 | head -30
```

Attendu : erreurs sur les fichiers qui utilisent encore `.validated` — c'est normal, on les corrige dans les tasks suivantes.

---

## Task 2 — Routes serveur

**Files:**
- Modify: `packages/server/src/routes/admin-metadata-routes.ts`
- Modify: `packages/server/src/routes/admin-metadata-helpers.ts`
- Modify: `packages/server/src/routes/admin-metadata-mutation-routes.ts`
- Modify: `packages/server/src/routes/admin-referential-routes.ts`
- Modify: `packages/server/src/routes/admin-metadata-lookup-routes.ts`
- Modify: `packages/server/src/routes/harvest-routes.ts`

- [ ] **Step 1 : `admin-metadata-routes.ts` — proposals list (ligne ~50)**

```typescript
// Avant :
const conditions: any[] = [eq(fragmentTags.validated, 0)];
// ...
const conditions: any[] = [eq(fragmentDomains.validated, 0)];

// Après :
const conditions: any[] = [eq(fragmentTags.status, 'pending')];
// ...
const conditions: any[] = [eq(fragmentDomains.status, 'pending')];
```

- [ ] **Step 2 : `admin-metadata-routes.ts` — champs retournés (lignes ~59, ~82, ~109)**

```typescript
// Retirer validated des select() et des objets retournés :
// Ligne ~59 — retirer : validated: fragmentTags.validated,
// Ligne ~82 — remplacer : validated: !!tag.validated,   →  supprimer la ligne
// Ligne ~109 — supprimer : validated: !!d.validated,
```

- [ ] **Step 3 : `admin-metadata-routes.ts` — approve/reject (lignes ~169, ~175, ~194, ~232, ~238)**

```typescript
// Approve tag/domain — retirer validated des .set() :
.set({ status: 'active', label: cleanLabel })

// Reject tag/domain :
.set({ status: 'rejected' })

// Rename (lignes ~232, ~238) :
.set({ slug: new_name, label: new_label ?? new_name })
```

- [ ] **Step 4 : `admin-metadata-routes.ts` — endpoint /validated (lignes ~309, ~313, ~317)**

```typescript
// Ligne ~309 — retirer : validated: fragmentTags.validated,
// Ligne ~313 — remplacer :
.where(eq(fragmentTags.validated, 1))
// →
.where(eq(fragmentTags.status, 'active'))

// Ligne ~317 :
.where(eq(fragmentDomains.validated, 1))
// →
.where(eq(fragmentDomains.status, 'active'))
```

- [ ] **Step 5 : `admin-metadata-helpers.ts` — validatedTags + pending count (lignes ~44-64)**

```typescript
// validatedTags query (ligne ~49) :
.where(eq(fragmentTags.validated, 1))
// →
.where(eq(fragmentTags.status, 'active'))

// Pending count (lignes ~63-64) :
db.select({ value: count() }).from(fragmentTags).where(eq(fragmentTags.validated, 0)),
db.select({ value: count() }).from(fragmentDomains).where(eq(fragmentDomains.validated, 0)),
// →
db.select({ value: count() }).from(fragmentTags).where(ne(fragmentTags.status, 'active')),
db.select({ value: count() }).from(fragmentDomains).where(ne(fragmentDomains.status, 'active')),
```

Vérifier que `ne` est importé depuis `drizzle-orm`.

- [ ] **Step 6 : `admin-metadata-mutation-routes.ts` (lignes ~29, ~33, ~39, ~43)**

```typescript
// Approve :
.set({ status: 'active', label: stripNew(String(item.id)) })

// Reject :
.set({ status: 'rejected' })
```

- [ ] **Step 7 : `admin-referential-routes.ts` (lignes ~123, ~162, ~447, ~488)**

```typescript
// Ligne ~123 — retirer : validated: fragmentTags.validated,
// Ligne ~162 :
.where(eq(fragmentTags.validated, 1))
// →
.where(eq(fragmentTags.status, 'active'))

// Ligne ~447 :
.set({ status: 'archived' })

// Ligne ~488 :
.set({ status: 'active', trustSource: 'human-direct' })
```

- [ ] **Step 8 : `admin-metadata-lookup-routes.ts` (lignes ~30, ~51, ~69)**

```typescript
// Tags :
const conditions: any[] = [eq(fragmentTags.status, 'active')];

// Domains :
const conditions: any[] = [eq(fragmentDomains.status, 'active')];

// Functions :
const conditions: any[] = [eq(fragmentFunctions.status, 'active')];
```

- [ ] **Step 9 : `harvest-routes.ts` (lignes ~178, ~190)**

```typescript
// Retirer validated: 1 des deux inserts dans fragmentTags et fragmentDomains :
// Avant :
{ slug: ..., status: 'active', validated: 1, ... }
// Après :
{ slug: ..., status: 'active', ... }
```

- [ ] **Step 10 : Typecheck**

```bash
npx tsc --noEmit -p packages/server/tsconfig.json 2>&1 | head -20
```

Attendu : erreurs uniquement sur les fichiers de Task 3.

---

## Task 3 — Services serveur

**Files:**
- Modify: `packages/server/src/services/harvest-hint-processor.ts`
- Modify: `packages/server/src/services/fragment-service.ts`
- Modify: `packages/server/src/services/harvester-pipeline.ts`

- [ ] **Step 1 : `harvest-hint-processor.ts` — supprimer `validated` des inserts**

Lignes ~82-116 (`insertNewProposals`) :
```typescript
// tagAutoValidated et domainAutoValidated sont déjà utilisés pour status — retirer :
validated: tagAutoValidated,     // supprimer
validated: domainAutoValidated,  // supprimer
```

Lignes ~149, ~167 (`flushHintReferentials`) :
```typescript
// Avant :
{ slug: ..., status: 'pending', validated: 0, ... }
// Après :
{ slug: ..., status: 'pending', ... }
```

- [ ] **Step 2 : `fragment-service.ts` — supprimer `validated: 1` des inserts (lignes ~472, ~478, ~489, ~495)**

```typescript
// Quatre occurrences, pattern identique — retirer validated: 1 :
await db.insert(fragmentTags).values({ slug, status: 'active', trustSource: 'human-direct', ... })
  .onConflictDoUpdate({ set: { trustSource: 'human-direct' } });

await db.insert(fragmentDomains).values({ slug, status: 'active', trustSource: 'human-direct', ... })
  .onConflictDoUpdate({ set: { trustSource: 'human-direct' } });
```

- [ ] **Step 3 : `harvester-pipeline.ts` — remplacer `eq(fragmentTags.validated, 1)` (ligne ~74)**

```typescript
// Avant :
.where(eq(fragmentTags.validated, 1));

// Après :
.where(eq(fragmentTags.status, 'active'));
```

- [ ] **Step 4 : Typecheck server complet**

```bash
npx tsc --noEmit -p packages/server/tsconfig.json 2>&1
```

Attendu : 0 erreur.

---

## Task 4 — Web

**Files:**
- Modify: `packages/web/src/types/admin-metadata.ts`
- Modify: `packages/web/src/components/admin/referential-item-sheet.tsx`
- Modify: `packages/web/src/components/admin/metadata/unified-metadata-card.tsx`

- [ ] **Step 1 : `types/admin-metadata.ts` — supprimer `validated: boolean`**

```typescript
// Retirer la ligne :
validated: boolean;
```

- [ ] **Step 2 : `referential-item-sheet.tsx` (ligne ~152)**

```typescript
// Retirer :
validated: item.status !== 'pending',
```

- [ ] **Step 3 : `unified-metadata-card.tsx` (ligne ~149)**

```typescript
// Retirer :
validated: !isPending,
```

- [ ] **Step 4 : Typecheck web**

```bash
npx tsc --noEmit -p packages/web/tsconfig.json 2>&1
```

Attendu : 0 erreur.

---

## Task 5 — Vérification finale

- [ ] **Step 1 : Typecheck global**

```bash
npx tsc --noEmit -p packages/server/tsconfig.json 2>&1 && npx tsc --noEmit -p packages/web/tsconfig.json 2>&1
```

Attendu : aucune sortie (0 erreur).

- [ ] **Step 2 : Tests unitaires**

```bash
pnpm test 2>&1 | tail -20
```

Attendu : tous verts.

- [ ] **Step 3 : Vérifier la migration en DB**

Redémarrer le serveur Docker et vérifier que la migration s'est exécutée :

```bash
sqlite3 example-vault/.fragmint.db ".schema fragment_tags"
```

Attendu : pas de colonne `validated` dans le schema retourné.

- [ ] **Step 4 : Smoke test UI**

- Ouvrir `/admin/referentiel` → vérifier que les tags actifs s'affichent
- Approuver un tag pending → vérifier qu'il passe à `status = 'active'`
- Archiver un tag → vérifier `status = 'archived'`

- [ ] **Step 5 : Commit**

```bash
git add packages/server/src/db/schema.ts \
        packages/server/src/db/connection.ts \
        packages/server/src/routes/admin-metadata-routes.ts \
        packages/server/src/routes/admin-metadata-helpers.ts \
        packages/server/src/routes/admin-metadata-mutation-routes.ts \
        packages/server/src/routes/admin-referential-routes.ts \
        packages/server/src/routes/admin-metadata-lookup-routes.ts \
        packages/server/src/routes/harvest-routes.ts \
        packages/server/src/services/harvest-hint-processor.ts \
        packages/server/src/services/fragment-service.ts \
        packages/server/src/services/harvester-pipeline.ts \
        packages/web/src/types/admin-metadata.ts \
        packages/web/src/components/admin/referential-item-sheet.tsx \
        packages/web/src/components/admin/metadata/unified-metadata-card.tsx
git commit -m "refactor(referential): drop validated column, use status='active' as single source of truth"
```
