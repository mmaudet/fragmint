/**
 * Unified document rendering engine.
 * Dispatches to the right library based on output format.
 *
 * Supported formats:
 *   - docx: docx-templates (MIT)
 *   - xlsx: xlsx-template  (MIT) — not yet implemented
 *   - pptx: docxtemplater  (MIT/GPLv3 free core) — not yet implemented
 */
import { readFileSync } from 'node:fs';
import { createReport } from 'docx-templates';

export type SupportedFormat = 'docx' | 'xlsx' | 'pptx';

export interface RenderResult {
  buffer: Buffer;
  format: SupportedFormat;
}

/**
 * Render a template file with the given data.
 * Returns a Buffer containing the generated document.
 */
export async function renderDocument(
  templatePath: string,
  data: Record<string, any>,
  format: SupportedFormat,
): Promise<RenderResult> {
  switch (format) {
    case 'docx':
      return renderDocx(templatePath, data);
    case 'xlsx':
      throw new Error('XLSX rendering not yet implemented. Install xlsx-template when ready.');
    case 'pptx':
      throw new Error('PPTX rendering not yet implemented. Install docxtemplater when ready.');
    default:
      throw new Error(`Unsupported format: ${format}`);
  }
}

/**
 * DOCX rendering via docx-templates.
 *
 * Template syntax:
 *   - Simple insertion: {introduction}
 *   - Loop:  +++FOR row IN rows+++ {row.name} +++END-FOR row+++
 *   - Condition: +++IF showSection+++ ... +++END-IF showSection+++
 *
 * For table row loops, place FOR/END-FOR in the first/last cell of the row.
 */
async function renderDocx(
  templatePath: string,
  data: Record<string, any>,
): Promise<RenderResult> {
  const templateBuf = readFileSync(templatePath);

  const result = await createReport({
    template: templateBuf,
    data,
    cmdDelimiter: ['+++', '+++'],
    noSandbox: true,
  });

  return {
    buffer: Buffer.from(result),
    format: 'docx',
  };
}
