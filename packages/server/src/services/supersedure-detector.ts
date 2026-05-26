import { randomUUID } from 'node:crypto';
import { eq, ne, and, isNull, or, inArray } from 'drizzle-orm';
import type { FragmintDb } from '../db/connection.js';
import {
  fragments,
  supersedureProposals,
  fragmentEntities,
  entities as entitiesTable,
} from '../db/schema.js';
import type { LlmClient } from './llm-client.js';

const JACCARD_THRESHOLD = 0.25;
const LLM_CONFIDENCE_MIN = 0.65;

const SYSTEM_PROMPT = `You are a document supersedure judge. Given two knowledge fragments A (older) and B (newer), decide whether B supersedes A.

Return ONLY valid JSON with no surrounding text:
{
  "recommendation": "SUPERSEDE" | "COEXIST" | "DIFFERENT_TOPIC",
  "confidence": <0.0-1.0>,
  "reasoning": "<one sentence>",
  "elements_lost_in_b": ["element1"] | null
}

- SUPERSEDE: B contains the same knowledge as A and is more complete or up to date. A should be deprecated.
- COEXIST: Both fragments contain useful, complementary knowledge. Keep both.
- DIFFERENT_TOPIC: The fragments are about different subjects despite surface similarity.
- elements_lost_in_b: important facts present in A but missing from B (only when SUPERSEDE).`;

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/\W+/)
      .filter((t) => t.length > 2),
  );
}

function jaccard(a: string, b: string): number {
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }
  return intersection / (setA.size + setB.size - intersection);
}

interface LlmJudgment {
  recommendation: 'SUPERSEDE' | 'COEXIST' | 'DIFFERENT_TOPIC';
  confidence: number;
  reasoning: string;
  elements_lost_in_b: string[] | null;
}

type FragmentRow = typeof fragments.$inferSelect;

async function loadEntityMeta(
  db: FragmintDb,
  fragmentId: string,
): Promise<{ entityNames: string[]; entityIds: number[] }> {
  const rows = await db
    .select({ id: entitiesTable.id, name: entitiesTable.canonicalName })
    .from(fragmentEntities)
    .innerJoin(entitiesTable, eq(entitiesTable.id, fragmentEntities.entity_id))
    .where(eq(fragmentEntities.fragment_id, fragmentId));
  return {
    entityNames: rows.map((r) => r.name),
    entityIds: rows.map((r) => r.id),
  };
}

function formatFragmentContext(
  frag: FragmentRow,
  entityNames: string[],
): string {
  const tags = frag.tags ? (JSON.parse(frag.tags) as string[]) : [];
  const lines = [
    `domain: ${frag.domain}`,
    `type: ${frag.type}`,
    `lang: ${frag.lang}`,
    frag.function_type ? `function_type: ${frag.function_type}` : null,
    frag.audience ? `audience: ${frag.audience}` : null,
    frag.maturity ? `maturity: ${frag.maturity}` : null,
    tags.length > 0 ? `tags: ${tags.join(', ')}` : null,
    entityNames.length > 0 ? `entities: ${entityNames.join(', ')}` : null,
  ]
    .filter(Boolean)
    .join('\n');
  return `${lines}\n\n${frag.body_excerpt ?? ''}`;
}

export async function detectAndPropose(
  newFragmentId: string,
  db: FragmintDb,
  llmClient: LlmClient,
): Promise<void> {
  const [newFrag] = await db
    .select()
    .from(fragments)
    .where(eq(fragments.id, newFragmentId))
    .limit(1);
  if (!newFrag || !newFrag.body_excerpt) return;

  const newEntityMeta = await loadEntityMeta(db, newFragmentId);

  const candidates = await db
    .select()
    .from(fragments)
    .where(
      and(
        ne(fragments.id, newFragmentId),
        eq(fragments.lang, newFrag.lang),
        eq(fragments.domain, newFrag.domain),
        eq(fragments.type, newFrag.type),
        or(eq(fragments.quality, 'reviewed'), eq(fragments.quality, 'approved')),
        isNull(fragments.superseded_by),
      ),
    )
    .limit(50);

  // Entity pre-filter: keep candidates that share at least one entity with the new fragment,
  // OR that have no entities at all (older fragments never had entity extraction — let Jaccard decide).
  // Candidates WITH entities but zero overlap are excluded (different-topic signal).
  let filteredCandidates = candidates;
  if (newEntityMeta.entityIds.length > 0 && candidates.length > 0) {
    const candidateIds = candidates.map((c) => c.id);

    const [sharedRows, anyEntityRows] = await Promise.all([
      db
        .select({ fragment_id: fragmentEntities.fragment_id })
        .from(fragmentEntities)
        .where(
          and(
            inArray(fragmentEntities.fragment_id, candidateIds),
            inArray(fragmentEntities.entity_id, newEntityMeta.entityIds),
          ),
        ),
      db
        .select({ fragment_id: fragmentEntities.fragment_id })
        .from(fragmentEntities)
        .where(inArray(fragmentEntities.fragment_id, candidateIds)),
    ]);

    const withShared = new Set(sharedRows.map((r) => r.fragment_id));
    const hasAnyEntities = new Set(anyEntityRows.map((r) => r.fragment_id));

    filteredCandidates = candidates.filter(
      (c) => withShared.has(c.id) || !hasAnyEntities.has(c.id),
    );
  }

  for (const candidate of filteredCandidates) {
    const oldBody = candidate.body_excerpt ?? '';
    if (!oldBody) continue;

    const score = jaccard(newFrag.body_excerpt, oldBody);
    if (score < JACCARD_THRESHOLD) continue;

    const existing = await db
      .select({ id: supersedureProposals.id })
      .from(supersedureProposals)
      .where(
        and(
          eq(supersedureProposals.newFragmentId, newFragmentId),
          eq(supersedureProposals.oldFragmentId, candidate.id),
          eq(supersedureProposals.status, 'pending'),
        ),
      )
      .limit(1);
    if (existing.length > 0) continue;

    const candidateEntityMeta = await loadEntityMeta(db, candidate.id);

    let judgment: LlmJudgment;
    try {
      const raw = await llmClient.chatMessages([
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Fragment A (older):\n${formatFragmentContext(candidate, candidateEntityMeta.entityNames)}\n\nFragment B (newer):\n${formatFragmentContext(newFrag, newEntityMeta.entityNames)}`,
        },
      ]);
      const parsed = JSON.parse(raw.trim()) as LlmJudgment;
      if (!parsed.recommendation || parsed.confidence === undefined) continue;
      judgment = parsed;
    } catch {
      continue;
    }

    if (judgment.recommendation !== 'SUPERSEDE') continue;
    if (judgment.confidence < LLM_CONFIDENCE_MIN) continue;

    await db.insert(supersedureProposals).values({
      id: randomUUID(),
      newFragmentId,
      oldFragmentId: candidate.id,
      similarityScore: score,
      llmJudgment: judgment.recommendation,
      llmConfidence: judgment.confidence,
      llmReasoning: judgment.reasoning ?? null,
      elementsLostInNew: judgment.elements_lost_in_b
        ? JSON.stringify(judgment.elements_lost_in_b)
        : null,
      status: 'pending',
      createdAt: new Date().toISOString(),
    });
  }
}
