import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import { v4 as uuidv4 } from 'uuid';
import { fragmentFrontmatterSchema, type FragmentFrontmatter } from '../schema/fragment.js';

export function generateId(): string {
  return `frag-${uuidv4()}`;
}

export function deriveTitle(body: string): string {
  if (!body.trim()) return 'Untitled';
  const headingMatch = body.match(/^#\s+(.+)$/m);
  if (headingMatch) return headingMatch[1].trim();
  const firstLine = body.trim().split('\n')[0].trim();
  return firstLine || 'Untitled';
}

function toKebabCase(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // remove accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function writeFragment(
  dirPath: string,
  frontmatter: FragmentFrontmatter,
  body: string,
): string {
  // Append short id suffix to avoid collisions when type+domain+lang are identical
  const idSuffix = frontmatter.id.slice(-8);
  const filename = `${toKebabCase(frontmatter.type)}-${toKebabCase(frontmatter.domain)}-${frontmatter.lang}-${idSuffix}.md`;
  const filePath = join(dirPath, filename);
  const content = matter.stringify(body, frontmatter as unknown as Record<string, unknown>);
  writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

export interface ParsedFragment {
  frontmatter: FragmentFrontmatter;
  body: string;
}

export function readFragment(filePath: string): ParsedFragment {
  const raw = readFileSync(filePath, 'utf-8');
  const { data, content } = matter(raw);
  const frontmatter = fragmentFrontmatterSchema.parse(data);
  return { frontmatter, body: content.trim() };
}
