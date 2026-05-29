import { randomUUID } from 'node:crypto';
import { eq, ne, and, isNull, or } from 'drizzle-orm';
import type { FragmintDb } from '../db/connection.js';
import { fragments, supersedureProposals } from '../db/schema.js';
import type { LlmClient } from './llm-client.js';
import { generateShingles, jaccardSimilarity } from './dedupe/shingles.js';

const JACCARD_THRESHOLD = 0.20;  // lowered from 0.25: shingles k=3 are more precise
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

interface LlmJudgment {
  recommendation: 'SUPERSEDE' | 'COEXIST' | 'DIFFERENT_TOPIC';
  confidence: number;
  reasoning: string;
  elements_lost_in_b: string[] | null;
}

type FragmentRow = typeof fragments.$inferSelect;

function formatFragmentContext(frag: FragmentRow): string {
  const tags = frag.tags ? (JSON.parse(frag.tags) as string[]) : [];
  const lines = [
    `domain: ${frag.domain}`,
    `type: ${frag.type}`,
    `lang: ${frag.lang}`,
    frag.function_type ? `function_type: ${frag.function_type}` : null,
    frag.audience ? `audience: ${frag.audience}` : null,
    frag.maturity ? `maturity: ${frag.maturity}` : null,
    tags.length > 0 ? `tags: ${tags.join(', ')}` : null,
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

  for (const candidate of candidates) {
    const oldBody = candidate.body_excerpt ?? '';
    if (!oldBody) continue;

    const score = jaccardSimilarity(
      generateShingles(newFrag.body_excerpt, 3),
      generateShingles(oldBody, 3),
    );
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

    let judgment: LlmJudgment;
    try {
      const raw = await llmClient.chatMessages([
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Fragment A (older):\n${formatFragmentContext(candidate)}\n\nFragment B (newer):\n${formatFragmentContext(newFrag)}`,
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
