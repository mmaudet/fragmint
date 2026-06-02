import { createRequire } from 'node:module';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const PptxGenJS = createRequire(import.meta.url)('pptxgenjs') as typeof import('pptxgenjs');

const LINAGORA_BLUE = '2B579A';
const SLIDE_W = 10; // inches (LAYOUT_WIDE)
const SLIDE_H = 7.5;
const MAX_TABLE_ROWS_PER_SLIDE = 5;

export interface PptxSection {
  title: string;
  render_mode?: 'prose' | 'table' | 'list' | 'data_point';
  prose?: string;
  rows?: Record<string, unknown>[];
  columns?: string[];
}

type AnyPptx = {
  layout: string;
  title: string;
  addSlide: () => AnySlide;
  write: (opts: { outputType: string }) => Promise<unknown>;
};

type AnySlide = {
  addText: (text: string | object[], opts: object) => void;
  addTable: (rows: object[][], opts: object) => void;
};

function addTitleSlide(pptx: AnyPptx, title: string): void {
  const slide = pptx.addSlide();
  slide.addText(title, {
    x: 0.5,
    y: SLIDE_H / 2 - 0.5,
    w: SLIDE_W - 1,
    h: 1.5,
    fontSize: 36,
    bold: true,
    color: LINAGORA_BLUE,
    align: 'center',
  });
}

function addProseSlide(pptx: AnyPptx, title: string, prose: string): void {
  const slide = pptx.addSlide();
  slide.addText(title, {
    x: 0.5,
    y: 0.3,
    w: SLIDE_W - 1,
    h: 0.7,
    fontSize: 24,
    bold: true,
    color: LINAGORA_BLUE,
  });
  const bullets = prose
    .split('\n')
    .map((l) => l.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean);
  if (bullets.length > 0) {
    const textItems = bullets.map((b) => ({ text: b, options: { bullet: true, fontSize: 16 } }));
    slide.addText(textItems, {
      x: 0.5,
      y: 1.2,
      w: SLIDE_W - 1,
      h: SLIDE_H - 1.7,
      valign: 'top',
    });
  }
}

function addTableSlide(
  pptx: AnyPptx,
  title: string,
  columns: string[],
  rows: Record<string, unknown>[],
  slideIndex: number,
  totalSlides: number,
): void {
  const slide = pptx.addSlide();
  const suffix = totalSlides > 1 ? ` (${slideIndex + 1}/${totalSlides})` : '';
  slide.addText(title + suffix, {
    x: 0.5,
    y: 0.2,
    w: SLIDE_W - 1,
    h: 0.6,
    fontSize: 22,
    bold: true,
    color: LINAGORA_BLUE,
  });

  const colW = (SLIDE_W - 1) / Math.max(columns.length, 1);

  const headerRow = columns.map((col) => ({
    text: col,
    options: {
      bold: true,
      color: 'FFFFFF',
      fill: { color: LINAGORA_BLUE },
      fontSize: 13,
      align: 'center',
    },
  }));

  const dataRows = rows.map((row) =>
    columns.map((col) => ({
      text: String(row[col] ?? ''),
      options: { fontSize: 12 },
    })),
  );

  slide.addTable([headerRow, ...dataRows], {
    x: 0.5,
    y: 1.0,
    w: SLIDE_W - 1,
    colW: columns.map(() => colW),
    border: { type: 'solid', pt: 1, color: 'CCCCCC' },
  });
}

/**
 * Render a PPTX presentation from an array of sections.
 * Table sections are split into slides of MAX_TABLE_ROWS_PER_SLIDE rows each.
 * Returns a Buffer containing the .pptx binary data.
 */
export async function renderPptxWithTables(
  title: string,
  sections: PptxSection[],
): Promise<Buffer> {
  // PptxGenJS CJS module — instantiated via createRequire
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pptx = new (PptxGenJS as any)() as AnyPptx;
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = title;

  addTitleSlide(pptx, title);

  for (const section of sections) {
    if (section.render_mode === 'table' && section.columns && section.rows) {
      const rows = section.rows;
      const columns = section.columns;
      const chunks: Record<string, unknown>[][] = [];
      for (let i = 0; i < rows.length; i += MAX_TABLE_ROWS_PER_SLIDE) {
        chunks.push(rows.slice(i, i + MAX_TABLE_ROWS_PER_SLIDE));
      }
      if (chunks.length === 0) chunks.push([]);
      chunks.forEach((chunk, idx) => {
        addTableSlide(pptx, section.title, columns, chunk, idx, chunks.length);
      });
    } else {
      addProseSlide(pptx, section.title, section.prose ?? '');
    }
  }

  const output = await pptx.write({ outputType: 'nodebuffer' });
  return output as Buffer;
}
