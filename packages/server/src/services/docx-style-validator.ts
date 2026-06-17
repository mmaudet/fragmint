import { execSync } from 'node:child_process';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

export interface StyleWarning {
  style: string;
  issue: string;
}

const REQUIRED_STYLES: Array<{
  id: string;
  label: string;
  checks: Array<'font' | 'color' | 'size'>;
}> = [
  { id: 'Normal', label: 'Normal', checks: ['font', 'size'] },
  { id: 'Heading1', label: 'Heading 1', checks: ['font', 'color'] },
  { id: 'Heading2', label: 'Heading 2', checks: ['font', 'color'] },
  { id: 'Heading3', label: 'Heading 3', checks: ['font'] },
];

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function attr(el: Element, localName: string): string {
  return el.getAttributeNS(W, localName) ?? el.getAttribute(`w:${localName}`) ?? '';
}

function extractStylesXml(docxBuffer: Buffer): string {
  const tmpId = randomUUID();
  const tmpDocx = join(tmpdir(), `fragmint-val-${tmpId}.docx`);
  try {
    writeFileSync(tmpDocx, docxBuffer);
    const xml = execSync(`unzip -p "${tmpDocx}" word/styles.xml`, { timeout: 10_000 });
    return xml.toString('utf-8');
  } finally {
    if (existsSync(tmpDocx))
      try {
        unlinkSync(tmpDocx);
      } catch (_) {}
  }
}

export function validateDocxStyles(docxBuffer: Buffer): StyleWarning[] {
  let xml: string;
  try {
    xml = extractStylesXml(docxBuffer);
  } catch {
    return [
      {
        style: 'Fichier',
        issue: 'Impossible de lire les styles (fichier .docx invalide ou corrompu)',
      },
    ];
  }

  const warnings: StyleWarning[] = [];
  const styleMap = parseStyles(xml);

  for (const req of REQUIRED_STYLES) {
    const s = styleMap.get(req.id);
    if (!s) {
      warnings.push({ style: req.label, issue: 'Style absent du document' });
      continue;
    }
    if (req.checks.includes('font') && !s.font) {
      warnings.push({ style: req.label, issue: 'Police (font) non définie' });
    }
    if (req.checks.includes('color') && (!s.color || s.color === 'auto' || s.color === '000000')) {
      warnings.push({ style: req.label, issue: 'Couleur non définie ou noire par défaut' });
    }
    if (req.checks.includes('size') && !s.size) {
      warnings.push({ style: req.label, issue: 'Taille non définie' });
    }
  }

  // Check Table Grid exists
  if (!styleMap.has('TableGrid') && !styleMap.has('Table Grid')) {
    warnings.push({
      style: 'Table Grid',
      issue: 'Style de tableau non défini — les tableaux seront non stylés',
    });
  }

  return warnings;
}

interface StyleInfo {
  font?: string;
  color?: string;
  size?: string;
}

function parseStyles(xml: string): Map<string, StyleInfo> {
  const map = new Map<string, StyleInfo>();
  // Extract each <w:style> block
  const styleRe = /<w:style\b([^>]*)>([\s\S]*?)<\/w:style>/g;
  let m: RegExpExecArray | null;
  while ((m = styleRe.exec(xml)) !== null) {
    const attrs = m[1];
    const body = m[2];
    const idMatch = /w:styleId="([^"]+)"/.exec(attrs);
    if (!idMatch) continue;
    const id = idMatch[1];
    const info: StyleInfo = {};
    // font: check both paragraph and character rPr
    const fontMatch = /w:rFonts[^/]*w:ascii="([^"]+)"/.exec(body);
    if (fontMatch) info.font = fontMatch[1];
    // color
    const colorMatch = /<w:color\b[^>]*w:val="([^"]+)"/.exec(body);
    if (colorMatch && colorMatch[1] !== 'auto') info.color = colorMatch[1];
    // size
    const sizeMatch = /<w:sz\b[^>]*w:val="([^"]+)"/.exec(body);
    if (sizeMatch) info.size = sizeMatch[1];
    map.set(id, info);
    // Also map by name for Table Grid
    const nameMatch = /w:name\b[^>]*w:val="([^"]+)"/.exec(body);
    if (nameMatch) map.set(nameMatch[1], info);
  }
  return map;
}
