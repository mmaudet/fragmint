// packages/server/src/services/index-service.ts
import { eq, inArray, and, type SQL } from 'drizzle-orm';
import type { FragmintDb } from '../db/connection.js';
import { fragments, entities, fragmentEntities } from '../db/schema.js';

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
  entities: string[];
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
  try { return JSON.parse(value) as string[]; } catch { return []; }
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

    const entityMap = await this.loadEntities(rows.map((r) => r.id));
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
        readable_id: '',
        id: row.id,
        title: row.title ?? row.id,
        lang: row.lang,
        tags: parseJsonArray(row.tags),
        entities: entityMap.get(row.id) ?? [],
      });
      subjects[domain].count++;
    }

    for (const [domain, subjectData] of Object.entries(subjects)) {
      const prefix = subjectPrefix(domain);
      for (const [type, frags] of Object.entries(subjectData.types)) {
        frags.sort((a, b) => a.title.localeCompare(b.title));
        const short = typeShort(type);
        frags.forEach((f, i) => {
          f.readable_id = `${prefix}-${short}-${String(i + 1).padStart(3, '0')}`;
        });
      }
    }

    return { generated_at: new Date().toISOString(), total: rows.length, subjects };
  }

  private async loadEntities(fragmentIds: string[]): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    if (fragmentIds.length === 0) return map;

    const rows = await this.db
      .select({
        fragment_id: fragmentEntities.fragment_id,
        name: entities.canonicalName,
      })
      .from(fragmentEntities)
      .innerJoin(entities, eq(entities.id, fragmentEntities.entity_id))
      .where(inArray(fragmentEntities.fragment_id, fragmentIds));

    for (const row of rows) {
      const list = map.get(row.fragment_id) ?? [];
      list.push(row.name);
      map.set(row.fragment_id, list);
    }
    return map;
  }
}

function renderMarkdown(data: IndexData): string {
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

  for (const [domain, subj] of Object.entries(data.subjects).sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`## Catégorie : ${subj.label} (${subj.count} fragments)`);
    lines.push('');
    for (const [type, frags] of Object.entries(subj.types).sort(([a], [b]) => a.localeCompare(b))) {
      lines.push(`### ${type.charAt(0).toUpperCase() + type.slice(1)} (${frags.length})`);
      lines.push('');
      for (const f of frags) {
        lines.push(`- **[${f.readable_id}]** ${f.title}`);
        const meta: string[] = [];
        if (f.entities.length > 0) meta.push(`\`entities: ${f.entities.join(', ')}\``);
        if (f.tags.length > 0) meta.push(`\`tags: ${f.tags.join(', ')}\``);
        meta.push(`\`lang: ${f.lang}\``);
        lines.push(`  - ${meta.join(' ')}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}
