import { like } from 'drizzle-orm';
import type { FragmintDb } from '../db/connection.js';
import { fragments } from '../db/schema.js';

export const SUBJECT_ABBR: Record<string, string> = {
  linshare: 'LS',
  'twake-mail': 'TM',
  'twake-calendar': 'TC',
  'twake-drive': 'TD',
  'twake-chat': 'TCH',
  lincloud: 'LC',
  linto: 'LT',
  openrag: 'OR',
  'linagora-corp': 'LIN',
};

export const TYPE_ABBR: Record<string, string> = {
  reference: 'ref',
  argument: 'arg',
  'use-case': 'uc',
  description: 'desc',
  pricing: 'pri',
  clause: 'cla',
  faq: 'faq',
  introduction: 'intro',
  engagement: 'eng',
  methodology: 'meth',
  bio: 'bio',
  temoignage: 'temo',
  conclusion: 'conc',
};

function domainAbbr(domain: string): string {
  return SUBJECT_ABBR[domain] ?? domain.replace(/-/g, '').slice(0, 3).toUpperCase();
}

function typeAbbr(type: string): string {
  return TYPE_ABBR[type] ?? type.slice(0, 3).toLowerCase();
}

/**
 * Génère un readable_id unique et monotone croissant pour un fragment.
 * Format : {DOMAIN_ABBR}-{TYPE_ABBR}-{NNN}  ex: LS-ref-003
 * Utilise LIKE pour trouver le MAX numéro existant pour ce (domain, type).
 */
export async function generateReadableId(
  db: FragmintDb,
  domain: string,
  type: string,
): Promise<string> {
  const da = domainAbbr(domain);
  const ta = typeAbbr(type);
  const prefix = `${da}-${ta}-`;

  const rows = await db
    .select({ readable_id: fragments.readable_id })
    .from(fragments)
    .where(like(fragments.readable_id, `${prefix}%`));

  let maxNum = 0;
  for (const row of rows) {
    if (row.readable_id) {
      const match = row.readable_id.match(/-(\d+)$/);
      if (match) maxNum = Math.max(maxNum, parseInt(match[1], 10));
    }
  }

  return `${prefix}${String(maxNum + 1).padStart(3, '0')}`;
}
