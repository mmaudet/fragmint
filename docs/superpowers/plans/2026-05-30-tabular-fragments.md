# Tabular Fragments — Polymorphic Data Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fragments can store typed structured data (payload), tables in uploaded documents are decomposed into **one fragment per row** at harvest time, and plan sections can reconstruct tables on demand — choosing which columns to display, in which order.

**Architecture:**
- Each table row becomes one fragment with `payload` (row data as JSON) + `payload_schema` (typed discriminant, e.g. `sla-row-v1`)
- `fragment_collections` groups row-fragments from the same source table — the collection IS the canonical representation of the table
- At plan assembly, a section with `render_mode: 'table'` calls `resolveTableRows()` to fetch row payloads, then `buildGfmTable(rows, columns)` to reconstruct the table
- `section.columns` is the **adapt-on-demand** mechanism: pick any subset of columns in any order — different sections can render different views of the same collection
- Export: docx via docx-templates FOR loop (`renderDocxWithTables`), PPTX via pptxgenjs (`renderPptxWithTables`), both dispatched from `plan-assembler.ts`
- A fragment's `body` field always contains the prose representation of its row (auto-generated via `toBody()` in the schema registry) — the same fragment works in both `render_mode: 'table'` and `render_mode: 'prose'` sections

**Tech Stack:** Drizzle ORM (SQLite), Zod schemas, Fastify 5 routes, pptxgenjs (new dep), docx-templates (existing), React 19 + shadcn/ui, MCP tool pattern (existing)

---

## Decisions tranchées

| Question | Décision |
|----------|----------|
| PPTX table engine | `pptxgenjs` — seule lib JS mature pour tableaux PPTX programmatiques. Marp reste pour slides-as-markdown. |
| Migration fragments legacy (`pu:450`) | Script auto `migrate-payload.ts` : heuristique sur les tags (`pu`, `qte`, `libelle`, `unite`) → `pricing-line-v1`. Flag `--dry-run` par défaut. |
| Body depuis payload | Template prose dans le schema. Auto-généré à la décomposition, éditable après. Le body reste obligatoire en DB. |
| Collection < 3 lignes | Toujours créer une collection. Provenance > bruit. |
| Ordre lignes `render_mode: table` | Ordre de la collection par défaut. Slot peut surcharger avec `order_by: {field, direction}`. |
| Factorisation PayloadEditor | Composant unique `PayloadEditor` dans `packages/web/src/components/payload-editor.tsx`. Utilisé en harvest validation ET drawer fragment. |
| Granularité fragment tabulaire | **Un fragment = une ligne de tableau.** La collection groupe les lignes. Le fragment a un `body` prose (auto-généré via `toBody()`) qui permet de le réutiliser hors-tableau. `render_mode: 'table'` reconstruit le tableau ; `render_mode: 'prose'` cite la ligne comme texte. |
| "Adapter à la demande" | `section.columns` dans `PlanSectionSchema` (`schema/plan.ts:77`) contrôle quelles colonnes apparaissent et dans quel ordre. Deux sections peuvent pointer la même collection avec des colonnes différentes. |

---

## Estimations par tâche

| Task | Description courte | Estimation |
|------|-------------------|------------|
| T0 | Scénario démo (FAIT — `docs/demo/2026-06-12-demo-maudet.md`) | ~1h |
| T1 | DB migrations (payload + fragment_collections) | 2h |
| T2 | Payload schemas registry (Zod + body templates) | 2h |
| T3 | Migration script legacy tags → payload (avec safety) | 4h |
| T4 | Table detector (pipe_tables → DetectedTable[]) | 3h |
| T5 | LLM inference payload_schema | 2h |
| T6 | Harvest decompose tableau → N candidates | 4h |
| T7 | Collection auto-creation + CollectionService | 4h |
| T8 | API routes fragment collections | 3h |
| T9 | Plan schema: render_mode + table_source + columns | 1h |
| T10 | Plan assembler: table/data_point/list modes | 5h |
| T11 | Export docx hybrid + script template generation | 5h |
| T12 | Export PPTX pptxgenjs + qualité slides | 6h |
| T13 | MCP 4 outils + payload_schema filter | 3h |
| T14 | Harvest UI: PayloadEditor + validation table candidates | 4h |
| T15 | Fragment drawer: payload display + editor | 2h |
| T16 | Admin collections page | 5h |
| T17 | Plan builder: render_mode toggle + collection picker | 4h |
| T18 | E2E tests: pipeline complet | 4h |
| T19 | OpenCode SKILL.md: workflow composition tabulaire | 2h |
| **Total** | | **~66h ≈ 8-9 jours** |

---

## État d'implémentation (2026-06-05)

| Tâche | Statut | Notes |
|-------|--------|-------|
| T1 — DB: payload + fragment_collections | ✅ Fait | `db/schema.ts:33-34` (payload, payload_schema) + `fragmentCollections` table |
| T4 — Table detector | ✅ Fait | `services/table-detector.ts` (342 lignes) — pipe, grid, HTML, simple Pandoc |
| T9 — Plan schema render_mode + columns | ✅ Fait | `schema/plan.ts:75-81` — render_mode, table_source, columns, data_field |
| T10 — Plan assembler: table mode | ✅ Fait côté serveur | `plan-assembler.ts:196-256` — `resolveTableRows()` + `buildGfmTable()` |
| T11 — Export docx hybrid | ✅ Fait | `plan-assembler.ts:305-333` — `renderDocxWithTables()` |
| T12 — Export PPTX pptxgenjs | ✅ Fait | `plan-assembler.ts:351-376` — `renderPptxWithTables()` |
| T5 — Inférence payload_schema | ✅ Fait (heuristique) | `services/payload-inference.ts` (37 lignes) — keyword matching, pas LLM |
| T6 — Harvest: décomposition → N candidates | ⚠️ **Bug actuel** | `harvest-table-extractor.ts:flushTableCandidates` stocke UN fragment par tableau (payload = toutes les lignes). **Fix requis** : boucler sur `table.rows`, une insertion par ligne. |
| T7 — CollectionService + auto-création | 🔄 Service existe | Création automatique à l'harvest non vérifiée |
| T17 — Plan builder UI: render_mode + collection picker | ❌ À faire | C'est le gap principal : le serveur supporte les sections tableau, l'UI n'expose pas encore ce mode |
| T3, T13, T14-T16, T18-T19 | ❌ À faire | Migration legacy, MCP, UI harvest/drawer/admin, E2E |

**Priorité immédiate** : corriger T6 (`flushTableCandidates`) — sans ça, le harvest produit des fragments inutilisables pour `render_mode: 'table'`.

---

## File Map

**Créer :**
- `packages/server/src/schema/payload-schemas.ts` — registre Zod + templates prose
- `packages/server/src/services/table-detector.ts` — détection pipe_tables dans markdown pandoc
- `packages/server/src/services/collection-service.ts` — CRUD fragment_collections
- `packages/server/src/routes/fragment-collections-routes.ts` — API REST collections
- `packages/server/src/services/table-assembler.ts` — payload[] → GFM table string
- `packages/server/src/services/render-pptx-table.ts` — pptxgenjs table renderer
- `packages/server/src/scripts/migrate-payload.ts` — migration legacy tags → payload
- `packages/web/src/components/payload-editor.tsx` — composant partagé
- `packages/web/src/api/hooks/use-collections.ts` — React Query hooks
- `packages/web/src/pages/admin/collections.tsx` — page admin collections
- `packages/mcp/src/tools/collection-tools.ts` — 4 outils MCP

**Modifier :**
- `packages/server/src/db/schema.ts` — colonnes `payload`, `payload_schema` + table `fragmentCollections`
- `packages/server/src/schema/fragment.ts` — payload dans create/update schemas
- `packages/server/src/schema/plan.ts` — `render_mode`, `table_source`, `columns` sur PlanSection
- `packages/server/src/services/harvester-pipeline.ts` — détection tables + décomposition + collection
- `packages/server/src/services/plan-assembler.ts` — dispatch render_mode
- `packages/server/src/services/render-engine.ts` — hybrid docx + PPTX table path
- `packages/server/src/services/pandoc-render.ts` — passage des sections tableau
- `packages/server/src/index.ts` — enregistrer routes collections
- `packages/web/src/components/admin/fragment-detail-drawer.tsx` — afficher payload
- `packages/web/src/components/fragment-detail.tsx` — afficher payload
- `packages/web/src/router.tsx` (ou équivalent) — route `/admin/collections`
- `packages/mcp/src/index.ts` — enregistrer les 4 nouveaux outils

---

## Task 1 — DB: payload + fragment_collections table

**Files:**
- Modify: `packages/server/src/db/schema.ts`
- Create: `packages/server/src/db/migrations/0025_payload_collections.sql` (ou numéro suivant)

Ajouter `payload TEXT` et `payload_schema TEXT` sur `fragments` et `harvestCandidates`. Créer la table `fragmentCollections`. Nommer `fragmentCollections` (PascalCase JS) pour éviter la collision avec la table `collections` (workspaces).

- [ ] **Step 1: Lire le dernier numéro de migration**

```bash
ls packages/server/src/db/migrations/ | sort | tail -5
```

- [ ] **Step 2: Ajouter les colonnes + table dans schema.ts**

Dans `packages/server/src/db/schema.ts`, après la définition de `harvestCandidates` :

```typescript
// Ajouter sur fragments (après `supersedes`):
payload: text('payload'),          // JSON sérialisé, nullable
payload_schema: text('payload_schema'), // e.g. 'pricing-line-v1', nullable

// Ajouter sur harvestCandidates (après `quality_signals`):
payload: text('payload'),
payload_schema: text('payload_schema'),

// Nouvelle table après supersedureProposals:
export const fragmentCollections = sqliteTable('fragment_collections', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  payload_schema: text('payload_schema'),
  member_ids: text('member_ids').notNull().default('[]'), // JSON array of fragment IDs, ordered
  source_document: text('source_document'),   // nom du fichier source (harvest)
  collection_slug: text('collection_slug'),   // workspace collection
  created_at: text('created_at').notNull(),
  created_by: text('created_by').notNull(),
  updated_at: text('updated_at').notNull(),
});
```

- [ ] **Step 3: Écrire le fichier de migration SQL**

```sql
-- packages/server/src/db/migrations/0025_payload_collections.sql
ALTER TABLE fragments ADD COLUMN payload TEXT;
ALTER TABLE fragments ADD COLUMN payload_schema TEXT;
ALTER TABLE harvest_candidates ADD COLUMN payload TEXT;
ALTER TABLE harvest_candidates ADD COLUMN payload_schema TEXT;

CREATE TABLE IF NOT EXISTS fragment_collections (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  payload_schema TEXT,
  member_ids TEXT NOT NULL DEFAULT '[]',
  source_document TEXT,
  collection_slug TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

- [ ] **Step 4: Vérifier la migration au démarrage du serveur**

```bash
pnpm --filter @fragmint/server typecheck
```
Expected: 0 erreurs

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/db/schema.ts packages/server/src/db/migrations/
git commit -m "feat(db): add payload + payload_schema fields, fragment_collections table"
```

---

## Task 2 — Payload schemas registry

**Files:**
- Create: `packages/server/src/schema/payload-schemas.ts`

Registre des schémas payload connus. Chaque entrée contient : les champs Zod, un template prose (`toBody`), et un label humain. C'est un fichier statique — pas de table DB. Pour l'instant : `pricing-line-v1`, `sla-row-v1`, `reference-v1`, `generic-row-v1` (fallback).

- [ ] **Step 1: Écrire le fichier**

```typescript
// packages/server/src/schema/payload-schemas.ts
import { z } from 'zod';

export interface PayloadSchemaDefinition {
  id: string;
  label: string;
  fields: z.ZodObject<any>;
  toBody: (payload: Record<string, unknown>) => string;
}

const pricingLineSchema = z.object({
  libelle: z.string().default(''),
  quantite: z.coerce.number().optional(),
  prix_unitaire: z.coerce.number().optional(),
  unite: z.string().optional(),
  total: z.coerce.number().optional(),
});

const slaRowSchema = z.object({
  niveau: z.string().default(''),
  prise_en_charge: z.string().default(''),
  resolution: z.string().default(''),
  penalite: z.string().optional(),
  disponibilite: z.string().optional(),
});

const referenceSchema = z.object({
  client: z.string().default(''),
  projet: z.string().default(''),
  annee: z.string().optional(),
  montant: z.string().optional(),
  technologie: z.string().optional(),
});

const genericRowSchema = z.record(z.string());

export const PAYLOAD_SCHEMAS: Record<string, PayloadSchemaDefinition> = {
  'pricing-line-v1': {
    id: 'pricing-line-v1',
    label: 'Ligne de prix',
    fields: pricingLineSchema,
    toBody: (p) => {
      const parts = [p.libelle ?? ''];
      if (p.quantite != null && p.prix_unitaire != null)
        parts.push(`${p.quantite} × ${p.prix_unitaire} ${p.unite ?? '€'}`);
      else if (p.prix_unitaire != null) parts.push(`${p.prix_unitaire} ${p.unite ?? '€'}`);
      return parts.filter(Boolean).join(' — ');
    },
  },
  'sla-row-v1': {
    id: 'sla-row-v1',
    label: 'Engagement SLA',
    fields: slaRowSchema,
    toBody: (p) =>
      `Niveau ${p.niveau} : prise en charge sous ${p.prise_en_charge}, résolution sous ${p.resolution}.${p.penalite ? ` Pénalité : ${p.penalite}.` : ''}`,
  },
  'reference-v1': {
    id: 'reference-v1',
    label: 'Référence client',
    fields: referenceSchema,
    toBody: (p) =>
      `${p.client} — ${p.projet}${p.annee ? ` (${p.annee})` : ''}${p.technologie ? ` · ${p.technologie}` : ''}`,
  },
  'generic-row-v1': {
    id: 'generic-row-v1',
    label: 'Ligne générique',
    fields: genericRowSchema,
    toBody: (p) => Object.entries(p).map(([k, v]) => `${k}: ${v}`).join(' | '),
  },
};

export function getPayloadSchema(id: string): PayloadSchemaDefinition | null {
  return PAYLOAD_SCHEMAS[id] ?? null;
}

export function listPayloadSchemas(): PayloadSchemaDefinition[] {
  return Object.values(PAYLOAD_SCHEMAS);
}
```

- [ ] **Step 2: Écrire les tests**

```typescript
// packages/server/src/schema/payload-schemas.test.ts
import { describe, it, expect } from 'vitest';
import { getPayloadSchema, listPayloadSchemas } from './payload-schemas.js';

describe('payload-schemas', () => {
  it('toBody pricing-line-v1 avec quantite et prix', () => {
    const schema = getPayloadSchema('pricing-line-v1')!;
    expect(schema.toBody({ libelle: 'Support N2', quantite: 2, prix_unitaire: 450, unite: '€/jour' }))
      .toBe('Support N2 — 2 × 450 €/jour');
  });

  it('toBody sla-row-v1', () => {
    const schema = getPayloadSchema('sla-row-v1')!;
    expect(schema.toBody({ niveau: 'Critique', prise_en_charge: '30min', resolution: '8h' }))
      .toBe('Niveau Critique : prise en charge sous 30min, résolution sous 8h.');
  });

  it('getPayloadSchema inconnu retourne null', () => {
    expect(getPayloadSchema('unknown-schema')).toBeNull();
  });

  it('listPayloadSchemas retourne 4 schemas', () => {
    expect(listPayloadSchemas().length).toBeGreaterThanOrEqual(4);
  });
});
```

- [ ] **Step 3: Lancer les tests**

```bash
pnpm --filter @fragmint/server test packages/server/src/schema/payload-schemas.test.ts
```
Expected: 4 tests passent

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/schema/payload-schemas.ts packages/server/src/schema/payload-schemas.test.ts
git commit -m "feat(schema): payload schemas registry with body templates"
```

---

## Task 3 — Migration script: legacy tags → payload

**Files:**
- Create: `packages/server/src/scripts/migrate-payload.ts`

Script CLI qui scanne les fragments avec des tags structurés connus (`pu:`, `qte:`, `libelle:`, `unite:`, `niveau:`, `prise_en_charge:`, `resolution:`) et construit leur `payload` + `payload_schema`. Mode `--dry-run` par défaut, `--apply` pour écrire. Sécurité : export CSV des propositions, vérification des valeurs numériques, mode `--strict`.

- [ ] **Step 1: Écrire le script**

```typescript
// packages/server/src/scripts/migrate-payload.ts
import { createDb } from '../db/connection.js';
import { fragments } from '../db/schema.js';
import { eq, isNull } from 'drizzle-orm';
import { writeFileSync } from 'node:fs';

const PRICING_KEYS = new Set(['pu', 'qte', 'libelle', 'unite', 'total']);
const SLA_KEYS = new Set(['niveau', 'prise_en_charge', 'resolution', 'penalite', 'disponibilite']);
const REFERENCE_KEYS = new Set(['client', 'projet', 'annee', 'montant', 'technologie']);
const NUMERIC_FIELDS = new Set(['pu', 'qte', 'total', 'prix_unitaire', 'quantite']);

// Schemas where ALL keys must match in --strict mode
const STRICT_KEY_SETS: Record<string, Set<string>> = {
  'pricing-line-v1': PRICING_KEYS,
  'sla-row-v1': SLA_KEYS,
  'reference-v1': REFERENCE_KEYS,
};

function detectSchema(tagObj: Record<string, string>, strict: boolean): string | null {
  const keys = new Set(Object.keys(tagObj));
  if (keys.has('pu')) return 'pricing-line-v1';
  if (keys.has('niveau') && keys.has('prise_en_charge')) return 'sla-row-v1';
  if (keys.has('client') && keys.has('projet')) return 'reference-v1';
  if (strict) return null;  // strict mode: only known schemas
  const structuredCount = [...keys].filter(k =>
    !['produit', 'tech', 'client', 'cert', 'partner', 'reg'].some(p => k.startsWith(p + ':'))
  ).length;
  if (structuredCount >= 2) return 'generic-row-v1';
  return null;
}

function validateNumericFields(tagObj: Record<string, string>): { valid: boolean; warnings: string[] } {
  const warnings: string[] = [];
  for (const [key, value] of Object.entries(tagObj)) {
    if (NUMERIC_FIELDS.has(key) && value.trim() !== '') {
      const parsed = parseFloat(value.replace(',', '.'));
      if (isNaN(parsed)) {
        warnings.push(`  ⚠ champ numérique attendu: ${key}="${value}" (non parsable — skip)`);
      }
    }
  }
  return { valid: warnings.length === 0, warnings };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const strict = process.argv.includes('--strict');
  const csvPath = process.argv.find(a => a.startsWith('--csv='))?.slice(6);

  const db = createDb(process.env.FRAGMINT_DB_PATH ?? './example-vault/fragmint.db');
  const rows = await db.select({ id: fragments.id, tags: fragments.tags }).from(fragments)
    .where(isNull(fragments.payload_schema));

  const csvLines: string[] = ['fragment_id,schema_id,payload_json,warnings'];
  let migrated = 0;
  let skipped = 0;

  for (const row of rows) {
    if (!row.tags) continue;
    let tagArr: string[] = [];
    try { tagArr = JSON.parse(row.tags); } catch { continue; }

    const tagObj: Record<string, string> = {};
    for (const t of tagArr) {
      const idx = t.indexOf(':');
      if (idx > 0) tagObj[t.slice(0, idx)] = t.slice(idx + 1);
    }
    if (Object.keys(tagObj).length < 2) continue;

    const schemaId = detectSchema(tagObj, strict);
    if (!schemaId) { skipped++; continue; }

    const { valid, warnings } = validateNumericFields(tagObj);
    if (!valid) {
      console.warn(`[SKIP] ${row.id}: valeurs numériques invalides`);
      warnings.forEach(w => console.warn(w));
      skipped++;
      csvLines.push(`${row.id},SKIP,,${warnings.join('; ')}`);
      continue;
    }

    const payloadJson = JSON.stringify(tagObj);
    console.log(`[${apply ? 'APPLY' : 'DRY'}] ${row.id}: ${schemaId} ← ${payloadJson}`);
    csvLines.push(`${row.id},${schemaId},${payloadJson},`);

    if (apply) {
      await db.update(fragments).set({ payload: payloadJson, payload_schema: schemaId })
        .where(eq(fragments.id, row.id));
    }
    migrated++;
  }

  if (csvPath) {
    writeFileSync(csvPath, csvLines.join('\n'));
    console.log(`\nCSV exporté → ${csvPath}`);
  }
  console.log(`\n${migrated} fragments à migrer, ${skipped} skippés.`);
  if (!apply) console.log('Relancer avec --apply pour écrire. --strict pour mode conservateur. --csv=out.csv pour export.');
}

main().catch(console.error);
```

- [ ] **Step 2: Tester en dry-run + export CSV**

```bash
npx tsx packages/server/src/scripts/migrate-payload.ts --csv=/tmp/migration-preview.csv
cat /tmp/migration-preview.csv
```
Expected: CSV listant les fragments à migrer, 0 modifications en DB

- [ ] **Step 3: Tester mode strict**

```bash
npx tsx packages/server/src/scripts/migrate-payload.ts --strict
```
Expected: seulement les fragments avec correspondance exacte aux schemas connus

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/scripts/migrate-payload.ts
git commit -m "feat(scripts): migrate legacy structured tags to payload field (with CSV export + strict mode)"
```

---

## Task 4 — Table detector: pipe_tables → DetectedTable[]

**Files:**
- Create: `packages/server/src/services/table-detector.ts`
- Create: `packages/server/src/services/table-detector.test.ts`

Pandoc est déjà appelé avec `markdown+pipe_tables`. Ce module scanne le markdown résultant et extrait les tableaux sous forme d'objets structurés. Retourne aussi le markdown nettoyé (tableaux retirés pour ne pas les passer à `segmentAndClassify`).

- [ ] **Step 1: Écrire les tests d'abord**

```typescript
// packages/server/src/services/table-detector.test.ts
import { describe, it, expect } from 'vitest';
import { detectTables } from './table-detector.js';

const MD_WITH_TABLE = `
# Engagements SLA

| Niveau | Prise en charge | Résolution |
|--------|----------------|------------|
| Critique | 30min | 8h |
| Majeur | 2h | 24h |

Autre prose ici.
`;

describe('detectTables', () => {
  it('détecte un tableau avec header et 2 lignes', () => {
    const { tables } = detectTables(MD_WITH_TABLE);
    expect(tables).toHaveLength(1);
    expect(tables[0].headers).toEqual(['Niveau', 'Prise en charge', 'Résolution']);
    expect(tables[0].rows).toHaveLength(2);
    expect(tables[0].rows[0]).toEqual({ 'Niveau': 'Critique', 'Prise en charge': '30min', 'Résolution': '8h' });
    expect(tables[0].precedingHeading).toBe('Engagements SLA');
  });

  it('retire les tableaux du markdown nettoyé', () => {
    const { cleanedMarkdown } = detectTables(MD_WITH_TABLE);
    expect(cleanedMarkdown).not.toContain('| Critique');
    expect(cleanedMarkdown).toContain('Autre prose ici.');
  });

  it('markdown sans tableau retourne []', () => {
    expect(detectTables('Pas de tableau ici.').tables).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Vérifier que les tests échouent**

```bash
pnpm --filter @fragmint/server test packages/server/src/services/table-detector.test.ts
```
Expected: FAIL "Cannot find module"

- [ ] **Step 3: Implémenter**

```typescript
// packages/server/src/services/table-detector.ts

export interface DetectedTable {
  headers: string[];
  rows: Record<string, string>[];  // chaque ligne = {colonne: valeur}
  precedingHeading: string | null;  // titre de section précédant le tableau
  rawMarkdown: string;  // les lignes pipe_table originales
}

export interface TableDetectionResult {
  tables: DetectedTable[];
  cleanedMarkdown: string;  // markdown sans les blocs tableau
}

function parsePipeRow(line: string): string[] {
  return line.split('|').map(c => c.trim()).filter((_, i, arr) => i > 0 && i < arr.length - 1);
}

function isSeparatorRow(line: string): boolean {
  return /^\s*\|[\s\-:|]+\|\s*$/.test(line);
}

export function detectTables(markdown: string): TableDetectionResult {
  const lines = markdown.split('\n');
  const tables: DetectedTable[] = [];
  const keptLines: string[] = [];
  let lastHeading: string | null = null;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Track preceding heading
    const headingMatch = line.match(/^#{1,4}\s+(.+)$/);
    if (headingMatch) {
      lastHeading = headingMatch[1].trim();
      keptLines.push(line);
      i++;
      continue;
    }

    // Detect table start: pipe row followed by separator row
    if (line.includes('|') && i + 1 < lines.length && isSeparatorRow(lines[i + 1])) {
      const headers = parsePipeRow(line);
      if (headers.length < 2) { keptLines.push(line); i++; continue; }

      const tableLines: string[] = [line, lines[i + 1]];
      i += 2;
      const rows: Record<string, string>[] = [];

      while (i < lines.length && lines[i].includes('|') && !isSeparatorRow(lines[i])) {
        const cells = parsePipeRow(lines[i]);
        const row: Record<string, string> = {};
        headers.forEach((h, idx) => { row[h] = cells[idx]?.trim() ?? ''; });
        rows.push(row);
        tableLines.push(lines[i]);
        i++;
      }

      if (rows.length > 0) {
        tables.push({ headers, rows, precedingHeading: lastHeading, rawMarkdown: tableLines.join('\n') });
        // Ne pas ajouter à keptLines — retirer du markdown nettoyé
        continue;
      }
    }

    keptLines.push(line);
    i++;
  }

  return { tables, cleanedMarkdown: keptLines.join('\n').replace(/\n{3,}/g, '\n\n').trim() };
}
```

- [ ] **Step 4: Lancer les tests**

```bash
pnpm --filter @fragmint/server test packages/server/src/services/table-detector.test.ts
```
Expected: 3 tests passent

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/table-detector.ts packages/server/src/services/table-detector.test.ts
git commit -m "feat(harvest): table detector extracts pipe_tables from pandoc markdown"
```

---

## Task 5 — Inférence payload_schema par LLM

**Files:**
- Modify: `packages/server/src/services/llm-client.ts`

Nouvelle méthode `inferPayloadSchema(headers: string[], sampleRow: Record<string, string>): Promise<string>` sur `LlmClient`. Prompt compact : donner les headers, une ligne exemple, la liste des schemas connus → retourner l'ID du schema le plus probable OU `generic-row-v1` si aucun ne correspond.

- [ ] **Step 1: Lire llm-client.ts pour trouver le pattern de méthode**

```bash
grep -n "async\|prompt\|messages\|complete" packages/server/src/services/llm-client.ts | head -20
```

- [ ] **Step 2: Ajouter la méthode inferPayloadSchema**

Dans `LlmClient`, après la dernière méthode publique :

```typescript
async inferPayloadSchema(
  headers: string[],
  sampleRow: Record<string, string>,
): Promise<string> {
  const knownSchemas = listPayloadSchemas().map(s => `- ${s.id}: ${s.label} (champs: ${Object.keys(s.fields.shape ?? {}).join(', ')})`).join('\n');
  const prompt = `Tu analyses les colonnes d'un tableau extrait d'un document.

En-têtes : ${headers.join(', ')}
Exemple de ligne : ${JSON.stringify(sampleRow)}

Schémas disponibles :
${knownSchemas}

Réponds UNIQUEMENT avec l'identifiant du schéma le plus adapté (ex: "pricing-line-v1"). Si aucun ne correspond, réponds "generic-row-v1". Aucune explication.`;

  const result = await this.complete([{ role: 'user', content: prompt }]);
  const id = result.trim().replace(/['"]/g, '');
  const known = listPayloadSchemas().map(s => s.id);
  return known.includes(id) ? id : 'generic-row-v1';
}
```

- [ ] **Step 3: Typcheque**

```bash
pnpm --filter @fragmint/server typecheck
```
Expected: 0 erreurs

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/services/llm-client.ts
git commit -m "feat(llm): inferPayloadSchema prompt for table column classification"
```

---

## Task 6 — Harvest: décomposition tableau → N candidates

> ⚠️ **Bug actuel** : `harvest-table-extractor.ts:flushTableCandidates` insère UN seul candidat par tableau avec `payload = JSON.stringify(table.rows)` (toutes les lignes en une fois). L'architecture cible exige UN candidat PAR LIGNE. Le fix est dans `flushTableCandidates` : boucler sur `table.rows` et insérer un candidat par itération avec `payload = JSON.stringify(row)`.

**Files:**
- Modify: `packages/server/src/services/harvest-table-extractor.ts` (file à modifier, pas harvester-pipeline.ts)

Corriger `flushTableCandidates` pour insérer un candidate par ligne de tableau. Pour chaque ligne, inférer le schema, générer le `body` via `toBody()`, insérer avec `payload = JSON.stringify(row)`.

**Important — type et payload_schema sont orthogonaux :** le LLM doit toujours classifier le `type` du fragment (ex: `commitment`, `pricing`, `reference`), indépendamment du `payload_schema`. Un fragment peut avoir `type='commitment'` ET `payload_schema='sla-row-v1'`. Ne pas utiliser `type: 'data'` — ce n'est pas un type valide. Ajouter `'data'` à `FRAGMENT_TYPES` **uniquement** si vraiment nécessaire pour des fragments sans sémantique métier claire.

Pour les rows de tableau : utiliser `type: 'engagement'` pour les SLA, `type: 'pricing'` pour les lignes de prix, `type: 'testimonial'` pour les références. Laisser le LLM choisir via `inferPayloadSchema` qui peut aussi retourner un `type` suggéré.

- [ ] **Step 1: Localiser le point d'insertion dans harvester-pipeline.ts**

Ligne ~155 : après `markdown = markdown.replace(...)` et avant `const semanticChunks = semanticChunk(markdown)`.

- [ ] **Step 2: Modifier le pipeline**

```typescript
// Après le block de normalisation markdown (ligne ~152), avant semanticChunk:
import { detectTables } from './table-detector.js';
import { getPayloadSchema } from '../schema/payload-schemas.js';

// Dans le body de runPipeline, après markdown normalization:
const { tables, cleanedMarkdown } = detectTables(markdown);

// Traiter les tableaux détectés
for (const table of tables) {
  const schemaId = await llmClient.inferPayloadSchema(table.headers, table.rows[0] ?? {});
  const schemaDef = getPayloadSchema(schemaId);
  const now = new Date().toISOString();

  for (const row of table.rows) {
    const payload = { ...row };  // keys = header names, values = cell content
    const body = schemaDef ? schemaDef.toBody(payload) : Object.entries(payload).map(([k, v]) => `${k}: ${v}`).join(' | ');
    const title = table.precedingHeading
      ? `${table.precedingHeading} — ${row[table.headers[0]] ?? 'ligne'}`
      : (row[table.headers[0]] ?? 'ligne sans titre');

    await db.insert(harvestCandidates).values({
      id: `hc-${randomUUID()}`,
      job_id: jobId,
      title,
      body,
      type: 'data',
      domain: uploadHints.domain ?? 'general',
      lang,
      tags: JSON.stringify([]),
      confidence: 0.9,  // tableaux structurés ont confiance élevée
      origin_source: filename,
      origin_page: null,
      source_section: table.precedingHeading ?? '',
      status: 'pending',
      payload: JSON.stringify(payload),
      payload_schema: schemaId,
    });
  }
}

// Passer le markdown nettoyé (sans tableaux) à semanticChunk
const semanticChunks = semanticChunk(cleanedMarkdown);
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @fragmint/server typecheck
```

- [ ] **Step 4: Test d'intégration manuel**

```bash
# Démarrer le serveur dev, uploader un docx avec tableau via l'UI harvest
# Vérifier dans la pipeline UI que les candidates apparaissent avec type='data'
```

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/harvester-pipeline.ts
git commit -m "feat(harvest): decompose pipe_tables into atomic data candidates with payload"
```

---

## Task 7 — Harvest: création automatique de collection

**Files:**
- Create: `packages/server/src/services/collection-service.ts`
- Modify: `packages/server/src/services/harvester-pipeline.ts`

Après avoir inséré les N candidates d'un tableau (Task 6), créer immédiatement un `fragmentCollection` qui les groupe. La collection pointe sur les IDs des candidates (deviendront des fragment_ids à l'approbation). Mettre à jour les IDs quand les candidates sont approuvées.

- [ ] **Step 1: Créer CollectionService**

```typescript
// packages/server/src/services/collection-service.ts
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FragmintDb } from '../db/connection.js';
import { fragmentCollections } from '../db/schema.js';

export interface FragmentCollectionRecord {
  id: string;
  title: string;
  description: string | null;
  payload_schema: string | null;
  member_ids: string[];
  source_document: string | null;
  collection_slug: string | null;
  created_at: string;
  created_by: string;
  updated_at: string;
}

export class CollectionService {
  constructor(private db: FragmintDb) {}

  async create(input: {
    title: string;
    payload_schema?: string;
    member_ids: string[];
    source_document?: string;
    collection_slug?: string;
    created_by: string;
  }): Promise<FragmentCollectionRecord> {
    const id = `col_${randomUUID()}`;
    const now = new Date().toISOString();
    await this.db.insert(fragmentCollections).values({
      id,
      title: input.title,
      payload_schema: input.payload_schema ?? null,
      member_ids: JSON.stringify(input.member_ids),
      source_document: input.source_document ?? null,
      collection_slug: input.collection_slug ?? null,
      created_at: now,
      created_by: input.created_by,
      updated_at: now,
    });
    return (await this.getById(id))!;
  }

  async getById(id: string): Promise<FragmentCollectionRecord | null> {
    const row = await this.db.select().from(fragmentCollections).where(eq(fragmentCollections.id, id)).get();
    if (!row) return null;
    return { ...row, member_ids: JSON.parse(row.member_ids) };
  }

  async list(collectionSlug?: string): Promise<FragmentCollectionRecord[]> {
    const rows = collectionSlug
      ? await this.db.select().from(fragmentCollections).where(eq(fragmentCollections.collection_slug, collectionSlug)).all()
      : await this.db.select().from(fragmentCollections).all();
    return rows.map(r => ({ ...r, member_ids: JSON.parse(r.member_ids) }));
  }

  async update(id: string, input: Partial<{ title: string; description: string; member_ids: string[] }>): Promise<void> {
    const update: any = { updated_at: new Date().toISOString() };
    if (input.title) update.title = input.title;
    if (input.description !== undefined) update.description = input.description;
    if (input.member_ids) update.member_ids = JSON.stringify(input.member_ids);
    await this.db.update(fragmentCollections).set(update).where(eq(fragmentCollections.id, id));
  }

  async replaceMemberIds(id: string, oldId: string, newId: string): Promise<void> {
    const col = await this.getById(id);
    if (!col) return;
    const updated = col.member_ids.map(m => m === oldId ? newId : m);
    await this.update(id, { member_ids: updated });
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(fragmentCollections).where(eq(fragmentCollections.id, id));
  }
}
```

- [ ] **Step 2: Modifier harvester-pipeline.ts — créer la collection après décomposition**

Dans le bloc de traitement des tables (Task 6), après l'insertion des candidates :

```typescript
// Après avoir inséré tous les rows du tableau:
const candidateIds = table.rows.map((_, idx) => `hc-${/* l'id généré au step précédent */}`);
// Note: stocker les IDs au moment de la génération plutôt que les réinférer.
// Utiliser un tableau local `createdIds: string[]` dans le for-loop ci-dessus.

await collectionService.create({
  title: table.precedingHeading ?? `Tableau — ${filename}`,
  payload_schema: schemaId,
  member_ids: createdIds,  // IDs des harvest_candidates pour l'instant
  source_document: filename,
  collection_slug: uploadHints.collection_slug,
  created_by: 'harvest-pipeline',
});
```

- [ ] **Step 3: Injecter CollectionService dans runPipeline**

Ajouter `collectionService: CollectionService` comme paramètre de `runPipeline`. Mettre à jour l'appel dans `index.ts` ou `harvester-service.ts`.

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @fragmint/server typecheck
```

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/collection-service.ts packages/server/src/services/harvester-pipeline.ts
git commit -m "feat(harvest): auto-create fragment collection from harvested table"
```

---

## Task 8 — API routes: fragment collections

**Files:**
- Create: `packages/server/src/routes/fragment-collections-routes.ts`
- Modify: `packages/server/src/index.ts`

CRUD REST pour `fragmentCollections` : `GET /v1/fragment-collections`, `GET /v1/fragment-collections/:id`, `POST /v1/fragment-collections`, `PUT /v1/fragment-collections/:id`, `DELETE /v1/fragment-collections/:id`. Auth `contributor` minimum.

- [ ] **Step 1: Créer les routes**

```typescript
// packages/server/src/routes/fragment-collections-routes.ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const CreateCollectionSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  payload_schema: z.string().optional(),
  member_ids: z.array(z.string()).default([]),
  collection_slug: z.string().optional(),
});

const UpdateCollectionSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  member_ids: z.array(z.string()).optional(),
});

export async function fragmentCollectionRoutes(app: FastifyInstance) {
  app.get('/v1/fragment-collections', async (req, reply) => {
    const { collection_slug } = req.query as { collection_slug?: string };
    const list = await req.server.collectionService.list(collection_slug);
    return reply.send(list);
  });

  app.get('/v1/fragment-collections/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const col = await req.server.collectionService.getById(id);
    if (!col) return reply.status(404).send({ error: 'Not found' });
    return reply.send(col);
  });

  app.post('/v1/fragment-collections', async (req, reply) => {
    const input = CreateCollectionSchema.parse(req.body);
    const col = await req.server.collectionService.create({ ...input, created_by: req.user.login });
    return reply.status(201).send(col);
  });

  app.put('/v1/fragment-collections/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const input = UpdateCollectionSchema.parse(req.body);
    await req.server.collectionService.update(id, input);
    return reply.send(await req.server.collectionService.getById(id));
  });

  app.delete('/v1/fragment-collections/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    await req.server.collectionService.delete(id);
    return reply.status(204).send();
  });
}
```

- [ ] **Step 2: Enregistrer dans index.ts**

Ajouter le décorateur CollectionService et enregistrer les routes dans `index.ts` comme les autres services/routes.

- [ ] **Step 3: Écrire un test d'intégration**

```typescript
// packages/server/src/routes/fragment-collections.integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildTestApp } from '../test-helpers/build-test-app.js';

describe('fragment-collections routes', () => {
  let app: any;
  let token: string;

  beforeAll(async () => {
    ({ app, token } = await buildTestApp());
  });

  afterAll(() => app.close());

  it('POST + GET collection', async () => {
    const create = await app.inject({
      method: 'POST', url: '/v1/fragment-collections',
      headers: { authorization: `Bearer ${token}` },
      payload: { title: 'SLA Table Test', payload_schema: 'sla-row-v1', member_ids: [] },
    });
    expect(create.statusCode).toBe(201);
    const { id } = JSON.parse(create.body);

    const get = await app.inject({ method: 'GET', url: `/v1/fragment-collections/${id}`, headers: { authorization: `Bearer ${token}` } });
    expect(get.statusCode).toBe(200);
    expect(JSON.parse(get.body).title).toBe('SLA Table Test');
  });
});
```

- [ ] **Step 4: Lancer les tests**

```bash
pnpm --filter @fragmint/server test packages/server/src/routes/fragment-collections.integration.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/routes/fragment-collections-routes.ts packages/server/src/routes/fragment-collections.integration.test.ts
git commit -m "feat(api): CRUD routes for fragment collections"
```

---

## Task 9 — Plan schema: render_mode + table_source + columns

**Files:**
- Modify: `packages/server/src/schema/plan.ts`

Étendre `PlanSectionSchema` avec `render_mode`, `table_source`, `columns`. Backward-compatible : `render_mode` défaut `prose`. Tous les champs existants inchangés.

- [ ] **Step 1: Modifier PlanSectionSchema**

```typescript
// Dans packages/server/src/schema/plan.ts
// Ajouter après PlanFiltersSchema:

export const TableSourceSchema = z.object({
  collection_id: z.string().optional(),
  fragment_ids: z.array(z.string()).optional(),
  payload_schema: z.string().optional(),
  tags: z.array(z.string()).optional(),
  order_by: z.object({
    field: z.string(),
    direction: z.enum(['asc', 'desc']),
  }).optional(),
});

// Modifier PlanSectionSchema — ajouter ces champs:
render_mode: z.enum(['prose', 'table', 'data_point', 'list']).default('prose'),
table_source: TableSourceSchema.optional(),
columns: z.array(z.string()).optional(),  // ordered columns for table mode
data_field: z.string().optional(),         // field name for data_point mode
```

- [ ] **Step 2: Typecheck + tests schema**

```bash
pnpm --filter @fragmint/server test packages/server/src/schema/
pnpm --filter @fragmint/server typecheck
```
Expected: existants passent toujours

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/schema/plan.ts
git commit -m "feat(schema): plan section render_mode, table_source, columns"
```

---

## Task 10 — Plan assembler: table / data_point / list modes

**Files:**
- Create: `packages/server/src/services/table-assembler.ts`
- Modify: `packages/server/src/services/plan-assembler.ts`

Le `TableAssembler` transforme des payloads de fragments en table GFM ou liste markdown. Le `PlanAssembler.assemble()` vérifie `render_mode` de chaque section et dispatch.

- [ ] **Step 1: Créer table-assembler.ts**

```typescript
// packages/server/src/services/table-assembler.ts

export function buildGfmTable(
  rows: Record<string, unknown>[],
  columns: string[],
): string {
  if (rows.length === 0 || columns.length === 0) return '';
  const header = '| ' + columns.join(' | ') + ' |';
  const sep = '| ' + columns.map(() => '---').join(' | ') + ' |';
  const dataRows = rows.map(row =>
    '| ' + columns.map(c => String(row[c] ?? '')).join(' | ') + ' |'
  );
  return [header, sep, ...dataRows].join('\n');
}

export function buildMarkdownList(bodies: string[]): string {
  return bodies.map(b => `- ${b.trim()}`).join('\n');
}
```

- [ ] **Step 2: Tests pour table-assembler**

```typescript
// packages/server/src/services/table-assembler.test.ts
import { describe, it, expect } from 'vitest';
import { buildGfmTable, buildMarkdownList } from './table-assembler.js';

describe('buildGfmTable', () => {
  it('génère une table GFM correcte', () => {
    const rows = [{ Niveau: 'Critique', SLA: '30min' }, { Niveau: 'Majeur', SLA: '2h' }];
    const result = buildGfmTable(rows, ['Niveau', 'SLA']);
    expect(result).toContain('| Critique | 30min |');
    expect(result).toContain('| --- | --- |');
  });

  it('retourne string vide si rows vide', () => {
    expect(buildGfmTable([], ['col'])).toBe('');
  });
});
```

- [ ] **Step 3: Modifier plan-assembler.ts — méthode assemble()**

Dans `PlanAssembler.assemble()`, remplacer la boucle sur les sections par :

```typescript
for (const s of p.state.sections) {
  if (s.render_mode === 'prose' || !s.render_mode) {
    if (!s.generated_markdown) continue;
    parts.push(`# ${s.title}`);
    parts.push('');
    parts.push(s.generated_markdown.trim());
    parts.push('');
  } else if (s.render_mode === 'table') {
    const rows = await this.resolveTableRows(s);
    const cols = s.columns ?? (rows[0] ? Object.keys(rows[0]) : []);
    const table = buildGfmTable(rows, cols);
    if (table) {
      parts.push(`# ${s.title}`);
      parts.push('');
      parts.push(table);
      parts.push('');
    }
  } else if (s.render_mode === 'list') {
    const bodies = await this.resolveFragmentBodies(s);
    parts.push(`# ${s.title}`);
    parts.push('');
    parts.push(buildMarkdownList(bodies));
    parts.push('');
  } else if (s.render_mode === 'data_point') {
    const val = await this.resolveDataPoint(s);
    if (val) parts.push(val);
  }
}
```

- [ ] **Step 4: Ajouter les méthodes helper dans PlanAssembler**

```typescript
private async resolveTableRows(section: PlanSection): Promise<Record<string, unknown>[]> {
  const fragmentsSvc = this.config.fragments;
  if (!fragmentsSvc) return [];

  let fragmentIds: string[] = [];

  if (section.table_source?.collection_id) {
    const col = await this.collectionService?.getById(section.table_source.collection_id);
    let ids = col?.member_ids ?? [];
    if (section.table_source.fragment_ids) ids = section.table_source.fragment_ids;
    if (section.table_source.order_by) {
      // Sort by payload field
      const frags = await Promise.all(ids.map(id => fragmentsSvc.getById(id)));
      const field = section.table_source.order_by.field;
      const dir = section.table_source.order_by.direction;
      frags.sort((a, b) => {
        const pa = a?.payload ? JSON.parse(a.payload) : {};
        const pb = b?.payload ? JSON.parse(b.payload) : {};
        const va = pa[field] ?? '';
        const vb = pb[field] ?? '';
        return dir === 'asc' ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
      });
      return frags.filter(Boolean).map(f => f!.payload ? JSON.parse(f!.payload) : {});
    }
    fragmentIds = ids;
  } else if (section.table_source?.fragment_ids) {
    fragmentIds = section.table_source.fragment_ids;
  } else {
    // Fallback: selected fragments in section
    fragmentIds = section.selected.map(s => s.fragment_id);
  }

  const frags = await Promise.all(fragmentIds.map(id => fragmentsSvc.getById(id)));
  return frags.filter(Boolean).map(f => f!.payload ? JSON.parse(f!.payload) : {});
}

private async resolveFragmentBodies(section: PlanSection): Promise<string[]> {
  const fragmentsSvc = this.config.fragments;
  if (!fragmentsSvc) return [];
  const ids = section.selected.map(s => s.fragment_id);
  const frags = await Promise.all(ids.map(id => fragmentsSvc.getById(id)));
  return frags.filter(Boolean).map(f => f!.body ?? f!.body_excerpt ?? '');
}

private async resolveDataPoint(section: PlanSection): Promise<string | null> {
  const fragmentsSvc = this.config.fragments;
  if (!fragmentsSvc || !section.selected[0]) return null;
  const frag = await fragmentsSvc.getById(section.selected[0].fragment_id);
  if (!frag?.payload || !section.data_field) return frag?.body ?? null;
  const payload = JSON.parse(frag.payload);
  return String(payload[section.data_field] ?? '');
}
```

- [ ] **Step 5: Injecter collectionService dans PlanAssembler**

Ajouter `collectionService?: CollectionService` à `PlanServiceConfig`. Initialiser dans `index.ts`.

- [ ] **Step 6: Tests**

```bash
pnpm --filter @fragmint/server test packages/server/src/services/table-assembler.test.ts
pnpm --filter @fragmint/server typecheck
```

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/services/table-assembler.ts packages/server/src/services/table-assembler.test.ts packages/server/src/services/plan-assembler.ts
git commit -m "feat(plan): render_mode table/list/data_point in plan assembler"
```

---

## Task 11 — Export docx: tableau natif via docx-templates

**Files:**
- Create: `packages/server/src/services/render-docx-table.ts`
- Modify: `packages/server/src/services/plan-assembler.ts` (exportDocx)

Pour l'export docx, les sections `render_mode: table` ne passent **pas** par pandoc — elles utilisent `docx-templates` avec un template de tableau intégré (pas de fichier externe). `renderDocxWithTables()` assemble : sections prose via pandoc → Buffer, sections table via docx-templates → Buffer, puis fusionne avec `docx` (npm package) ou, plus simple, génère un seul docx-templates document avec toutes les sections.

**Approche choisie** : générer un seul document docx-templates avec une boucle globale. Passer `sections: [{type: 'prose', content: '...'}, {type: 'table', rows: [...], columns: [...]}]` au template. Nécessite un fichier template `.docx` de base dans `example-vault/templates/`.

- [ ] **Step 1: Écrire le script de génération du template docx**

Créer `packages/server/src/scripts/generate-docx-template.ts`. Ce script génère `example-vault/templates/base-plan.docx` programmatiquement via le package `docx` (npm). Le template est versionnable et reproductible — pas de création manuelle dans Word.

```typescript
// packages/server/src/scripts/generate-docx-template.ts
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, HeadingLevel, AlignmentType
} from 'docx';
import { writeFileSync, mkdirSync } from 'node:fs';

// Génère un template minimal utilisable par docx-templates.
// Les placeholders docx-templates (+++FOR+++, {field}) sont injectés
// comme TextRun dans le document Word source.
async function main() {
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({
          text: '+++FOR s IN sections+++',
          heading: HeadingLevel.HEADING_1,
        }),
        new Paragraph({ text: '{s.title}' }),
        new Paragraph({ text: '+++IF s.is_table+++' }),
        // Tableau template avec une ligne header et une ligne de données
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              children: [
                new TableCell({ children: [new Paragraph({ text: '+++FOR col IN s.columns+++' })] }),
                new TableCell({ children: [new Paragraph({ text: '{col}' })] }),
                new TableCell({ children: [new Paragraph({ text: '+++END-FOR col+++' })] }),
              ],
            }),
            new TableRow({
              children: [
                new TableCell({ children: [new Paragraph({ text: '+++FOR row IN s.rows+++' })] }),
                new TableCell({ children: [new Paragraph({ text: '+++FOR col IN s.columns+++{row[col]}+++END-FOR col+++' })] }),
                new TableCell({ children: [new Paragraph({ text: '+++END-FOR row+++' })] }),
              ],
            }),
          ],
        }),
        new Paragraph({ text: '+++ELSE+++' }),
        new Paragraph({ text: '{s.prose}' }),
        new Paragraph({ text: '+++END-IF+++' }),
        new Paragraph({ text: '+++END-FOR s+++' }),
      ],
    }],
  });

  mkdirSync('example-vault/templates', { recursive: true });
  const buf = await Packer.toBuffer(doc);
  writeFileSync('example-vault/templates/base-plan.docx', buf);
  console.log('Template généré : example-vault/templates/base-plan.docx');
}

main().catch(console.error);
```

Installer la dépendance si nécessaire :
```bash
pnpm --filter @fragmint/server add docx
npx tsx packages/server/src/scripts/generate-docx-template.ts
ls -la example-vault/templates/base-plan.docx
```

- [ ] **Step 2: Créer render-docx-table.ts**

```typescript
// packages/server/src/services/render-docx-table.ts
import { readFileSync } from 'node:fs';
import { createReport } from 'docx-templates';
import type { PlanSection, PlanState } from '../schema/plan.js';

interface DocxSection {
  title: string;
  is_table: boolean;
  prose: string;
  rows: Record<string, unknown>[];
  columns: string[];
}

export async function buildDocxSections(
  sections: PlanSection[],
  resolvedRows: Map<string, Record<string, unknown>[]>,  // sectionId → rows
): Promise<DocxSection[]> {
  return sections.map(s => ({
    title: s.title,
    is_table: s.render_mode === 'table',
    prose: s.generated_markdown?.trim() ?? '',
    rows: resolvedRows.get(s.id) ?? [],
    columns: s.columns ?? [],
  }));
}

export async function renderDocxWithTables(
  templatePath: string,
  title: string,
  sections: DocxSection[],
): Promise<Buffer> {
  const templateBuf = readFileSync(templatePath);
  const result = await createReport({
    template: templateBuf,
    data: { metadata: { title }, sections },
    cmdDelimiter: ['+++', '+++'],
    noSandbox: true,
  });
  return Buffer.from(result);
}
```

- [ ] **Step 3: Modifier exportDocx dans plan-assembler.ts**

```typescript
async exportDocx(id: string, args: { styleTemplatePath?: string }): Promise<{ content: Buffer; filename: string }> {
  const p = await this.get(id);
  if (!p) throw new Error('Plan not found');

  const hasTableSections = p.state.sections.some(s => s.render_mode === 'table');

  if (!hasTableSections) {
    // Ancien chemin pandoc inchangé
    if (!p.state.draft_markdown?.trim()) throw new Error('No assembled draft');
    const reference = args.styleTemplatePath ?? this.config.docxReferencePath;
    const buf = await renderMarkdownToDocx(p.state.draft_markdown, reference);
    await this.update(id, { status: 'completed' });
    return { content: buf, filename: `${slugify(p.title)}.docx` };
  }

  // Chemin hybride : résoudre les tableaux et utiliser docx-templates
  const resolvedRows = new Map<string, Record<string, unknown>[]>();
  for (const s of p.state.sections) {
    if (s.render_mode === 'table') {
      resolvedRows.set(s.id, await this.resolveTableRows(s));
    }
  }
  const docxSections = await buildDocxSections(p.state.sections, resolvedRows);
  const templatePath = args.styleTemplatePath ?? this.config.docxTableTemplatePath ?? 'example-vault/templates/base-plan.docx';
  const buf = await renderDocxWithTables(templatePath, p.title, docxSections);
  await this.update(id, { status: 'completed' });
  return { content: buf, filename: `${slugify(p.title)}.docx` };
}
```

- [ ] **Step 4: Ajouter docxTableTemplatePath à PlanServiceConfig**

```typescript
// Dans PlanServiceConfig:
docxTableTemplatePath?: string;
```

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter @fragmint/server typecheck
```

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/render-docx-table.ts packages/server/src/services/plan-assembler.ts
git commit -m "feat(export): hybrid docx export with native tables via docx-templates"
```

---

## Task 12 — Export PPTX: tableaux natifs via pptxgenjs

**Files:**
- Create: `packages/server/src/services/render-pptx-table.ts`
- Modify: `packages/server/src/services/plan-assembler.ts` (exportPptx)

`pptxgenjs` génère des fichiers PPTX avec de vrais tableaux PowerPoint. Les sections `render_mode: table` génèrent des slides avec `pptxgen.addTable()`. Les sections prose continuent à passer par Marp. **Qualité visuelle requise pour la démo** : slide de titre, détection débordement (>5 rows → split slides), layout adaptatif.

- [ ] **Step 1: Installer pptxgenjs**

```bash
pnpm --filter @fragmint/server add pptxgenjs
```

- [ ] **Step 2: Créer render-pptx-table.ts**

```typescript
// packages/server/src/services/render-pptx-table.ts
import PptxGenJS from 'pptxgenjs';

const ROWS_PER_SLIDE = 5;  // max rows before splitting onto a new slide
const LINAGORA_BLUE = '2B579A';

interface PptxSection {
  title: string;
  render_mode: string;
  prose: string;
  rows: Record<string, unknown>[];
  columns: string[];
}

function addTitleSlide(pptx: PptxGenJS, title: string): void {
  const slide = pptx.addSlide();
  slide.addText(title, {
    x: 0.5, y: 2.0, w: 9.0, fontSize: 36, bold: true,
    color: LINAGORA_BLUE, align: 'center',
  });
  slide.addShape(pptx.ShapeType.line, {
    x: 0.5, y: 3.2, w: 9.0, h: 0, line: { color: LINAGORA_BLUE, width: 2 },
  });
}

function addTableSlide(
  pptx: PptxGenJS,
  sectionTitle: string,
  columns: string[],
  rows: Record<string, unknown>[],
  slideIndex: number,
  totalSlides: number,
): void {
  const slide = pptx.addSlide();
  const titleSuffix = totalSlides > 1 ? ` (${slideIndex + 1}/${totalSlides})` : '';
  // Adapt title font size to length
  const titleFontSize = sectionTitle.length > 40 ? 18 : 22;
  slide.addText(sectionTitle + titleSuffix, {
    x: 0.5, y: 0.2, w: 9.0, h: 0.6, fontSize: titleFontSize, bold: true, color: LINAGORA_BLUE,
  });

  const tableData: PptxGenJS.TableRow[] = [
    columns.map(col => ({
      text: col,
      options: { bold: true, fill: { color: LINAGORA_BLUE }, color: 'FFFFFF', fontSize: 13 },
    })),
    ...rows.map(row =>
      columns.map(col => ({ text: String(row[col] ?? ''), options: { fontSize: 12 } }))
    ),
  ];
  slide.addTable(tableData, {
    x: 0.5, y: 1.0, w: 9.0,
    border: { pt: 1, color: 'CCCCCC' },
    autoPage: false,
  });
}

function addProseSlide(pptx: PptxGenJS, title: string, prose: string): void {
  const slide = pptx.addSlide();
  const titleFontSize = title.length > 40 ? 18 : 22;
  slide.addText(title, {
    x: 0.5, y: 0.2, w: 9.0, h: 0.6, fontSize: titleFontSize, bold: true, color: LINAGORA_BLUE,
  });
  // Split prose into bullet points if it contains newlines
  const bullets = prose.split('\n').filter(l => l.trim());
  if (bullets.length > 1) {
    slide.addText(
      bullets.map(b => ({ text: b.replace(/^[-*]\s+/, ''), options: { bullet: true } })),
      { x: 0.5, y: 1.0, w: 9.0, fontSize: 16 },
    );
  } else {
    slide.addText(prose, { x: 0.5, y: 1.0, w: 9.0, fontSize: 16 });
  }
}

export async function renderPptxWithTables(
  title: string,
  sections: PptxSection[],
): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.title = title;
  pptx.layout = 'LAYOUT_WIDE';  // 16:9

  // Title slide
  addTitleSlide(pptx, title);

  for (const section of sections) {
    if (section.render_mode === 'table' && section.rows.length > 0) {
      // Split rows across slides if needed
      const chunks: Record<string, unknown>[][] = [];
      for (let i = 0; i < section.rows.length; i += ROWS_PER_SLIDE) {
        chunks.push(section.rows.slice(i, i + ROWS_PER_SLIDE));
      }
      chunks.forEach((chunk, idx) =>
        addTableSlide(pptx, section.title, section.columns, chunk, idx, chunks.length)
      );
    } else {
      addProseSlide(pptx, section.title, section.prose);
    }
  }

  const buf = await pptx.write({ outputType: 'nodebuffer' }) as Buffer;
  return buf;
}
```

- [ ] **Step 3: Modifier exportPptx dans plan-assembler.ts**

```typescript
async exportPptx(id: string, opts: { marpTheme?: 'default' | 'gaia' | 'uncover' | 'linagora' } = {}): Promise<{ content: Buffer; filename: string }> {
  const p = await this.get(id);
  if (!p) throw new Error('Plan not found');

  const hasTableSections = p.state.sections.some(s => s.render_mode === 'table');

  if (!hasTableSections) {
    // Ancien chemin Marp inchangé
    if (!p.state.draft_markdown?.trim()) throw new Error('No assembled draft');
    const mdContent = buildMarpContent(p.state.draft_markdown, opts.marpTheme);
    const { buffer } = await renderMarpFromString(mdContent, 'pptx');
    await this.update(id, { status: 'completed' });
    return { content: buffer, filename: `${slugify(p.title)}.pptx` };
  }

  // Chemin pptxgenjs pour plans avec tableaux
  const resolvedRows = new Map<string, Record<string, unknown>[]>();
  for (const s of p.state.sections) {
    if (s.render_mode === 'table') {
      resolvedRows.set(s.id, await this.resolveTableRows(s));
    }
  }
  const sections = p.state.sections.map(s => ({
    title: s.title,
    render_mode: s.render_mode ?? 'prose',
    prose: s.generated_markdown?.trim() ?? '',
    rows: resolvedRows.get(s.id) ?? [],
    columns: s.columns ?? [],
  }));
  const buf = await renderPptxWithTables(p.title, sections);
  await this.update(id, { status: 'completed' });
  return { content: buf, filename: `${slugify(p.title)}.pptx` };
}
```

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @fragmint/server typecheck
```

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/render-pptx-table.ts packages/server/src/services/plan-assembler.ts
git commit -m "feat(export): native PPTX tables via pptxgenjs for table sections"
```

---

## Task 13 — MCP tools: collections + payload search

**Files:**
- Create: `packages/mcp/src/tools/collection-tools.ts`
- Modify: `packages/mcp/src/index.ts`

4 outils MCP : `list_collections`, `get_collection_members`, `search_fragments_by_payload`, `compose_table_slot`. Suivre le pattern des outils existants (`packages/mcp/src/tools/fragment-search.ts`).

- [ ] **Step 1: Lire un outil existant pour le pattern**

```bash
cat packages/mcp/src/tools/fragment-search.ts | head -60
```

- [ ] **Step 2: Créer collection-tools.ts**

```typescript
// packages/mcp/src/tools/collection-tools.ts
import type { FragmintApiClient } from '../client.js';
import type { ToolDefinition, ToolHandler } from '../types.js';
import { toolSuccess, toolError } from '../types.js';

export const listCollectionsDefinition: ToolDefinition = {
  name: 'list_collections',
  description: 'List fragment collections (table groups). Use to find a collection to use as table source in a plan.',
  inputSchema: {
    type: 'object',
    properties: {
      collection_slug: { type: 'string', description: 'Filter by workspace collection' },
      payload_schema: { type: 'string', description: 'Filter by payload schema id (e.g. sla-row-v1)' },
    },
  },
};

export const getCollectionMembersDefinition: ToolDefinition = {
  name: 'get_collection_members',
  description: 'Get fragments in a collection with their payload data.',
  inputSchema: {
    type: 'object',
    properties: { collection_id: { type: 'string' } },
    required: ['collection_id'],
  },
};

export const searchFragmentsByPayloadDefinition: ToolDefinition = {
  name: 'search_fragments_by_payload',
  description: 'Search fragments that have structured payload data, filtering by schema and field values.',
  inputSchema: {
    type: 'object',
    properties: {
      payload_schema: { type: 'string' },
      field: { type: 'string', description: 'Payload field to filter on' },
      value: { type: 'string', description: 'Value to match' },
    },
    required: ['payload_schema'],
  },
};

export const composeTableSlotDefinition: ToolDefinition = {
  name: 'compose_table_slot',
  description: 'Build a table slot spec for a plan section. Given a collection or fragment IDs and desired columns, returns the table_source object to use in a plan section.',
  inputSchema: {
    type: 'object',
    properties: {
      collection_id: { type: 'string' },
      fragment_ids: { type: 'array', items: { type: 'string' } },
      columns: { type: 'array', items: { type: 'string' } },
      order_by: { type: 'object', properties: { field: { type: 'string' }, direction: { type: 'string', enum: ['asc', 'desc'] } } },
    },
  },
};

export function listCollectionsHandler(client: FragmintApiClient): ToolHandler {
  return async (args) => {
    try {
      const params = new URLSearchParams();
      if (args.collection_slug) params.set('collection_slug', args.collection_slug);
      const data = await client.get(`/v1/fragment-collections?${params}`);
      return toolSuccess(data);
    } catch (err) { return toolError(String(err)); }
  };
}

export function getCollectionMembersHandler(client: FragmintApiClient): ToolHandler {
  return async (args) => {
    try {
      const col = await client.get(`/v1/fragment-collections/${args.collection_id}`);
      const members = await Promise.all(
        (col.member_ids ?? []).map((id: string) => client.get(`/v1/fragments/${id}`).catch(() => null))
      );
      return toolSuccess({ collection: col, members: members.filter(Boolean) });
    } catch (err) { return toolError(String(err)); }
  };
}

export function searchFragmentsByPayloadHandler(client: FragmintApiClient): ToolHandler {
  return async (args) => {
    try {
      const params = new URLSearchParams({ payload_schema: args.payload_schema });
      if (args.field) params.set('payload_field', args.field);
      if (args.value) params.set('payload_value', args.value);
      const data = await client.get(`/v1/fragments?${params}`);
      return toolSuccess(data);
    } catch (err) { return toolError(String(err)); }
  };
}

export function composeTableSlotHandler(_client: FragmintApiClient): ToolHandler {
  return async (args) => {
    const tableSource = {
      ...(args.collection_id ? { collection_id: args.collection_id } : {}),
      ...(args.fragment_ids ? { fragment_ids: args.fragment_ids } : {}),
      ...(args.order_by ? { order_by: args.order_by } : {}),
    };
    return toolSuccess({
      render_mode: 'table',
      table_source: tableSource,
      columns: args.columns ?? [],
      _hint: 'Add this object to a plan section via PUT /v1/plans/:id',
    });
  };
}
```

- [ ] **Step 3: Enregistrer les 4 outils dans index.ts**

```typescript
// Dans packages/mcp/src/index.ts — ajouter aux définitions et handlers:
import {
  listCollectionsDefinition, listCollectionsHandler,
  getCollectionMembersDefinition, getCollectionMembersHandler,
  searchFragmentsByPayloadDefinition, searchFragmentsByPayloadHandler,
  composeTableSlotDefinition, composeTableSlotHandler,
} from './tools/collection-tools.js';
// Ajouter dans le tableau tools:
{ definition: listCollectionsDefinition, handler: listCollectionsHandler(client) },
{ definition: getCollectionMembersDefinition, handler: getCollectionMembersHandler(client) },
{ definition: searchFragmentsByPayloadDefinition, handler: searchFragmentsByPayloadHandler(client) },
{ definition: composeTableSlotDefinition, handler: composeTableSlotHandler(client) },
```

- [ ] **Step 4: Ajouter `payload_schema` comme filtre sur GET /v1/fragments**

Dans `packages/server/src/routes/fragments.ts` (ou `fragment-service.ts`), ajouter `payload_schema` et `payload_field`/`payload_value` comme query params optionnels. Filtrer avec `eq(fragments.payload_schema, payload_schema)` via Drizzle.

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter @fragmint/mcp typecheck
pnpm --filter @fragmint/server typecheck
```

- [ ] **Step 6: Commit**

```bash
git add packages/mcp/src/tools/collection-tools.ts packages/mcp/src/index.ts packages/server/src/routes/fragments.ts
git commit -m "feat(mcp): collection tools + payload_schema filter on fragments"
```

---

## Task 14 — Harvest UI: validation des candidats tabulaires

**Files:**
- Modify: `packages/web/src/components/harvest/` (composant pipeline existant)

Les candidates `type: 'data'` avec un `payload` doivent être rendus différemment dans la pipeline UI : afficher les champs du payload en grille plutôt que le body en texte. Permettre l'édition cellule par cellule et la modification du `payload_schema`. Les actions approve/reject restent identiques.

- [ ] **Step 1: Lire le composant harvest pipeline existant**

```bash
find packages/web/src -name "*.tsx" | xargs grep -l "harvest\|candidate" | head -5
```

- [ ] **Step 2: Créer PayloadEditor (composant partagé)**

```typescript
// packages/web/src/components/payload-editor.tsx
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface FieldDef {
  key: string;
  label: string;
  type: 'string' | 'number';
}

interface Props {
  fields: FieldDef[];
  value: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
  disabled?: boolean;
}

export function PayloadEditor({ fields, value, onChange, disabled }: Props) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {fields.map(f => (
        <div key={f.key}>
          <Label className="text-xs text-muted-foreground">{f.label}</Label>
          <Input
            value={String(value[f.key] ?? '')}
            type={f.type === 'number' ? 'number' : 'text'}
            disabled={disabled}
            onChange={e => onChange({ ...value, [f.key]: f.type === 'number' ? Number(e.target.value) : e.target.value })}
          />
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Modifier la carte candidat harvest pour type='data'**

Dans le composant qui rend les `harvestCandidates`, détecter `candidate.payload_schema && candidate.payload` et rendre `<PayloadEditor>` au lieu du textarea body. Utiliser l'endpoint `GET /v1/payload-schemas` (voir ci-dessous) ou hard-coder la liste des schemas connus côté client.

- [ ] **Step 4: Ajouter GET /v1/payload-schemas**

Dans `packages/server/src/routes/`, créer une route simple :
```typescript
app.get('/v1/payload-schemas', async (req, reply) => {
  return reply.send(listPayloadSchemas().map(s => ({
    id: s.id,
    label: s.label,
    fields: Object.entries(s.fields.shape ?? {}).map(([key, _]) => ({ key, label: key })),
  })));
});
```

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/payload-editor.tsx packages/web/src/components/harvest/
git commit -m "feat(harvest-ui): payload editor for data candidates + table preview"
```

---

## Task 15 — Fragment drawer: affichage et édition du payload

**Files:**
- Modify: `packages/web/src/components/admin/fragment-detail-drawer.tsx`
- Modify: `packages/web/src/components/fragment-detail.tsx`

Afficher le payload en lecture dans les deux drawers. En mode édition (admin drawer), permettre l'édition via `PayloadEditor`.

- [ ] **Step 1: Modifier fragment-detail-drawer.tsx**

Dans la section "System info", après les tags, ajouter :

```tsx
{frag.payload && frag.payload_schema && (
  <div>
    <label className="block text-xs text-muted-foreground mb-2">Données structurées
      <span className="ml-2 text-xs bg-muted px-1.5 py-0.5 rounded">{frag.payload_schema}</span>
    </label>
    {editing ? (
      <PayloadEditor
        fields={getSchemaFields(frag.payload_schema)}  // helper qui appelle /v1/payload-schemas
        value={JSON.parse(frag.payload)}
        onChange={(v) => setForm(f => ({ ...f, payload: JSON.stringify(v) }))}
      />
    ) : (
      <div className="grid grid-cols-2 gap-2 text-xs">
        {Object.entries(JSON.parse(frag.payload)).map(([k, v]) => (
          <div key={k}><span className="text-muted-foreground">{k}:</span> {String(v)}</div>
        ))}
      </div>
    )}
  </div>
)}
```

- [ ] **Step 2: Ajouter payload aux mutations PUT**

Dans `updateMutation.mutationFn`, inclure `payload` et `payload_schema` si modifiés (déjà dans `updateFragmentSchema` après Task 1 — vérifier).

- [ ] **Step 3: Modifier fragment-detail.tsx (vue utilisateur)**

Même affichage lecture seule du payload, sans édition.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/admin/fragment-detail-drawer.tsx packages/web/src/components/fragment-detail.tsx
git commit -m "feat(ui): display and edit fragment payload in drawers"
```

---

## Task 16 — Admin page: Collections

**Files:**
- Create: `packages/web/src/pages/admin/collections.tsx`
- Create: `packages/web/src/api/hooks/use-collections.ts`
- Modify: `packages/web/src/router.tsx` (ou App.tsx)

Page `/admin/collections` : liste des collections avec titre, schema, nb membres. Clic → drawer avec liste ordonnée des fragments membres. Actions : renommer, supprimer membres, cloner, supprimer la collection.

- [ ] **Step 1: Créer les hooks React Query**

```typescript
// packages/web/src/api/hooks/use-collections.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/api/client';

export function useCollections(collectionSlug?: string) {
  return useQuery({
    queryKey: ['fragment-collections', collectionSlug],
    queryFn: () => {
      const params = collectionSlug ? `?collection_slug=${collectionSlug}` : '';
      return apiRequest('GET', `/v1/fragment-collections${params}`);
    },
  });
}

export function useCollection(id: string | null) {
  return useQuery({
    queryKey: ['fragment-collection', id],
    queryFn: () => apiRequest('GET', `/v1/fragment-collections/${id}`),
    enabled: !!id,
  });
}

export function useUpdateCollection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; title?: string; member_ids?: string[] }) =>
      apiRequest('PUT', `/v1/fragment-collections/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fragment-collections'] }),
  });
}

export function useDeleteCollection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiRequest('DELETE', `/v1/fragment-collections/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fragment-collections'] }),
  });
}
```

- [ ] **Step 2: Créer la page collections**

```typescript
// packages/web/src/pages/admin/collections.tsx
// Structure: liste de cards avec titre, badge schema, nb membres, source document
// Drawer détail: liste des fragments membres avec drag-and-drop pour réordonner (dnd-kit ou simple boutons ↑↓)
// Actions: rename (inline), delete, clone (POST nouvelle collection avec mêmes member_ids)
```

La page suit le même pattern que `packages/web/src/pages/admin/metadata/` — `useCollections()` + list de cards + Sheet drawer.

- [ ] **Step 3: Ajouter la route dans le router**

Dans `App.tsx` ou le fichier de routing :
```tsx
<Route path="/admin/collections" element={<AdminCollectionsPage />} />
```

Ajouter un lien dans la nav admin (là où se trouvent les autres onglets admin).

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/pages/admin/collections.tsx packages/web/src/api/hooks/use-collections.ts
git commit -m "feat(ui): admin collections page with drawer and member management"
```

---

## Task 17 — Plan builder UI: sélecteur de collection + render_mode

**Files:**
- Modify: `packages/web/src/pages/plan.tsx` (ou composant plan builder existant)

Dans l'interface de construction d'un plan (la page où on sélectionne les fragments par section), ajouter un toggle `render_mode` sur chaque section. Quand `render_mode = table`, afficher un picker de collection + sélecteur de colonnes.

- [ ] **Step 1: Lire le composant plan section existant**

```bash
find packages/web/src -name "*.tsx" | xargs grep -l "PlanSection\|section.*fragment\|generateSection" | head -5
```

- [ ] **Step 2: Ajouter le toggle render_mode sur les sections**

Dans le composant section du plan, ajouter un `<Select>` avec valeurs `prose | table | data_point | list`. Quand `table` sélectionné, afficher :

```tsx
{section.render_mode === 'table' && (
  <div className="space-y-2 mt-2">
    <CollectionPicker
      value={section.table_source?.collection_id}
      onChange={(id) => updateSection({ table_source: { collection_id: id } })}
    />
    <ColumnSelector
      collectionId={section.table_source?.collection_id}
      value={section.columns ?? []}
      onChange={(cols) => updateSection({ columns: cols })}
    />
  </div>
)}
```

- [ ] **Step 3: Créer CollectionPicker**

Composant simple : `<Select>` alimenté par `useCollections()`. Affiche titre + schema badge.

- [ ] **Step 4: Créer ColumnSelector**

Composant : fetche les members de la collection via `useCollection(id)`, extrait les clés de leurs payloads, affiche des checkboxes pour choisir les colonnes à afficher (et réordonner).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/pages/plan.tsx  # ou le fichier plan builder
git commit -m "feat(plan-ui): render_mode toggle + collection picker for table sections"
```

---

## Task 18 — Tests E2E: pipeline complet

**Files:**
- Create: `e2e/tabular-fragments.spec.ts`

Test Playwright : upload d'un docx avec tableau → vérification harvest → création plan avec section table → export docx → vérification.

- [ ] **Step 1: Créer un docx de test avec tableau**

```bash
# Créer e2e/fixtures/test-with-sla-table.docx via script ou manuellement
# Le docx doit contenir un tableau avec colonnes: Niveau, Prise en charge, Résolution
# Et 3 lignes: Critique/30min/8h, Majeur/2h/24h, Mineur/8h/72h
```

- [ ] **Step 2: Écrire le test**

```typescript
// e2e/tabular-fragments.spec.ts
import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { join } from 'path';

test('harvest table → fragment collection → plan table export', async ({ request }) => {
  const token = process.env.E2E_TOKEN!;
  const headers = { Authorization: `Bearer ${token}` };

  // 1. Upload docx avec tableau SLA
  const docxBuffer = readFileSync(join(__dirname, 'fixtures/test-with-sla-table.docx'));
  const form = new FormData();
  form.append('files', new Blob([docxBuffer], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), 'sla.docx');
  const harvestRes = await request.post('/v1/common/harvest', { headers, multipart: { files: docxBuffer } });
  const { job_id } = await harvestRes.json();

  // 2. Attendre fin du job (polling)
  let job;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000));
    job = await (await request.get(`/v1/jobs/${job_id}`, { headers })).json();
    if (job.status === 'done') break;
  }
  expect(job.status).toBe('done');

  // 3. Vérifier qu'une collection a été créée avec 3 membres
  const cols = await (await request.get('/v1/fragment-collections', { headers })).json();
  const tableCols = cols.filter((c: any) => c.payload_schema === 'sla-row-v1');
  expect(tableCols.length).toBeGreaterThan(0);
  expect(tableCols[0].member_ids.length).toBe(3);

  // 4. Créer un plan avec une section table
  const plan = await (await request.post('/v1/plans', {
    headers: { ...headers, 'Content-Type': 'application/json' },
    data: { title: 'Test SLA Plan', spec_prompt: 'Tableau SLA pour test' },
  })).json();

  // 5. Ajouter une section table pointant sur la collection
  await request.put(`/v1/plans/${plan.id}`, {
    headers: { ...headers, 'Content-Type': 'application/json' },
    data: {
      sections: [{
        id: 'section-1',
        title: 'Engagements SLA',
        description: 'Tableau SLA',
        render_mode: 'table',
        table_source: { collection_id: tableCols[0].id },
        columns: ['Niveau', 'Prise en charge', 'Résolution'],
        candidates: [], selected: [],
      }],
    },
  });

  // 6. Assembler et exporter en docx
  await request.post(`/v1/plans/${plan.id}/assemble`, { headers });
  const exportRes = await request.post(`/v1/plans/${plan.id}/export`, {
    headers: { ...headers, 'Content-Type': 'application/json' },
    data: { format: 'docx' },
  });
  expect(exportRes.status()).toBe(200);
  expect(exportRes.headers()['content-type']).toContain('application/vnd.openxmlformats');
});
```

- [ ] **Step 3: Lancer le test (serveur + Ollama requis)**

```bash
pnpm e2e -- --grep "harvest table"
```
Expected: 1 test passe

- [ ] **Step 4: Commit**

```bash
git add e2e/tabular-fragments.spec.ts e2e/fixtures/test-with-sla-table.docx
git commit -m "test(e2e): full tabular fragment pipeline harvest → collection → plan → export"
```

---

## Dépendances entre tâches

```
T1 (DB) → T2 (Schemas) → T3 (Migration)
T1 → T4 (Detector) → T6 (Decompose)
T2 → T5 (LLM Inference) → T6
T6 → T7 (Collection) → T8 (Harvest UI) + T16 (Admin UI)
T1 → T7 → T8 (Collection Service)
T9 (Plan Schema) → T10 (Assembler) → T11 (Docx) + T12 (PPTX)
T7 → T10 (CollectionService in PlanAssembler)
T2 → T14 (PayloadEditor) → T15 (Drawer)
T7 → T13 (MCP)
T10 → T13 (compose_table_slot uses plan section format)
T16 → T17 (CollectionPicker uses collections page data)
T10 + T11 + T12 + T17 → T18 (E2E)
```

**Parallélisable immédiatement après T1** : T2, T4, T9
**Parallélisable après T2** : T3, T5, T14
**Parallélisable après T7** : T8, T13, T16
**T19 indépendant** : peut démarrer à tout moment (documentation uniquement)

---

## Task 19 — OpenCode SKILL.md: workflow composition tabulaire

**Files:**
- Modify: `.claude/opencode/skills/fragmint.md` (ou chemin équivalent du skill OpenCode)

Mettre à jour le SKILL.md du skill `/fragmint` pour documenter le workflow de composition tabulaire. L'utilisateur doit pouvoir demander en langage naturel et OpenCode doit savoir enchaîner les bons outils MCP.

- [ ] **Step 1: Lire le skill existant**

```bash
find .claude -name "*.md" | xargs grep -l "fragmint\|compose" | head -5
cat $(find .claude -name "*.md" | xargs grep -l "fragmint" | head -1)
```

- [ ] **Step 2: Ajouter la section "Composition tabulaire"**

Dans le skill `/fragmint`, après la section existante sur la composition, ajouter :

```markdown
## Composition tabulaire — workflow

Quand l'utilisateur demande un tableau (SLA, pricing, références), enchaîner :

### Scénario A — Collection existante

1. `list_collections` (filter: payload_schema ou title)
2. `get_collection_members` (collection_id trouvé)
3. Afficher la liste des membres avec leur payload
4. Demander confirmation / subset souhaité
5. `compose_table_slot` (collection_id + fragment_ids optionnel + columns)
6. `PUT /v1/plans/:id` avec le table_source retourné

Exemple de prompt → actions :
> "Utilise la collection SLA pour la section engagements, retire Mineur et Négligeable"

→ list_collections(payload_schema="sla-row-v1")
→ get_collection_members(collection_id)
→ filtrer les member_ids (exclure les lignes avec niveau="Mineur"/"Négligeable")
→ compose_table_slot(collection_id, fragment_ids=[subset], columns=["Niveau","Prise en charge","Résolution"])
→ PUT /v1/plans/:id sections[i] = { render_mode: "table", table_source: {...}, columns: [...] }

### Scénario B — Composition ad-hoc depuis fragments dispersés

1. `search_fragments_by_payload` (payload_schema + filter)
2. Afficher les fragments trouvés avec leur payload
3. L'utilisateur sélectionne ou confirme
4. `compose_table_slot` (fragment_ids=[sélection] + columns)
5. `PUT /v1/plans/:id`

Exemple :
> "Cherche tous les fragments de pricing avec pu > 400 et mets-les dans un tableau"

→ search_fragments_by_payload(payload_schema="pricing-line-v1")
→ filtrer localement sur le champ pu
→ compose_table_slot(fragment_ids=[...])
→ PUT /v1/plans/:id

### Scénario C — Réutilisation prose d'un fragment tabulaire

Quand l'utilisateur veut une phrase prose depuis un fragment qui est aussi en tableau :

→ `fragment_get(fragment_id)` → utiliser le champ `body` (pas le payload)
→ Dans la section cible, `render_mode: "prose"` et `selected: [{fragment_id, body}]`

Le même fragment peut apparaître dans deux sections avec des render_modes différents.

### Règles générales

- Ne jamais inventer des données de tableau — toujours vérifier avec `get_collection_members` ou `search_fragments_by_payload`
- Si la collection n'existe pas, proposer d'en créer une manuellement ou suggérer un harvest
- Toujours confirmer les colonnes avec l'utilisateur avant de les injecter dans le plan
- Le champ `order_by` est optionnel mais recommandé pour les tableaux de pricing (order_by: {field: "prix_unitaire", direction: "asc"})
```

- [ ] **Step 3: Ajouter des exemples de prompts qui fonctionnent**

```markdown
## Exemples de prompts testés

✅ "Crée un récap des engagements SLA pour la propale CNB"
→ list_collections → get_collection_members → compose_table_slot

✅ "Reprends la collection SLA mais avec seulement Critique et Majeur"  
→ list_collections → get_collection_members → filtrer member_ids → compose_table_slot

✅ "Dans l'intro, cite notre engagement de prise en charge pour les incidents critiques"
→ search_fragments_by_payload(sla-row-v1) → filtrer niveau=Critique → fragment_get → render_mode=prose

✅ "Génère un tableau de prix pour les prestations support"
→ search_fragments_by_payload(pricing-line-v1) → compose_table_slot → PUT plan

❌ "Fais un tableau de SLA" sans collections ni fragments → répondre : "Je ne trouve pas de collection SLA. Voulez-vous d'abord uploader un document source ?"
```

- [ ] **Step 4: Commit**

```bash
git add .claude/
git commit -m "docs(opencode): table composition workflow in fragmint skill"
```
