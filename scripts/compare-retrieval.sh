#!/usr/bin/env bash
# compare-retrieval.sh — compare vector-only vs hybrid(RRF) on a test plan
# Usage: ./scripts/compare-retrieval.sh [BASE_URL]
# Default BASE_URL: http://localhost:3333
# Requires: curl, jq

set -euo pipefail

BASE="${1:-http://localhost:3210}"
echo "=== Fragmint retrieval comparison ==="
echo "Server: $BASE"
echo ""

# ── 1. Login ──────────────────────────────────────────────────────────────────
echo "→ Logging in as mmaudet..."
LOGIN=$(curl -sf -X POST "$BASE/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"mmaudet","password":"fragmint-dev"}')
TOKEN=$(echo "$LOGIN" | jq -r '.data.token')
if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
  echo "ERROR: login failed. Is the server running at $BASE?"
  exit 1
fi
echo "✓ Token obtained"

auth() { echo "Authorization: Bearer $TOKEN"; }

# ── 2. Create a test plan ─────────────────────────────────────────────────────
echo ""
echo "→ Creating test plan..."
PLAN=$(curl -sf -X POST "$BASE/v1/plans" \
  -H "Content-Type: application/json" \
  -H "$(auth)" \
  -d '{
    "spec_prompt": "Proposition commerciale LinShare pour une collectivité locale. Inclure présentation produit, arguments différenciants, cas usage, références clients.",
    "filters": {"lang": "fr"}
  }')
PLAN_ID=$(echo "$PLAN" | jq -r '.data.id')
echo "✓ Plan created: $PLAN_ID"

# ── 3. Generate plan sections (LLM) ──────────────────────────────────────────
echo ""
echo "→ Generating plan structure (LLM)..."
GEN=$(curl -sf -X POST "$BASE/v1/plans/$PLAN_ID/generate-plan" \
  -H "Content-Type: application/json" \
  -H "$(auth)" \
  -d '{}')
echo "✓ Plan generated"
echo "  Plan markdown (first 300 chars):"
echo "$GEN" | tr -d '\000-\010\013-\037' | jq -r '.data.state.plan_markdown // "(none)"' 2>/dev/null | head -c 300 || echo "(could not parse markdown)"
echo ""

# ── 4. Validate in vector-only mode ──────────────────────────────────────────
echo ""
echo "→ Switching to vector-only mode..."
curl -sf -X POST "$BASE/v1/admin/retrieval/mode" \
  -H "Content-Type: application/json" \
  -H "$(auth)" \
  -d '{"mode":"vector-only"}' > /dev/null
echo "✓ Mode: vector-only"

echo "→ Validating plan (vector-only)..."
RESULT_VECTOR=$(curl -sf -X POST "$BASE/v1/plans/$PLAN_ID/validate-plan" \
  -H "Content-Type: application/json" \
  -H "$(auth)" \
  -d '{}')

echo ""
echo "══════════════════════════════════════════════════"
echo "  RESULTS — vector-only"
echo "══════════════════════════════════════════════════"
echo "$RESULT_VECTOR" | jq -r '
  .data.state.sections[] |
  "SECTION: \(.title)\n" +
  (
    .candidates[:5] | to_entries[] |
    "  \(.key+1). score=\(.value.score // "null") | \(.value.title // "(no title)") [\(.value.quality)]"
  )
'

# ── 5. Validate in hybrid mode ────────────────────────────────────────────────
echo ""
echo "→ Switching to hybrid (RRF) mode..."
curl -sf -X POST "$BASE/v1/admin/retrieval/mode" \
  -H "Content-Type: application/json" \
  -H "$(auth)" \
  -d '{"mode":"hybrid"}' > /dev/null
echo "✓ Mode: hybrid"

echo "→ Re-validating plan (hybrid/RRF)..."
RESULT_HYBRID=$(curl -sf -X POST "$BASE/v1/plans/$PLAN_ID/validate-plan" \
  -H "Content-Type: application/json" \
  -H "$(auth)" \
  -d '{}')

echo ""
echo "══════════════════════════════════════════════════"
echo "  RESULTS — hybrid (RRF)"
echo "══════════════════════════════════════════════════"
echo "$RESULT_HYBRID" | jq -r '
  .data.state.sections[] |
  "SECTION: \(.title)\n" +
  (
    .candidates[:5] | to_entries[] |
    "  \(.key+1). score=\(.value.score // "null") | method=\(.value.score_breakdown.method // "?") | \(.value.title // "(no title)") [\(.value.quality)]"
  )
'

# ── 6. Side-by-side diff per section ─────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════════"
echo "  SIDE-BY-SIDE — #1 candidates per section"
echo "══════════════════════════════════════════════════"
echo ""

SECTIONS_VECTOR=$(echo "$RESULT_VECTOR" | jq -c '.data.state.sections[]')
SECTIONS_HYBRID=$(echo "$RESULT_HYBRID" | jq -c '.data.state.sections[]')

paste \
  <(echo "$SECTIONS_VECTOR" | jq -r '"[\(.title)] #1 (vector): \(.candidates[0].title // "none") (score=\(.candidates[0].score // "null"))"') \
  <(echo "$SECTIONS_HYBRID" | jq -r '"[\(.title)] #1 (hybrid): \(.candidates[0].title // "none") (score=\(.candidates[0].score // "null"))"') \
  | sed 's/\t/\n    vs /g'

# ── 7. Reset to vector-only ───────────────────────────────────────────────────
echo ""
echo "→ Resetting to vector-only mode..."
curl -sf -X POST "$BASE/v1/admin/retrieval/mode" \
  -H "Content-Type: application/json" \
  -H "$(auth)" \
  -d '{"mode":"vector-only"}' > /dev/null
echo "✓ Reset"

echo ""
echo "→ Plan ID for further inspection: $PLAN_ID"
echo "  UI: http://localhost:5173 → Plans → $PLAN_ID"
echo ""
echo "=== Done. Review the two result blocks above and tally which #1 is more relevant per section. ==="
