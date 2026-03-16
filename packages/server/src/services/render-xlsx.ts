/**
 * XLSX template renderer using xlsx-template.
 *
 * Template syntax (in cell values):
 *   - Simple substitution: ${variableName}
 *   - Table (vertical expansion): ${table:rows.name} in each column
 *
 * See https://github.com/optilude/xlsx-template for full syntax.
 */
import XlsxTemplate from 'xlsx-template';
import { readFileSync } from 'node:fs';
import type { RenderResult } from './render-engine.js';

export async function renderXlsx(
  templatePath: string,
  data: Record<string, any>,
): Promise<RenderResult> {
  const templateBuf = readFileSync(templatePath);
  const template = new XlsxTemplate(templateBuf);

  // Substitute placeholders on sheet 1
  template.substitute(1, data);

  const output = template.generate({ type: 'nodebuffer' });
  return { buffer: Buffer.from(output as ArrayBuffer), format: 'xlsx' };
}
