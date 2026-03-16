/**
 * XLSX template renderer using ExcelJS directly.
 *
 * Template syntax (in cell values):
 *   - Simple substitution: ${path.to.value}
 *   - Table row expansion: ${table:arrayName.field} — row is duplicated for each array item
 *
 * ExcelJS reads the template, replaces placeholders, expands table rows, and writes output.
 */
import ExcelJS from 'exceljs';
import { readFileSync } from 'node:fs';
import type { RenderResult } from './render-engine.js';

export async function renderXlsx(
  templatePath: string,
  data: Record<string, any>,
): Promise<RenderResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(readFileSync(templatePath));

  const sheet = workbook.getWorksheet(1);
  if (!sheet) throw new Error('XLSX template has no worksheets');

  // 1. Find table rows (rows containing ${table:...}) and expand them
  const tableRows: Array<{ rowNum: number; arrayName: string; fields: Map<number, string> }> = [];

  sheet.eachRow({ includeEmpty: false }, (row, rowNum) => {
    const fields = new Map<number, string>();
    let arrayName = '';
    row.eachCell({ includeEmpty: false }, (cell, colNum) => {
      const val = String(cell.value ?? '');
      const match = val.match(/\$\{table:(\w+)\.(\w+)\}/);
      if (match) {
        arrayName = match[1];
        fields.set(colNum, match[2]);
      }
    });
    if (arrayName && fields.size > 0) {
      tableRows.push({ rowNum, arrayName, fields });
    }
  });

  // Process table rows in reverse order (so row numbers stay valid)
  for (const tableRow of tableRows.reverse()) {
    const array = getNestedValue(data, tableRow.arrayName);
    if (!Array.isArray(array) || array.length === 0) continue;

    const templateRowNum = tableRow.rowNum;
    const templateRowValues: Map<number, any> = new Map();
    const templateRowStyles: Map<number, any> = new Map();

    // Save template row styles
    const srcRow = sheet.getRow(templateRowNum);
    srcRow.eachCell({ includeEmpty: false }, (cell, colNum) => {
      templateRowStyles.set(colNum, {
        font: cell.font ? { ...cell.font } : undefined,
        alignment: cell.alignment ? { ...cell.alignment } : undefined,
        numFmt: cell.numFmt,
        border: cell.border ? { ...cell.border } : undefined,
        fill: cell.fill ? { ...cell.fill } : undefined,
      });
    });

    // Insert rows for additional items (first item replaces the template row)
    if (array.length > 1) {
      sheet.spliceRows(templateRowNum + 1, 0, ...Array(array.length - 1).fill([]));
    }

    // Fill data for each array item
    for (let i = 0; i < array.length; i++) {
      const targetRow = sheet.getRow(templateRowNum + i);
      const item = array[i];

      // Copy non-table cells from template row
      srcRow.eachCell({ includeEmpty: false }, (cell, colNum) => {
        if (!tableRow.fields.has(colNum)) {
          const targetCell = targetRow.getCell(colNum);
          targetCell.value = cell.value;
        }
      });

      // Fill table fields
      for (const [colNum, field] of tableRow.fields) {
        const targetCell = targetRow.getCell(colNum);
        const value = item[field];
        targetCell.value = value;

        // Apply styles from template
        const style = templateRowStyles.get(colNum);
        if (style) {
          if (style.font) targetCell.font = style.font;
          if (style.alignment) targetCell.alignment = style.alignment;
          if (style.numFmt) targetCell.numFmt = style.numFmt;
          if (style.border) targetCell.border = style.border;
        }
      }

      // Copy styles for non-table cells too
      for (const [colNum, style] of templateRowStyles) {
        if (!tableRow.fields.has(colNum)) {
          const targetCell = targetRow.getCell(colNum);
          if (style.font) targetCell.font = style.font;
          if (style.alignment) targetCell.alignment = style.alignment;
          if (style.numFmt) targetCell.numFmt = style.numFmt;
          if (style.border) targetCell.border = style.border;
        }
      }
    }
  }

  // 2. Replace simple ${path} placeholders in all cells
  sheet.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (typeof cell.value === 'string') {
        const replaced = cell.value.replace(/\$\{([^}]+)\}/g, (_, path) => {
          // Skip table: prefixed (already handled)
          if (path.startsWith('table:')) return '';
          const value = getNestedValue(data, path.trim());
          return value !== undefined && value !== null ? String(value) : '';
        });
        if (replaced !== cell.value) {
          cell.value = replaced;
        }
      }
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return { buffer: Buffer.from(buffer), format: 'xlsx' };
}

function getNestedValue(obj: Record<string, any>, path: string): any {
  return path.split('.').reduce((current, key) => current?.[key], obj);
}
