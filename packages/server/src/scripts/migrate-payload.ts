#!/usr/bin/env tsx
// packages/server/src/scripts/migrate-payload.ts
//
// Migrates legacy fragments with structured tags (e.g. "pu:450", "qte:2", "libelle:Support N2")
// to use the new `payload` + `payload_schema` fields.
//
// Usage:
//   npx tsx packages/server/src/scripts/migrate-payload.ts [--apply] [--strict] [--csv=path.csv]
//
// Flags:
//   (none)        Dry-run: print what would happen, no DB writes
//   --apply       Write detected schema + payload to DB
//   --strict      Only exact schema matches (skip fragments with generic structured keys)
//   --csv=path    Export CSV with columns: fragment_id,schema_id,payload_json,warnings

import { createDb } from '../db/connection.js';
import { fragments } from '../db/schema.js';
import { eq, isNull } from 'drizzle-orm';
import { writeFileSync } from 'node:fs';

// ─── Schema key sets ──────────────────────────────────────────────────────────

const PRICING_KEYS = new Set(['pu', 'qte', 'libelle', 'unite', 'total']);
const SLA_KEYS = new Set(['niveau', 'prise_en_charge', 'resolution', 'penalite', 'disponibilite']);
const REFERENCE_KEYS = new Set(['client', 'projet', 'annee', 'montant', 'technologie']);
const NUMERIC_FIELDS = new Set(['pu', 'qte', 'total', 'prix_unitaire', 'quantite']);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Parse a JSON tags array like ["pu:450", "qte:2", "libelle:Support N2"]
 * into a key-value record, splitting only on the first colon.
 */
function parseStructuredTags(tagsJson: string | null): Record<string, string> {
  if (!tagsJson) return {};
  let arr: string[];
  try {
    arr = JSON.parse(tagsJson) as string[];
  } catch {
    return {};
  }
  const result: Record<string, string> = {};
  for (const tag of arr) {
    const colonIdx = tag.indexOf(':');
    if (colonIdx === -1) continue;
    const key = tag.slice(0, colonIdx).trim();
    const value = tag.slice(colonIdx + 1).trim();
    if (key) result[key] = value;
  }
  return result;
}

/**
 * Detect which payload schema applies to a tag object.
 * Returns the schema id or null if no match.
 */
function detectSchema(tagObj: Record<string, string>, strict: boolean): string | null {
  const keys = Object.keys(tagObj);
  if (keys.length === 0) return null;

  // Exact schema matches (checked in priority order)
  if (keys.some((k) => k === 'pu')) return 'pricing-line-v1';
  if (keys.some((k) => k === 'niveau') && keys.some((k) => k === 'prise_en_charge'))
    return 'sla-row-v1';
  if (keys.some((k) => k === 'client') && keys.some((k) => k === 'projet'))
    return 'reference-v1';

  if (strict) return null;

  // Non-strict: if ≥2 keys from any known key set, use generic
  const allKnownKeys = new Set([...PRICING_KEYS, ...SLA_KEYS, ...REFERENCE_KEYS]);
  const structuredCount = keys.filter((k) => allKnownKeys.has(k)).length;
  if (structuredCount >= 2) return 'generic-row-v1';

  return null;
}

/**
 * Validate that numeric fields are parseable floats.
 * Returns a flag and a list of warning strings.
 */
function validateNumericFields(tagObj: Record<string, string>): {
  valid: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];
  for (const [key, value] of Object.entries(tagObj)) {
    if (!NUMERIC_FIELDS.has(key)) continue;
    const num = parseFloat(value);
    if (isNaN(num)) {
      warnings.push(`field "${key}" has non-numeric value "${value}"`);
    }
  }
  return { valid: warnings.length === 0, warnings };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const apply = process.argv.includes('--apply');
  const strict = process.argv.includes('--strict');
  const csvPathArg = process.argv.find((a) => a.startsWith('--csv='));
  const csvPath = csvPathArg?.slice(6);

  const dbPath = process.env.FRAGMINT_DB_PATH ?? './example-vault/.fragmint.db';

  console.log(`DB path:   ${dbPath}`);
  console.log(`Mode:      ${apply ? 'APPLY (writes to DB)' : 'DRY-RUN (no writes)'}`);
  console.log(`Strict:    ${strict}`);
  if (csvPath) console.log(`CSV export: ${csvPath}`);
  console.log('');

  const db = createDb(dbPath);

  // Fetch all fragments that don't yet have a payload_schema
  const rows = await db
    .select({
      id: fragments.id,
      tags: fragments.tags,
      title: fragments.title,
    })
    .from(fragments)
    .where(isNull(fragments.payload_schema));

  console.log(`Found ${rows.length} fragment(s) without payload_schema\n`);

  type CsvRow = {
    fragment_id: string;
    schema_id: string;
    payload_json: string;
    warnings: string;
  };

  const csvRows: CsvRow[] = [];
  let migrated = 0;
  let skipped = 0;
  let withWarnings = 0;

  for (const row of rows) {
    const tagObj = parseStructuredTags(row.tags);
    const schemaId = detectSchema(tagObj, strict);

    if (!schemaId) {
      skipped++;
      continue;
    }

    const { warnings } = validateNumericFields(tagObj);
    if (warnings.length > 0) withWarnings++;

    const payloadJson = JSON.stringify(tagObj);

    // Console output (always, dry-run and apply alike)
    const warningStr = warnings.length > 0 ? ` [WARN: ${warnings.join('; ')}]` : '';
    const title = row.title ? ` "${row.title}"` : '';
    console.log(`  ${row.id}${title} → ${schemaId}${warningStr}`);
    console.log(`    payload: ${payloadJson}`);

    // CSV accumulation
    if (csvPath) {
      csvRows.push({
        fragment_id: row.id,
        schema_id: schemaId,
        payload_json: payloadJson,
        warnings: warnings.join('; '),
      });
    }

    // DB write (only in --apply mode)
    if (apply) {
      await db
        .update(fragments)
        .set({ payload: payloadJson, payload_schema: schemaId })
        .where(eq(fragments.id, row.id));
    }

    migrated++;
  }

  // CSV export
  if (csvPath && csvRows.length > 0) {
    const header = 'fragment_id,schema_id,payload_json,warnings\n';
    const body = csvRows
      .map(
        (r) =>
          `${r.fragment_id},${r.schema_id},"${r.payload_json.replace(/"/g, '""')}","${r.warnings.replace(/"/g, '""')}"`,
      )
      .join('\n');
    writeFileSync(csvPath, header + body, 'utf-8');
    console.log(`\nCSV written to ${csvPath} (${csvRows.length} row(s))`);
  }

  console.log('');
  console.log(`Results:`);
  console.log(`  Matched:      ${migrated}`);
  console.log(`  Skipped:      ${skipped} (no matching schema)`);
  console.log(`  With warnings: ${withWarnings}`);
  if (!apply && migrated > 0) {
    console.log('\nRe-run with --apply to write changes to DB.');
  }
}

main().catch((e) => {
  console.error('Migration failed:', e);
  process.exit(1);
});
