#!/usr/bin/env bash
# =============================================================================
# Fragmint Tabular Fragments E2E Test
# =============================================================================
# Tests the full fragment-collections (tabular fragments) workflow including:
#   - Authentication
#   - CRUD on /v1/fragment-collections
#   - MCP-relevant payload_schema filter on /v1/fragments
#
# Prerequisites:
#   - Fragmint server running on BASE_URL (default: http://localhost:3737)
#   - Admin user mmaudet with password fragmint-dev (dev mode defaults)
#
# Usage:
#   ./e2e/tabular-fragments-e2e.sh [BASE_URL]
# =============================================================================

set -eo pipefail

BASE_URL="${1:-http://localhost:3737}"
PASS_COUNT=0
FAIL_COUNT=0
RESULTS=()

# ── Helpers ──────────────────────────────────────────────────────────────────

pass() {
  PASS_COUNT=$((PASS_COUNT + 1))
  RESULTS+=("[PASS] $1")
  echo "[PASS] $1"
}

fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  RESULTS+=("[FAIL] $1 — $2")
  echo "[FAIL] $1 — $2"
}

skip() {
  RESULTS+=("[SKIP] $1 — $2")
  echo "[SKIP] $1 — $2"
}

# Perform a curl request and return the body. Sets HTTP_CODE as a side effect.
api() {
  local method="$1"
  local path="$2"
  local token="${3:-}"
  local data="${4:-}"
  local tmpfile
  tmpfile=$(mktemp)

  local curl_args=(-s -w '\n%{http_code}' -X "$method" "${BASE_URL}${path}")
  if [[ -n "$token" ]]; then
    curl_args+=(-H "Authorization: Bearer $token")
  fi
  if [[ -n "$data" ]]; then
    curl_args+=(-H "Content-Type: application/json" -d "$data")
  fi

  local response
  response=$(curl "${curl_args[@]}")

  HTTP_CODE=$(echo "$response" | tail -1)
  BODY=$(echo "$response" | sed '$d')
}

json_val() {
  echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print($1)" 2>/dev/null || echo ""
}

# ── Test execution ───────────────────────────────────────────────────────────

echo "============================================="
echo "  Fragmint Tabular Fragments E2E Test"
echo "  Server: $BASE_URL"
echo "============================================="
echo ""

# ─── 1. Login admin (mmaudet) ───────────────────────────────────────────────
echo "--- 1. Login admin (mmaudet) ---"
api POST /v1/auth/login "" '{"username":"mmaudet","password":"fragmint-dev"}'
if [[ "$HTTP_CODE" == "200" ]]; then
  ADMIN_TOKEN=$(json_val "d['data']['token']")
  if [[ -n "$ADMIN_TOKEN" && "$ADMIN_TOKEN" != "None" ]]; then
    pass "Admin login"
  else
    fail "Admin login" "No token in response"
    echo "Response: $BODY"
    echo ""
    echo "Cannot continue without a valid admin token."
    exit 1
  fi
else
  fail "Admin login" "HTTP $HTTP_CODE"
  echo "Response: $BODY"
  echo ""
  echo "Cannot continue without a valid admin token."
  exit 1
fi

# ─── 2. Harvest test — DOCX upload ──────────────────────────────────────────
echo "--- 2. Harvest test (DOCX upload) ---"
# We skip harvest since creating a DOCX from bash requires external tooling
# (e.g. pandoc + LibreOffice), which may not be available in CI environments.
# The harvest pipeline is already covered by multi-format-e2e.sh.
skip "Harvest DOCX upload" "Creating a DOCX in bash requires pandoc/LibreOffice — use multi-format-e2e.sh for harvest coverage"

# ─── 3. GET /v1/fragment-collections — baseline list ────────────────────────
echo "--- 3. GET /v1/fragment-collections (baseline) ---"
api GET /v1/fragment-collections "$ADMIN_TOKEN"
if [[ "$HTTP_CODE" == "200" ]]; then
  INITIAL_COUNT=$(json_val "d['meta']['count']")
  pass "GET /v1/fragment-collections returns 200 (initial count=$INITIAL_COUNT)"
else
  fail "GET /v1/fragment-collections" "HTTP $HTTP_CODE — $BODY"
fi

# ─── 4. POST /v1/fragment-collections — create test collection ──────────────
echo "--- 4. POST /v1/fragment-collections ---"
api POST /v1/fragment-collections "$ADMIN_TOKEN" '{"title":"Test SLA E2E","payloadSchema":"sla-row-v1","memberIds":[]}'
if [[ "$HTTP_CODE" == "201" ]]; then
  COLLECTION_ID=$(json_val "d['data']['id']")
  if [[ "$COLLECTION_ID" == fc_* ]]; then
    pass "POST /v1/fragment-collections returns 201 with id=$COLLECTION_ID"
  else
    fail "POST /v1/fragment-collections" "id does not start with 'fc_': $COLLECTION_ID"
  fi
else
  fail "POST /v1/fragment-collections" "HTTP $HTTP_CODE — $BODY"
fi

# ─── 5. GET /v1/fragment-collections/:id — fetch created collection ─────────
echo "--- 5. GET /v1/fragment-collections/:id ---"
if [[ -n "$COLLECTION_ID" && "$COLLECTION_ID" != "None" ]]; then
  api GET "/v1/fragment-collections/$COLLECTION_ID" "$ADMIN_TOKEN"
  if [[ "$HTTP_CODE" == "200" ]]; then
    FETCHED_TITLE=$(json_val "d['data']['title']")
    FETCHED_SCHEMA=$(json_val "d['data']['payload_schema']")
    if [[ "$FETCHED_TITLE" == "Test SLA E2E" ]]; then
      pass "GET /v1/fragment-collections/:id returns correct title"
    else
      fail "GET /v1/fragment-collections/:id" "Expected title 'Test SLA E2E', got '$FETCHED_TITLE'"
    fi
    if [[ "$FETCHED_SCHEMA" == "sla-row-v1" ]]; then
      pass "GET /v1/fragment-collections/:id returns correct payload_schema"
    else
      fail "GET /v1/fragment-collections/:id payload_schema" "Expected 'sla-row-v1', got '$FETCHED_SCHEMA'"
    fi
  else
    fail "GET /v1/fragment-collections/:id" "HTTP $HTTP_CODE — $BODY"
  fi
else
  fail "GET /v1/fragment-collections/:id" "No collection_id from step 4"
fi

# ─── 6. GET /v1/fragment-collections?limit=5 — paginated list ───────────────
echo "--- 6. GET /v1/fragment-collections?limit=5 ---"
api GET "/v1/fragment-collections?limit=5" "$ADMIN_TOKEN"
if [[ "$HTTP_CODE" == "200" ]]; then
  LIST_COUNT=$(json_val "d['meta']['count']")
  # Verify the created collection appears in the list
  HAS_CREATED=$(echo "$BODY" | python3 -c "
import sys, json
data = json.load(sys.stdin)['data']
ids = [c['id'] for c in data]
print('yes' if '$COLLECTION_ID' in ids else 'no')
" 2>/dev/null || echo "error")
  if [[ "$HAS_CREATED" == "yes" ]]; then
    pass "GET /v1/fragment-collections?limit=5 returns list with created collection (count=$LIST_COUNT)"
  else
    # The limit might cut it off if there are many collections; check count is bounded
    if [[ "$LIST_COUNT" -le 5 ]]; then
      pass "GET /v1/fragment-collections?limit=5 respects limit (count=$LIST_COUNT)"
    else
      fail "GET /v1/fragment-collections?limit=5" "count=$LIST_COUNT exceeds limit=5"
    fi
  fi
else
  fail "GET /v1/fragment-collections?limit=5" "HTTP $HTTP_CODE — $BODY"
fi

# ─── 7. DELETE /v1/fragment-collections/:id ─────────────────────────────────
echo "--- 7. DELETE /v1/fragment-collections/:id ---"
if [[ -n "$COLLECTION_ID" && "$COLLECTION_ID" != "None" ]]; then
  api DELETE "/v1/fragment-collections/$COLLECTION_ID" "$ADMIN_TOKEN"
  # Route returns 200 with { data: { id }, meta: null, error: null }
  if [[ "$HTTP_CODE" == "200" || "$HTTP_CODE" == "204" ]]; then
    pass "DELETE /v1/fragment-collections/:id returns $HTTP_CODE"
  else
    fail "DELETE /v1/fragment-collections/:id" "HTTP $HTTP_CODE — $BODY"
  fi
else
  fail "DELETE /v1/fragment-collections/:id" "No collection_id from step 4"
fi

# ─── 8. GET /v1/fragment-collections/:id — verify 404 after delete ──────────
echo "--- 8. GET /v1/fragment-collections/:id (after delete) ---"
if [[ -n "$COLLECTION_ID" && "$COLLECTION_ID" != "None" ]]; then
  api GET "/v1/fragment-collections/$COLLECTION_ID" "$ADMIN_TOKEN"
  if [[ "$HTTP_CODE" == "404" ]]; then
    pass "GET /v1/fragment-collections/:id returns 404 after delete"
  else
    fail "GET /v1/fragment-collections/:id after delete" "Expected 404, got HTTP $HTTP_CODE"
  fi
else
  fail "GET /v1/fragment-collections/:id after delete" "No collection_id from step 4"
fi

# ─── 9. GET /v1/fragments?payload_schema=sla-row-v1 — MCP filter ────────────
echo "--- 9. GET /v1/fragments?payload_schema=sla-row-v1 ---"
# NOTE: The payload_schema query param is used by the MCP tool search_fragments_by_payload.
# If the route schema has additionalProperties:false (Fastify may reject it with 400),
# this test will flag it as a known limitation rather than a hard fail.
api GET "/v1/fragments?payload_schema=sla-row-v1" "$ADMIN_TOKEN"
if [[ "$HTTP_CODE" == "200" ]]; then
  PAYLOAD_COUNT=$(json_val "d['meta']['count']")
  pass "GET /v1/fragments?payload_schema=sla-row-v1 returns 200 (count=$PAYLOAD_COUNT, may be 0 in empty corpus)"
elif [[ "$HTTP_CODE" == "400" ]]; then
  # payload_schema is not in the GET /v1/fragments schema (additionalProperties:false).
  # This is a known gap — the MCP tool search_fragments_by_payload calls this endpoint but
  # the Fastify route schema doesn't expose the param. Needs to be added to fragment-routes.ts.
  fail "GET /v1/fragments?payload_schema=sla-row-v1" "HTTP 400 — payload_schema param not supported in route schema (add it to fragment-routes.ts)"
else
  fail "GET /v1/fragments?payload_schema=sla-row-v1" "HTTP $HTTP_CODE — $BODY"
fi

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "============================================="
echo "  SUMMARY"
echo "============================================="
for r in "${RESULTS[@]}"; do
  echo "  $r"
done
echo "---------------------------------------------"
echo "  Passed: $PASS_COUNT"
echo "  Failed: $FAIL_COUNT"
echo "  Skipped: 1 (harvest — use multi-format-e2e.sh)"
echo "  Total checks: $((PASS_COUNT + FAIL_COUNT + 1))"
echo "============================================="

if [[ "$FAIL_COUNT" -gt 0 ]]; then
  exit 1
fi
exit 0
