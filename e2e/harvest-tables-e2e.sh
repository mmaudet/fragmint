#!/usr/bin/env bash
# =============================================================================
# Fragmint — Tabular Harvest E2E Test
# =============================================================================
# Tests the full table extraction flow during harvest:
#   1. Upload a real proposal docx with tables
#   2. Poll until job completes
#   3. Verify table candidates:
#        a. doc_position < 999999 (tables are NOT stuck at the end)
#        b. doc order respected (table position > LLM blocks in same section)
#        c. GFM totals captured (Détail trimestriel has ≥6 rows incl. Total HT/TVA/TTC)
#        d. lang is set (not empty)
#   4. Accept the "Détail trimestriel" table candidate
#   5. Verify the resulting fragment has payload_schema and payload set
#
# Prerequisites:
#   - Fragmint server running (default: http://localhost:3210)
#   - Admin user mmaudet with password fragmint-dev
#   - DOCX file at DOCX_PATH (default below)
#
# Usage:
#   ./e2e/harvest-tables-e2e.sh [BASE_URL] [COLLECTION] [DOCX_PATH]
#
# Example:
#   ./e2e/harvest-tables-e2e.sh http://localhost:3210 ira ./real_examples/proposal.docx
# =============================================================================

set -eo pipefail

BASE_URL="${1:-http://localhost:3210}"
COLLECTION="${2:-ira}"
DOCX_PATH="${3:-}"

# Try to find a docx if not provided
if [[ -z "$DOCX_PATH" ]]; then
  DOCX_PATH=$(find . -name "Proposition_G4T_EONA-X_18472.docx" 2>/dev/null | head -1)
fi

PASS_COUNT=0
FAIL_COUNT=0
RESULTS=()

pass() { PASS_COUNT=$((PASS_COUNT + 1)); RESULTS+=("[PASS] $1"); echo "[PASS] $1"; }
fail() { FAIL_COUNT=$((FAIL_COUNT + 1)); RESULTS+=("[FAIL] $1 — $2"); echo "[FAIL] $1 — $2"; }

api() {
  local method="$1" path="$2" token="${3:-}" data="${4:-}"
  local tmpfile; tmpfile=$(mktemp)
  local curl_args=(-s -w '\n%{http_code}' -X "$method" "${BASE_URL}${path}")
  [[ -n "$token" ]] && curl_args+=(-H "Authorization: Bearer $token")
  [[ -n "$data" ]] && curl_args+=(-H "Content-Type: application/json" -d "$data")
  local response; response=$(curl "${curl_args[@]}")
  HTTP_CODE=$(echo "$response" | tail -1)
  BODY=$(echo "$response" | sed '$d')
}

json_val() {
  echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print($1)" 2>/dev/null || echo ""
}

poll_job() {
  local job_id="$1" token="$2" max_wait="${3:-300}" interval=5
  local elapsed=0
  while [[ $elapsed -lt $max_wait ]]; do
    api GET "/v1/${COLLECTION}/harvest/${job_id}" "$token"
    local status; status=$(json_val "d['data']['status']")
    if [[ "$status" == "completed" || "$status" == "failed" ]]; then
      echo "$status"
      return
    fi
    sleep $interval
    elapsed=$((elapsed + interval))
    echo "  ... waiting for job ($elapsed s, status=$status)" >&2
  done
  echo "timeout"
}

# =============================================================================
echo "============================================="
echo "  Fragmint Tabular Harvest E2E"
echo "  Server : $BASE_URL"
echo "  Collection : $COLLECTION"
echo "  Docx : $DOCX_PATH"
echo "============================================="
echo ""

# ── 1. Prerequisites ──────────────────────────────────────────────────────────
echo "--- 1. Prerequisites ---"

if [[ -z "$DOCX_PATH" || ! -f "$DOCX_PATH" ]]; then
  fail "DOCX file exists" "Not found: '$DOCX_PATH'. Pass path as 3rd argument."
  echo ""
  echo "SUMMARY: 0 passed / 1 failed — aborting."
  exit 1
fi
pass "DOCX file exists: $(basename "$DOCX_PATH")"

# ── 2. Authenticate ───────────────────────────────────────────────────────────
echo ""
echo "--- 2. Authenticate ---"
api POST /v1/auth/login "" '{"username":"mmaudet","password":"fragmint-dev"}'
if [[ "$HTTP_CODE" != "200" ]]; then
  fail "Admin login" "HTTP $HTTP_CODE"
  exit 1
fi
TOKEN=$(json_val "d['data']['token']")
if [[ -z "$TOKEN" || "$TOKEN" == "None" ]]; then
  fail "Admin login" "no token in response"
  exit 1
fi
pass "Admin login"

# ── 3. Upload docx and start harvest ─────────────────────────────────────────
echo ""
echo "--- 3. Upload docx for harvest ---"
UPLOAD_RESP=$(curl -s -w '\n%{http_code}' \
  -X POST "${BASE_URL}/v1/${COLLECTION}/harvest" \
  -H "Authorization: Bearer $TOKEN" \
  -F "files=@${DOCX_PATH};filename=$(basename "$DOCX_PATH")")
UPLOAD_CODE=$(echo "$UPLOAD_RESP" | tail -1)
BODY=$(echo "$UPLOAD_RESP" | sed '$d')

if [[ "$UPLOAD_CODE" != "200" && "$UPLOAD_CODE" != "202" ]]; then
  fail "POST /harvest" "HTTP $UPLOAD_CODE — $BODY"
  exit 1
fi
JOB_ID=$(json_val "d['data']['id']")
if [[ -z "$JOB_ID" || "$JOB_ID" == "None" ]]; then
  fail "POST /harvest" "no job id in response — $BODY"
  exit 1
fi
pass "Harvest job created: $JOB_ID"

# ── 4. Poll until complete ────────────────────────────────────────────────────
echo ""
echo "--- 4. Poll harvest job (up to 5 min) ---"
FINAL_STATUS=$(poll_job "$JOB_ID" "$TOKEN" 300)
if [[ "$FINAL_STATUS" == "completed" ]]; then
  pass "Harvest job completed"
elif [[ "$FINAL_STATUS" == "failed" ]]; then
  api GET "/v1/${COLLECTION}/harvest/${JOB_ID}" "$TOKEN"
  ERR=$(json_val "d['data']['error']" 2>/dev/null || echo "")
  fail "Harvest job completed" "status=failed — $ERR"
  exit 1
else
  fail "Harvest job completed" "timeout after 300s"
  exit 1
fi

# Fetch candidates
api GET "/v1/${COLLECTION}/harvest/${JOB_ID}" "$TOKEN"
CANDIDATES_JSON=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps(d['data']['candidates']))" 2>/dev/null)
TOTAL_CANDIDATES=$(echo "$CANDIDATES_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d))" 2>/dev/null)

# ── 5. Verify table candidates ───────────────────────────────────────────────
echo ""
echo "--- 5. Verify table candidates (total=$TOTAL_CANDIDATES) ---"

# 5a. At least one table candidate exists
TABLE_COUNT=$(echo "$CANDIDATES_JSON" | python3 -c "
import sys,json
d=json.load(sys.stdin)
print(sum(1 for c in d if c.get('payload_schema')))
" 2>/dev/null)
if [[ "$TABLE_COUNT" -ge 1 ]]; then
  pass "Table candidates found: $TABLE_COUNT"
else
  fail "Table candidates found" "0 candidates with payload_schema"
fi

# 5b. No table candidate has doc_position = 999999
BAD_ORDER=$(echo "$CANDIDATES_JSON" | python3 -c "
import sys,json
d=json.load(sys.stdin)
bad=[c['title'] for c in d if c.get('payload_schema') and c.get('doc_position')==999999]
print(len(bad), '|', ', '.join(bad))
" 2>/dev/null)
BAD_COUNT=$(echo "$BAD_ORDER" | cut -d'|' -f1 | tr -d ' ')
BAD_TITLES=$(echo "$BAD_ORDER" | cut -d'|' -f2)
if [[ "$BAD_COUNT" == "0" ]]; then
  pass "No table candidate stuck at doc_position=999999"
else
  fail "No table candidate stuck at doc_position=999999" "$BAD_COUNT tables at 999999: $BAD_TITLES"
fi

# 5c. Table candidates appear after LLM blocks from the same section
# Heuristic: for each table, find LLM blocks from same source_section;
# table doc_position should be > all of theirs.
SECTION_ORDER=$(echo "$CANDIDATES_JSON" | python3 -c "
import sys,json
d=json.load(sys.stdin)
tables=[c for c in d if c.get('payload_schema') and c.get('doc_position',999999)<999999]
violations=[]
for t in tables:
    section=t.get('source_section','')
    tpos=t['doc_position']
    siblings=[c for c in d if not c.get('payload_schema') and c.get('source_section','')==section]
    for s in siblings:
        spos=s.get('doc_position')
        if spos is not None and spos >= tpos:
            violations.append(f'{t[\"title\"]} (pos={tpos}) <= LLM {s[\"title\"]} (pos={spos})')
print(len(violations), '|', '; '.join(violations[:3]))
" 2>/dev/null)
VIOL_COUNT=$(echo "$SECTION_ORDER" | cut -d'|' -f1 | tr -d ' ')
VIOL_DETAIL=$(echo "$SECTION_ORDER" | cut -d'|' -f2)
if [[ "$VIOL_COUNT" == "0" ]]; then
  pass "Table candidates appear after LLM blocks in same section"
else
  fail "Table doc_position order" "$VIOL_COUNT violations: $VIOL_DETAIL"
fi

# 5d. lang is set on table candidates
EMPTY_LANG=$(echo "$CANDIDATES_JSON" | python3 -c "
import sys,json
d=json.load(sys.stdin)
bad=[c['title'] for c in d if c.get('payload_schema') and not c.get('lang','').strip()]
print(len(bad), '|', ', '.join(bad))
" 2>/dev/null)
EMPTY_LANG_COUNT=$(echo "$EMPTY_LANG" | cut -d'|' -f1 | tr -d ' ')
if [[ "$EMPTY_LANG_COUNT" == "0" ]]; then
  pass "All table candidates have lang set"
else
  fail "All table candidates have lang set" "$EMPTY_LANG_COUNT without lang: $(echo "$EMPTY_LANG" | cut -d'|' -f2)"
fi

# 5e. GFM totals: pricing tables should have rows beyond the data rows.
# "Détail trimestriel" in the EONA-X proposal has 7 data rows + 3 total rows = ≥8 rows.
DETAIL_ROWS=$(echo "$CANDIDATES_JSON" | python3 -c "
import sys,json
d=json.load(sys.stdin)
detail=[c for c in d if 'trimestriel' in c.get('title','').lower() and c.get('payload_schema')]
if not detail:
    print(-1)
else:
    import json as j
    rows=j.loads(detail[0].get('payload','[]'))
    print(len(rows))
" 2>/dev/null)
if [[ "$DETAIL_ROWS" == "-1" ]]; then
  fail "Détail trimestriel table found" "no candidate with 'trimestriel' in title"
elif [[ "$DETAIL_ROWS" -ge 8 ]]; then
  pass "Détail trimestriel has ≥8 rows (data + totals): $DETAIL_ROWS rows"
elif [[ "$DETAIL_ROWS" -ge 1 ]]; then
  fail "Détail trimestriel has ≥8 rows (data + totals)" "only $DETAIL_ROWS rows — total rows may be missing"
else
  fail "Détail trimestriel payload parsed" "empty payload"
fi

# ── 6. Accept the Détail trimestriel candidate and verify fragment ────────────
echo ""
echo "--- 6. Accept table candidate → fragment ---"
DETAIL_ID=$(echo "$CANDIDATES_JSON" | python3 -c "
import sys,json
d=json.load(sys.stdin)
matches=[c for c in d if 'trimestriel' in c.get('title','').lower() and c.get('payload_schema')]
print(matches[0]['id'] if matches else '')
" 2>/dev/null)

if [[ -z "$DETAIL_ID" || "$DETAIL_ID" == "None" ]]; then
  fail "Accept Détail trimestriel" "candidate not found — skipping"
else
  api POST "/v1/${COLLECTION}/harvest/${JOB_ID}/candidates/${DETAIL_ID}/accept" "$TOKEN"
  if [[ "$HTTP_CODE" == "200" || "$HTTP_CODE" == "201" ]]; then
    FRAGMENT_ID=$(json_val "d['data']['id']" 2>/dev/null || echo "")
    if [[ -n "$FRAGMENT_ID" && "$FRAGMENT_ID" != "None" ]]; then
      pass "Candidate accepted → fragment $FRAGMENT_ID"

      # Verify fragment has payload_schema
      api GET "/v1/${COLLECTION}/fragments/${FRAGMENT_ID}" "$TOKEN"
      FRAG_SCHEMA=$(json_val "d['data']['payload_schema']" 2>/dev/null || echo "")
      FRAG_PAYLOAD=$(json_val "d['data']['payload']" 2>/dev/null || echo "")
      if [[ -n "$FRAG_SCHEMA" && "$FRAG_SCHEMA" != "None" ]]; then
        pass "Fragment has payload_schema: $FRAG_SCHEMA"
      else
        fail "Fragment has payload_schema" "payload_schema is empty"
      fi
      if [[ -n "$FRAG_PAYLOAD" && "$FRAG_PAYLOAD" != "None" && "$FRAG_PAYLOAD" != "null" ]]; then
        FRAG_ROW_COUNT=$(echo "$FRAG_PAYLOAD" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
        pass "Fragment has payload ($FRAG_ROW_COUNT rows)"
      else
        fail "Fragment has payload" "payload is empty or null"
      fi

      # Verify fragment is findable via payload_schema filter
      api GET "/v1/${COLLECTION}/fragments?payload_schema=${FRAG_SCHEMA}&limit=5" "$TOKEN"
      FILTER_COUNT=$(json_val "d['meta']['count']" 2>/dev/null || echo "0")
      if [[ "$FILTER_COUNT" -ge 1 ]]; then
        pass "Fragment findable via ?payload_schema=$FRAG_SCHEMA (count=$FILTER_COUNT)"
      else
        fail "Fragment findable via payload_schema filter" "count=0"
      fi
    else
      fail "Accept Détail trimestriel" "no fragment id in response — $BODY"
    fi
  else
    fail "Accept Détail trimestriel" "HTTP $HTTP_CODE — $BODY"
  fi
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "============================================="
echo "  SUMMARY: $PASS_COUNT passed / $FAIL_COUNT failed"
echo "============================================="
for r in "${RESULTS[@]}"; do echo "  $r"; done
echo ""
[[ $FAIL_COUNT -eq 0 ]] && exit 0 || exit 1
