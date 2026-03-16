import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import ExcelJS from 'exceljs';
import { renderXlsx } from './render-xlsx.js';

describe('renderXlsx', () => {
  let tempDir: string;
  let templatePath: string;

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'render-xlsx-'));
    templatePath = join(tempDir, 'template.xlsx');

    // Create a minimal xlsx template with a ${client} placeholder in A1
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sheet1');
    sheet.getCell('A1').value = '${client}';
    sheet.getCell('B1').value = 'Static text';

    const buf = await workbook.xlsx.writeBuffer();
    writeFileSync(templatePath, Buffer.from(buf));
  });

  afterAll(() => {
    try {
      unlinkSync(templatePath);
    } catch {
      // ignore cleanup errors
    }
  });

  it('substitutes ${client} placeholder in cell A1', async () => {
    const result = await renderXlsx(templatePath, { client: 'LINAGORA' });

    expect(result.format).toBe('xlsx');
    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.buffer.length).toBeGreaterThan(0);

    // Parse the output and verify substitution
    const outputWorkbook = new ExcelJS.Workbook();
    await outputWorkbook.xlsx.load(result.buffer);

    const sheet = outputWorkbook.getWorksheet('Sheet1');
    expect(sheet).toBeDefined();

    const cellValue = sheet!.getCell('A1').value;
    expect(cellValue).toBe('LINAGORA');
  });

  it('preserves static content in other cells', async () => {
    const result = await renderXlsx(templatePath, { client: 'TestCorp' });

    const outputWorkbook = new ExcelJS.Workbook();
    await outputWorkbook.xlsx.load(result.buffer);

    const sheet = outputWorkbook.getWorksheet('Sheet1')!;
    expect(sheet.getCell('B1').value).toBe('Static text');
  });
});
