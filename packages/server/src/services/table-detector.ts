export interface DetectedTable {
  headers: string[];
  rows: Record<string, string>[];
  precedingHeading?: string;
}

export interface DetectTablesResult {
  tables: DetectedTable[];
  cleanedMarkdown: string;
}

// ── Pipe table parser ─────────────────────────────────────────────────────────

function splitPipeRow(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') && !trimmed.includes('|')) return [];
  const cells = trimmed.replace(/^\||\|$/g, '').split('|');
  return cells.map((c) => c.trim());
}

function parsePipeTableBlock(lines: string[]): { headers: string[]; rows: Record<string, string>[] } | null {
  if (lines.length < 3) return null;
  const headers = splitPipeRow(lines[0]);
  if (headers.length === 0) return null;
  if (!/^\s*\|?(\s*[-:]+\s*\|)+\s*[-:]*\s*\|?\s*$/.test(lines[1])) return null;
  const rows: Record<string, string>[] = [];
  for (let i = 2; i < lines.length; i++) {
    const cells = splitPipeRow(lines[i]);
    if (cells.length === 0) break;
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = cells[idx] ?? ''; });
    rows.push(row);
  }
  return { headers, rows };
}

// ── Grid table parser (Pandoc +---+ format) ───────────────────────────────────

function isGridDivider(line: string): boolean {
  return /^\+[-=:+]+\+\s*$/.test(line.trim());
}

function isGridHeaderDivider(line: string): boolean {
  const t = line.trim();
  return /^\+[-=:+]+\+\s*$/.test(t) && t.includes('=');
}

function splitGridRow(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) return [];
  const cells = trimmed.replace(/^\||\|$/g, '').split('|');
  return cells.map((c) => c.trim());
}

function parseGridTableBlock(lines: string[]): { headers: string[]; rows: Record<string, string>[] } | null {
  if (lines.length < 3) return null;

  let headerDividerIdx = -1;
  const dataLines: string[][] = [];
  let currentGroup: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isGridHeaderDivider(line)) {
      headerDividerIdx = dataLines.length;
      if (currentGroup.length > 0) { dataLines.push(currentGroup); currentGroup = []; }
    } else if (isGridDivider(line)) {
      if (currentGroup.length > 0) { dataLines.push(currentGroup); currentGroup = []; }
    } else if (line.trim().startsWith('|')) {
      currentGroup.push(line);
    }
  }
  if (currentGroup.length > 0) dataLines.push(currentGroup);

  if (dataLines.length === 0) return null;

  const headerGroupIdx = headerDividerIdx > 0 ? headerDividerIdx - 1 : 0;
  const headerGroup = dataLines[headerGroupIdx] ?? [];

  const mergeGroup = (group: string[]): string[] => {
    const merged: string[] = [];
    for (const line of group) {
      const cells = splitGridRow(line);
      if (cells.length === 0) continue;
      if (merged.length === 0) {
        merged.push(...cells);
      } else {
        cells.forEach((c, i) => {
          if (c) merged[i] = merged[i] ? `${merged[i]} ${c}`.trim() : c;
        });
      }
    }
    return merged;
  };

  const headers = mergeGroup(headerGroup).filter(Boolean);
  if (headers.length < 2) return null;

  const rows: Record<string, string>[] = [];
  const startIdx = headerDividerIdx > 0 ? headerDividerIdx : 1;
  for (let i = startIdx; i < dataLines.length; i++) {
    const cells = mergeGroup(dataLines[i]);
    if (cells.every((c) => !c)) continue;
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = cells[idx] ?? ''; });
    rows.push(row);
  }

  return rows.length > 0 ? { headers, rows } : null;
}

// ── Simple table parser (Pandoc space-aligned with --- borders) ───────────────

function isSimpleTableBorder(line: string): boolean {
  // Solid line of many dashes: "  --------...--------"
  return /^\s*-{10,}\s*$/.test(line);
}

function isSimpleTableColSep(line: string): boolean {
  // Multiple dash groups separated by spaces: "  ---  ------  ----"
  return /^\s*-{2,}(\s{1,4}-{2,}){2,}\s*$/.test(line);
}

function stripMarkdownSyntax(text: string): string {
  return text.replace(/\*\*/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();
}

function parseSimpleTableBlock(lines: string[]): { headers: string[]; rows: Record<string, string>[] } | null {
  if (lines.length < 4) return null;

  // Find column separator (multiple dash groups), skip first border
  const colSepIdx = lines.findIndex((l, i) => i > 0 && isSimpleTableColSep(l));
  if (colSepIdx < 2) return null;

  // Extract column start positions from separator line
  const sep = lines[colSepIdx];
  const colStarts: number[] = [];
  let inSpace = true;
  for (let k = 0; k < sep.length; k++) {
    if (sep[k] === '-' && inSpace) { colStarts.push(k); inSpace = false; }
    if (sep[k] !== '-') inSpace = true;
  }
  if (colStarts.length < 2) return null;

  const sliceCol = (line: string, col: number): string => {
    const start = colStarts[col] ?? 0;
    const end = col + 1 < colStarts.length ? colStarts[col + 1] : line.length;
    return stripMarkdownSyntax(line.slice(Math.min(start, line.length), Math.min(end, line.length)));
  };

  // Headers: lines 1..colSepIdx-1 merged per column
  const headers = colStarts.map((_, c) =>
    lines.slice(1, colSepIdx).map((l) => sliceCol(l, c)).filter(Boolean).join(' ')
  ).filter(Boolean);
  if (headers.length < 2) return null;

  // Data rows
  const rows: Record<string, string>[] = [];
  let current: Record<string, string> | null = null;

  for (let i = colSepIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (isSimpleTableBorder(line)) break;
    const cells = colStarts.map((_, c) => sliceCol(line, c));
    if (cells.every((c) => !c)) {
      if (current) { rows.push(current); current = null; }
      continue;
    }
    if (cells[0]) {
      if (current) rows.push(current);
      current = Object.fromEntries(headers.map((h, c) => [h, cells[c] ?? '']));
    } else if (current) {
      headers.forEach((h, c) => {
        if (cells[c]) current![h] = `${current![h]} ${cells[c]}`.trim();
      });
    }
  }
  if (current) rows.push(current);

  // Only keep rows with at least 2 non-empty values (filter out total/summary rows)
  const dataRows = rows.filter((r) => Object.values(r).filter(Boolean).length >= 2);
  return dataRows.length > 0 ? { headers, rows: dataRows } : null;
}

// ── HTML table parser (Pandoc <table> output for complex Word tables) ─────────

function stripHtmlTags(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function extractHtmlCells(tagName: 'th' | 'td', block: string): string[] {
  const re = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'gi');
  const cells: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    cells.push(stripHtmlTags(m[1]));
  }
  return cells;
}

function parseHtmlTableBlock(html: string): { headers: string[]; rows: Record<string, string>[] } | null {
  const theadMatch = /<thead[^>]*>([\s\S]*?)<\/thead>/i.exec(html);
  const headers = theadMatch
    ? extractHtmlCells('th', theadMatch[1])
    : extractHtmlCells('th', html);

  if (headers.length < 2) return null;

  const tbodyMatch = /<tbody[^>]*>([\s\S]*?)<\/tbody>/i.exec(html);
  const bodyHtml = tbodyMatch ? tbodyMatch[1] : html;

  const rows: Record<string, string>[] = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch: RegExpExecArray | null;
  while ((trMatch = trRe.exec(bodyHtml)) !== null) {
    const cells = extractHtmlCells('td', trMatch[1]);
    if (cells.length === 0) continue;
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = cells[idx] ?? ''; });
    rows.push(row);
  }

  return rows.length > 0 ? { headers, rows } : null;
}

// ── Main detector ─────────────────────────────────────────────────────────────

export function detectTables(markdown: string): DetectTablesResult {
  const lines = markdown.split('\n');
  const tables: DetectedTable[] = [];
  const removeLines = new Set<number>();

  let lastHeading: string | undefined;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    const headingMatch = /^#{1,6}\s+(.+)/.exec(line);
    if (headingMatch) {
      lastHeading = headingMatch[1].replace(/\{[^}]+\}/g, '').trim();
      i++;
      continue;
    }

    // Simple table (Pandoc space-aligned): solid border line
    if (isSimpleTableBorder(line)) {
      const tableStart = i;
      const tableLines: string[] = [line];
      i++;
      while (i < lines.length && !isSimpleTableBorder(lines[i])) {
        tableLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) { tableLines.push(lines[i]); i++; } // closing border
      const parsed = parseSimpleTableBlock(tableLines);
      for (let j = tableStart; j < tableStart + tableLines.length; j++) {
        removeLines.add(j); // always strip
      }
      if (parsed && parsed.rows.length > 0) {
        tables.push({ headers: parsed.headers, rows: parsed.rows, precedingHeading: lastHeading });
      }
      continue;
    }

    // Grid table: starts with +---+ or +===+
    if (isGridDivider(line)) {
      const tableStart = i;
      const tableLines: string[] = [];
      while (i < lines.length && (isGridDivider(lines[i]) || lines[i].trim().startsWith('|'))) {
        tableLines.push(lines[i]);
        i++;
      }
      const parsed = parseGridTableBlock(tableLines);
      for (let j = tableStart; j < tableStart + tableLines.length; j++) {
        removeLines.add(j);
      }
      if (parsed && parsed.rows.length > 0) {
        tables.push({ headers: parsed.headers, rows: parsed.rows, precedingHeading: lastHeading });
      }
      continue;
    }

    // HTML table: Pandoc output for complex Word tables
    if (line.trim().toLowerCase().startsWith('<table')) {
      const tableStart = i;
      const tableLines: string[] = [line];
      i++;
      while (i < lines.length && !lines[i].toLowerCase().includes('</table>')) {
        tableLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) { tableLines.push(lines[i]); i++; } // closing </table>
      const htmlBlock = tableLines.join('\n');
      for (let j = tableStart; j < tableStart + tableLines.length; j++) {
        removeLines.add(j); // always strip HTML tables regardless of parse result
      }
      const parsed = parseHtmlTableBlock(htmlBlock);
      if (parsed && parsed.rows.length > 0) {
        tables.push({ headers: parsed.headers, rows: parsed.rows, precedingHeading: lastHeading });
      }
      continue;
    }

    // Pipe table: starts with |
    if (line.trim().startsWith('|') || /\S.*\|/.test(line)) {
      const tableStart = i;
      const tableLines: string[] = [];
      while (i < lines.length && (lines[i].trim().startsWith('|') || (lines[i].includes('|') && tableLines.length < 2))) {
        tableLines.push(lines[i]);
        i++;
      }
      const parsed = parsePipeTableBlock(tableLines);
      if (parsed && parsed.rows.length > 0) {
        tables.push({ headers: parsed.headers, rows: parsed.rows, precedingHeading: lastHeading });
        for (let j = tableStart; j < tableStart + tableLines.length; j++) {
          removeLines.add(j);
        }
      } else {
        i = tableStart + 1;
      }
      continue;
    }

    i++;
  }

  const cleanedMarkdown = lines
    .filter((_, idx) => !removeLines.has(idx))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');

  return { tables, cleanedMarkdown };
}
