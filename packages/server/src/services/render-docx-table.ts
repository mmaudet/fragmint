import { readFileSync } from 'node:fs';
import { createReport } from 'docx-templates';

export interface DocxSection {
  title: string;
  is_table: boolean;
  prose: string;
  rows: Record<string, unknown>[];
  columns: string[];
}

/**
 * Render a .docx document from a Word template using docx-templates syntax.
 * Supports both prose sections and table sections.
 *
 * Expected template variables:
 *   metadata.title  — document title
 *   sections[]      — array of DocxSection
 *     .title        — section heading
 *     .is_table     — whether to render as a table
 *     .prose        — prose markdown/text content
 *     .rows[]       — data rows for table sections
 *     .columns[]    — column names for table sections
 */
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
