/**
 * Utilities for building GFM tables and markdown bullet lists
 * from fragment payload rows.
 */

/**
 * Build a GitHub-Flavored Markdown table from an array of row objects.
 * Returns an empty string if rows or columns are empty.
 */
export function buildGfmTable(rows: Record<string, unknown>[], columns: string[]): string {
  if (rows.length === 0 || columns.length === 0) return '';
  const header = '| ' + columns.join(' | ') + ' |';
  const sep = '| ' + columns.map(() => '---').join(' | ') + ' |';
  const dataRows = rows.map(
    (row) => '| ' + columns.map((c) => String(row[c] ?? '')).join(' | ') + ' |',
  );
  return [header, sep, ...dataRows].join('\n');
}

/**
 * Build a markdown bullet list from an array of body strings.
 */
export function buildMarkdownList(bodies: string[]): string {
  return bodies.map((b) => `- ${b.trim()}`).join('\n');
}
