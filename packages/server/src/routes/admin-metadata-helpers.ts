import { eq, like, count } from 'drizzle-orm';
import type { FragmintDb } from '../db/connection.js';
import { fragments, fragmentTags, fragmentDomains } from '../db/schema.js';

function similarityRatio(a: string, b: string): number {
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  if (longer.length === 0) return 1.0;
  const mat = Array.from({ length: shorter.length + 1 }, (_, j) =>
    Array.from({ length: longer.length + 1 }, (_, i) => (j === 0 ? i : i === 0 ? j : 0)),
  );
  for (let j = 1; j <= shorter.length; j++)
    for (let i = 1; i <= longer.length; i++)
      mat[j][i] =
        longer[i - 1] === shorter[j - 1]
          ? mat[j - 1][i - 1]
          : Math.min(mat[j][i - 1] + 1, mat[j - 1][i] + 1, mat[j - 1][i - 1] + 1);
  return (longer.length - mat[shorter.length][longer.length]) / longer.length;
}

function truncateAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 20 ? cut.slice(0, lastSpace) : cut) + '…';
}

export async function getPreviewForTag(db: FragmintDb, slug: string): Promise<string> {
  const [row] = await db
    .select({ bodyExcerpt: fragments.body_excerpt })
    .from(fragments)
    .where(like(fragments.tags, `%"${slug}"%`))
    .limit(1);
  return truncateAtWord(row?.bodyExcerpt ?? '', 200);
}

export async function computeFlagsForTag(
  db: FragmintDb,
  tag: { slug: string; usageCount: number; label: string },
  cachedValidatedTags?: Array<{ slug: string; label: string }>,
): Promise<any[]> {
  const flags = [];
  if ((tag.usageCount ?? 0) < 3) flags.push({ type: 'info', label: 'Low usage' });
  const validatedTags =
    cachedValidatedTags ??
    (await db
      .select({ slug: fragmentTags.slug, label: fragmentTags.label })
      .from(fragmentTags)
      .where(eq(fragmentTags.validated, 1)));
  for (const vt of validatedTags) {
    const vtNorm = vt.slug.replace(/^NEW:/i, '');
    if (vtNorm === tag.slug) continue;
    if (similarityRatio(tag.slug, vtNorm) > 0.7) {
      flags.push({ type: 'info', label: `Similar to ${vtNorm}`, merge_target: vtNorm });
      break;
    }
  }
  return flags;
}

export async function computeCounts(db: FragmintDb) {
  const [tagCount, domainCount] = await Promise.all([
    db.select({ value: count() }).from(fragmentTags).where(eq(fragmentTags.validated, 0)),
    db.select({ value: count() }).from(fragmentDomains).where(eq(fragmentDomains.validated, 0)),
  ]);
  return {
    tags: tagCount[0]?.value ?? 0,
    domains: domainCount[0]?.value ?? 0,
  };
}
