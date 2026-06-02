// packages/server/src/services/index-service.ts
import { eq, and, inArray, type SQL } from 'drizzle-orm';
import type { FragmintDb } from '../db/connection.js';
import { fragments } from '../db/schema.js';

const SUBJECT_PREFIX: Record<string, string> = {
  'twake-mail': 'TM',
  'twake-drive': 'TD',
  'twake-chat': 'TC',
  'twake-calendar': 'TCAL',
  linshare: 'LS',
  lincloud: 'LC',
  linto: 'LT',
  openrag: 'OR',
  'apache-james': 'AJ',
  'linagora-corp': 'LIN',
  other: 'OTH',
};

const SUBJECT_LABEL: Record<string, string> = {
  'twake-mail': 'Twake Mail',
  'twake-drive': 'Twake Drive',
  'twake-chat': 'Twake Chat',
  'twake-calendar': 'Twake Calendar',
  linshare: 'LinShare',
  lincloud: 'LinCloud',
  linto: 'LinTO',
  openrag: 'OpenRAG',
  'apache-james': 'Apache James',
  'linagora-corp': 'Linagora Corp',
  other: 'Autres',
};

const TYPE_SHORT: Record<string, string> = {
  argument: 'arg',
  pricing: 'pricing',
  faq: 'faq',
  methodology: 'method',
  engagement: 'engage',
  'use-case': 'uc',
  clause: 'clause',
  conclusion: 'concl',
  introduction: 'intro',
  testimonial: 'temo',
  bio: 'bio',
};

export interface IndexFragment {
  readable_id: string;
  id: string;
  title: string;
  lang: string;
  tags: string[];
}

export interface IndexSubject {
  label: string;
  prefix: string;
  count: number;
  types: Record<string, IndexFragment[]>;
}

export interface IndexData {
  generated_at: string;
  total: number;
  subjects: Record<string, IndexSubject>;
}

function subjectPrefix(domain: string): string {
  return SUBJECT_PREFIX[domain] ?? domain.slice(0, 3).toUpperCase();
}

function typeShort(type: string): string {
  return TYPE_SHORT[type] ?? type;
}

function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    return JSON.parse(value) as string[];
  } catch {
    return [];
  }
}

export class IndexService {
  private cachedData: IndexData | null = null;
  private cacheTimestamp = 0;
  private readonly CACHE_TTL = 5 * 60 * 1000;

  constructor(private db: FragmintDb) {}

  invalidateCache(): void {
    this.cachedData = null;
  }

  async getIndex(format: 'md' | 'json', collectionSlug?: string): Promise<string | IndexData> {
    const data = await this.getData(false, collectionSlug);
    return format === 'json' ? data : renderMarkdown(data);
  }

  async getData(forceRefresh = false, collectionSlug?: string): Promise<IndexData> {
    if (collectionSlug) {
      // Filtered queries never use the global cache
      return this.generate(collectionSlug);
    }
    const now = Date.now();
    if (!forceRefresh && this.cachedData && now - this.cacheTimestamp < this.CACHE_TTL) {
      return this.cachedData;
    }
    this.cachedData = await this.generate();
    this.cacheTimestamp = now;
    return this.cachedData;
  }

  private async generate(collectionSlug?: string): Promise<IndexData> {
    const conditions: SQL[] = [eq(fragments.quality, 'approved')];
    if (collectionSlug) conditions.push(eq(fragments.collection_slug, collectionSlug));

    const rows = await this.db
      .select()
      .from(fragments)
      .where(conditions.length === 1 ? conditions[0] : and(...conditions));

    const subjects: Record<string, IndexSubject> = {};

    for (const row of rows) {
      const domain = row.domain;
      const type = row.type;
      if (!subjects[domain]) {
        subjects[domain] = {
          label: SUBJECT_LABEL[domain] ?? domain,
          prefix: subjectPrefix(domain),
          count: 0,
          types: {},
        };
      }
      if (!subjects[domain].types[type]) {
        subjects[domain].types[type] = [];
      }
      subjects[domain].types[type].push({
        readable_id: row.readable_id ?? '',
        id: row.id,
        title: row.title ?? row.id,
        lang: row.lang,
        tags: parseJsonArray(row.tags),
      });
      subjects[domain].count++;
    }

    for (const [domain, subjectData] of Object.entries(subjects)) {
      const prefix = subjectPrefix(domain);
      for (const [type, frags] of Object.entries(subjectData.types)) {
        frags.sort((a, b) => a.title.localeCompare(b.title));
        const short = typeShort(type);
        // Collect stable IDs to avoid collisions when assigning positional fallbacks
        const stableIds = new Set(frags.map((f) => f.readable_id).filter(Boolean));
        let fallbackNum = 1;
        frags.forEach((f) => {
          if (!f.readable_id) {
            // Positional fallback for pre-migration fragments (run migrate-readable-ids.ts to fix permanently)
            let candidate: string;
            do {
              candidate = `${prefix}-${short}-${String(fallbackNum++).padStart(3, '0')}`;
            } while (stableIds.has(candidate));
            f.readable_id = candidate;
            stableIds.add(candidate);
          }
        });
      }
    }

    return { generated_at: new Date().toISOString(), total: rows.length, subjects };
  }

}

export function buildReadableIdMap(data: IndexData): Map<string, string> {
  const map = new Map<string, string>();
  for (const subj of Object.values(data.subjects)) {
    for (const frags of Object.values(subj.types)) {
      for (const f of frags) {
        map.set(f.readable_id, f.id);
      }
    }
  }
  return map;
}

export function renderToc(data: IndexData): string {
  const typeKeys = Object.keys(TYPE_SHORT);
  const header = `| Domaine | ${typeKeys.join(' | ')} | Total |`;
  const sep = `|---------|${typeKeys.map(() => '---').join('|')}|-------|`;
  const rows = Object.entries(data.subjects)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([domain, subj]) => {
      const counts = typeKeys.map((t) => subj.types[t]?.length ?? 0);
      return `| ${subj.label} (${domain}) | ${counts.join(' | ')} | ${subj.count} |`;
    });
  return [
    `# Fragmint — Table des matières (${data.total} fragments approuvés)`,
    '',
    header,
    sep,
    ...rows,
  ].join('\n');
}

export function renderMarkdown(data: IndexData): string {
  const d = new Date(data.generated_at);
  const dateStr = d.toLocaleDateString('fr-FR');
  const lines: string[] = [
    `# Fragmint Index — État au ${dateStr}`,
    '',
    `Last updated: ${data.generated_at}`,
    `Total fragments: ${data.total} (approved only)`,
    '',
    '---',
    '',
    '## Conventions',
    '',
    '- IDs : [PREFIX-TYPE-NUM] (ex: TM-arg-001 = Twake Mail, argument, #001)',
    '- Hiérarchie : subject → type → fragments',
    '- Métadonnées en ligne après le titre',
    '',
    '---',
    '',
  ];

  if (data.total === 0) {
    lines.push('*Aucun fragment approuvé pour le moment.*');
    return lines.join('\n');
  }

  for (const [domain, subj] of Object.entries(data.subjects).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    lines.push(`## Catégorie : ${subj.label} (${subj.count} fragments)`);
    lines.push('');
    for (const [type, frags] of Object.entries(subj.types).sort(([a], [b]) => a.localeCompare(b))) {
      lines.push(`### ${type.charAt(0).toUpperCase() + type.slice(1)} (${frags.length})`);
      lines.push('');
      for (const f of frags) {
        lines.push(`- **[${f.readable_id}]** ${f.title}`);
        const meta: string[] = [];
        meta.push(`\`type: ${type}\``);
        if (f.tags.length > 0) meta.push(`\`tags: ${f.tags.join(', ')}\``);
        meta.push(`\`lang: ${f.lang}\``);
        lines.push(`  - ${meta.join(' ')}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}
