import { randomUUID } from 'node:crypto';
import type { FragmintDb } from '../db/connection.js';
import { harvestCandidates } from '../db/schema.js';
import type { UploadHints } from '../schema/trust-source.js';
import { detectTables, type DetectedTable } from './table-detector.js';
import { inferPayloadSchema } from './payload-inference.js';
import type { FragmentCollectionService } from './fragment-collection-service.js';

const SCHEMA_TYPE_MAP: Record<string, string> = {
  'pricing-line-v1': 'pricing',
  'sla-row-v1': 'engagement',
  'reference-v1': 'reference',
  'generic-row-v1': 'pricing',
};

function buildGfmTable(table: DetectedTable): string {
  const header = '| ' + table.headers.join(' | ') + ' |';
  const sep = '| ' + table.headers.map(() => '---').join(' | ') + ' |';
  const rows = table.rows
    .filter((row) => Object.values(row).some((v) => v?.trim()))
    .map((row) => '| ' + table.headers.map((h) => row[h] ?? '').join(' | ') + ' |');
  return [header, sep, ...rows].join('\n');
}

function buildKeyValueBody(table: DetectedTable): string {
  return table.rows
    .filter((row) => Object.values(row).some((v) => v?.trim()))
    .map((row) => Object.values(row).filter(Boolean).join(': '))
    .join(' | ');
}

export interface DetectedTableSpec {
  table: DetectedTable;
  schemaId: string;
  body: string;
  docPosition?: number;  // assigned after matching to chunks
}

/** Phase 1: detect tables and return cleaned markdown (no DB write). */
export function extractTablesFromMarkdown(markdown: string): {
  specs: DetectedTableSpec[];
  cleanedMarkdown: string;
} {
  const { tables, cleanedMarkdown } = detectTables(markdown);
  const specs: DetectedTableSpec[] = [];

  for (const table of tables) {
    const schemaId = inferPayloadSchema(table);
    const isKeyValueTable = table.headers.length <= 2 && table.rows.length > 1;
    const body = isKeyValueTable ? buildKeyValueBody(table) : buildGfmTable(table);
    if (body.trim()) specs.push({ table, schemaId, body });
  }

  return { specs, cleanedMarkdown };
}

/** Phase 2: insert previously detected table specs into DB (called after LLM blocks). */
export async function flushTableCandidates(
  db: FragmintDb,
  specs: DetectedTableSpec[],
  jobId: string,
  filename: string,
  lang: string,
  uploadHints: UploadHints,
  existingDomains: string[],
  collectionService?: FragmentCollectionService,
): Promise<number> {
  if (specs.length === 0) return 0;

  const domain = (uploadHints.domain ?? existingDomains[0] ?? 'other') as string;
  let count = 0;

  for (const spec of specs) {
    const { table, schemaId, body } = spec;
    const id = `hcn-${randomUUID()}`;
    const title = table.precedingHeading ?? `Tableau (${schemaId})`;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await db.insert(harvestCandidates).values([{
      id,
      job_id: jobId,
      title,
      body,
      type: SCHEMA_TYPE_MAP[schemaId] ?? 'pricing',
      domain,
      lang,
      tags: JSON.stringify([]),
      confidence: 0.80,
      origin_source: filename,
      origin_page: null,
      source_section: table.precedingHeading ?? null,
      doc_position: spec.docPosition ?? 999999,
      status: 'pending',
      payload: JSON.stringify(table.rows),
      payload_schema: schemaId,
    }] as any);
    count += 1;

    if (collectionService) {
      await collectionService.create({
        title,
        payloadSchema: schemaId,
        memberIds: [id],
        sourceDocument: filename,
        createdBy: 'harvest-pipeline',
      });
    }
  }

  if (count > 0) {
    console.log(`[harvest:${jobId}] ${filename}: ${specs.length} table(s) → ${count} structured candidate(s)`);
  }

  return count;
}

/** Legacy single-phase helper (kept for compatibility). */
export async function insertTableCandidates(
  db: FragmintDb,
  markdown: string,
  jobId: string,
  filename: string,
  lang: string,
  uploadHints: UploadHints,
  existingDomains: string[],
  collectionService?: FragmentCollectionService,
): Promise<{ cleanedMarkdown: string; count: number }> {
  const { specs, cleanedMarkdown } = extractTablesFromMarkdown(markdown);
  const count = await flushTableCandidates(
    db, specs, jobId, filename, lang, uploadHints, existingDomains, collectionService,
  );
  return { cleanedMarkdown, count };
}
