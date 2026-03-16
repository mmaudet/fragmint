import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { exportFragmentsToXlsx } from './render-xlsx-export.js';

describe('exportFragmentsToXlsx', () => {
  const mockFragments = [
    {
      id: 'frag-001',
      title: 'Introduction to AI',
      type: 'knowledge',
      domain: 'artificial-intelligence',
      lang: 'en',
      quality: 'reviewed',
      author: 'alice',
      created_at: '2025-01-15T10:00:00Z',
    },
    {
      id: 'frag-002',
      title: 'Guide du développeur',
      type: 'howto',
      domain: 'engineering',
      lang: 'fr',
      quality: 'draft',
      author: 'bob',
      created_at: '2025-02-20T14:30:00Z',
    },
  ];

  it('should produce a valid XLSX buffer', async () => {
    const buffer = await exportFragmentsToXlsx(mockFragments);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);

    // Verify it can be read back as valid XLSX
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.getWorksheet('Fragments');
    expect(sheet).toBeDefined();
  });

  it('should have correct column headers', async () => {
    const buffer = await exportFragmentsToXlsx(mockFragments);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.getWorksheet('Fragments')!;

    const headerRow = sheet.getRow(1);
    const headers = [];
    headerRow.eachCell((cell) => headers.push(cell.value));
    expect(headers).toEqual(['ID', 'Titre', 'Type', 'Domaine', 'Langue', 'Qualité', 'Auteur', 'Créé le']);
  });

  it('should contain correct row data', async () => {
    const buffer = await exportFragmentsToXlsx(mockFragments);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.getWorksheet('Fragments')!;

    // 1 header + 2 data rows
    expect(sheet.rowCount).toBe(3);

    const row1 = sheet.getRow(2);
    expect(row1.getCell(1).value).toBe('frag-001');
    expect(row1.getCell(2).value).toBe('Introduction to AI');
    expect(row1.getCell(5).value).toBe('en');

    const row2 = sheet.getRow(3);
    expect(row2.getCell(1).value).toBe('frag-002');
    expect(row2.getCell(2).value).toBe('Guide du développeur');
    expect(row2.getCell(4).value).toBe('engineering');
  });

  it('should handle empty array', async () => {
    const buffer = await exportFragmentsToXlsx([]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.getWorksheet('Fragments')!;
    expect(sheet.rowCount).toBe(1); // header only
  });

  it('should have bold header row', async () => {
    const buffer = await exportFragmentsToXlsx(mockFragments);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.getWorksheet('Fragments')!;
    const headerRow = sheet.getRow(1);
    expect(headerRow.font?.bold).toBe(true);
  });
});
