/**
 * Junkiness filter for harvest candidates.
 *
 * A "junky" block is one that carries little reusable information:
 *   - Pure separator lines (---, ===, ............)
 *   - Very short fragments (< 30 chars)
 *   - TOC / annexe / page-number pages
 *   - Text dominated by separator characters (dots, dashes, underscores)
 *
 * junkinessScore() returns a 0-1 composite score (higher = more junky).
 * isJunky() returns true when score >= threshold (default 0.5).
 */

const MIN_CHARS = 30;
const SEP_CHAR_RATIO_THRESHOLD = 0.30; // fraction of text that is separator chars
const TOC_PATTERN = /table\s+des\s+mati[eè]res|table\s+of\s+contents|annexe\s+[a-z0-9]/i;
const SEPARATOR_LINE_PATTERN = /^[\s\-=_.+*#~^…]+$/;

/** Returns a 0-1 junkiness score for a text block. */
export function junkinessScore(text: string): number {
  const trimmed = text.trim();

  // Signal 1: length (short = junky)
  if (trimmed.length === 0) return 1;
  const lengthScore = trimmed.length < MIN_CHARS ? 1 - trimmed.length / MIN_CHARS : 0;

  // Signal 2: separator-character ratio (dots, dashes, etc.)
  const sepChars = (trimmed.match(/[-=_.+*#~^.…]/g) ?? []).length;
  const sepRatio = sepChars / trimmed.length;
  const sepScore = Math.min(1, sepRatio / SEP_CHAR_RATIO_THRESHOLD);

  // Signal 3: pure separator line (strongest individual signal)
  const isSepLine = SEPARATOR_LINE_PATTERN.test(trimmed) ? 1 : 0;

  // Signal 4: TOC / annexe pattern
  const isToc = TOC_PATTERN.test(trimmed) ? 1 : 0;

  // Composite: take max of strong signals or weighted sum
  // Pure separator line and TOC are definitive — use max to ensure they dominate
  const strongSignal = Math.max(isSepLine * 0.9, isToc * 0.7);
  if (strongSignal > 0) {
    // Blend strong signal with sep-char ratio for robustness
    return Math.min(1, strongSignal * 0.7 + sepScore * 0.3 + lengthScore * 0.1);
  }

  // Otherwise weighted average of length + sep-char signals
  // Weights chosen so that:
  //   - 5-char text ('Titre'): lengthScore≈0.83 → composite > 0.5
  //   - dot-leader line: sepScore=1.0 → composite > 0.4
  const composite = lengthScore * 0.65 + sepScore * 0.45;
  return Math.min(1, composite);
}

/** Returns true when the block's junkiness score meets or exceeds the threshold. */
export function isJunky(text: string, threshold = 0.5): boolean {
  return junkinessScore(text) >= threshold;
}
