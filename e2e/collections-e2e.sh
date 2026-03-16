#!/usr/bin/env bash
# =============================================================================
# Fragmint Collections E2E Test
# =============================================================================
# Tests the full collections workflow including:
#   - Authentication and user management
#   - Collection creation and access control
#   - Fragment isolation between collections
#   - Cross-collection composition
#   - Membership revocation
#
# Prerequisites:
#   - Fragmint server running on BASE_URL (default: http://localhost:3737)
#   - Admin user mmaudet with password fragmint-dev (dev mode defaults)
#
# Usage:
#   ./e2e/collections-e2e.sh [BASE_URL]
# =============================================================================

set -euo pipefail

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
echo "  Fragmint Collections E2E Test"
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
  fi
else
  fail "Admin login" "HTTP $HTTP_CODE"
  echo "Response: $BODY"
fi

# ─── 2. Create second user (jdupont, contributor) ───────────────────────────
echo "--- 2. Create second user (jdupont) ---"
api POST /v1/users "$ADMIN_TOKEN" '{"login":"jdupont","password":"test-pass-123","display_name":"Jean Dupont","role":"contributor"}'
if [[ "$HTTP_CODE" == "201" || "$HTTP_CODE" == "200" ]]; then
  pass "Create user jdupont"
else
  # May already exist from a previous run
  if echo "$BODY" | grep -qi "unique\|exists\|duplicate"; then
    pass "Create user jdupont (already exists)"
  else
    fail "Create user jdupont" "HTTP $HTTP_CODE — $BODY"
  fi
fi

# Login as jdupont
api POST /v1/auth/login "" '{"username":"jdupont","password":"test-pass-123"}'
if [[ "$HTTP_CODE" == "200" ]]; then
  JDUPONT_TOKEN=$(json_val "d['data']['token']")
  pass "Login jdupont"
else
  fail "Login jdupont" "HTTP $HTTP_CODE"
fi

# ─── 3. Verify common collection exists ─────────────────────────────────────
echo "--- 3. Verify common collection exists ---"
api GET /v1/collections/common "$ADMIN_TOKEN"
if [[ "$HTTP_CODE" == "200" ]]; then
  COMMON_SLUG=$(json_val "d['data']['slug']")
  if [[ "$COMMON_SLUG" == "common" ]]; then
    pass "Common collection exists"
  else
    fail "Common collection exists" "slug=$COMMON_SLUG"
  fi
else
  fail "Common collection exists" "HTTP $HTTP_CODE"
fi

# ─── 4. Create team collection (projet-anfsi) ──────────────────────────────
echo "--- 4. Create team collection (projet-anfsi) ---"
api POST /v1/collections "$ADMIN_TOKEN" '{"slug":"projet-anfsi","name":"Projet ANFSI","type":"team","description":"Collection pour le projet ANFSI"}'
if [[ "$HTTP_CODE" == "201" ]]; then
  pass "Create collection projet-anfsi"
elif echo "$BODY" | grep -qi "unique\|exists\|duplicate"; then
  pass "Create collection projet-anfsi (already exists)"
else
  fail "Create collection projet-anfsi" "HTTP $HTTP_CODE — $BODY"
fi

# ─── 5. jdupont denied access to anfsi ──────────────────────────────────────
echo "--- 5. jdupont denied access to anfsi ---"
api GET /v1/collections/projet-anfsi "$JDUPONT_TOKEN"
if [[ "$HTTP_CODE" == "403" ]]; then
  pass "jdupont denied access to projet-anfsi"
else
  fail "jdupont denied access to projet-anfsi" "Expected 403, got HTTP $HTTP_CODE"
fi

# ─── 6. Add jdupont as contributor to anfsi ─────────────────────────────────
echo "--- 6. Add jdupont as contributor to anfsi ---"
# We need jdupont's user ID
api GET /v1/users "$ADMIN_TOKEN"
JDUPONT_ID=$(echo "$BODY" | python3 -c "
import sys, json
users = json.load(sys.stdin)['data']
for u in users:
    if u['login'] == 'jdupont':
        print(u['id'])
        break
" 2>/dev/null || echo "")

if [[ -z "$JDUPONT_ID" || "$JDUPONT_ID" == "None" ]]; then
  fail "Get jdupont user ID" "Could not find jdupont in user list"
else
  api POST /v1/collections/projet-anfsi/members "$ADMIN_TOKEN" "{\"user_id\":\"$JDUPONT_ID\",\"role\":\"contributor\"}"
  if [[ "$HTTP_CODE" == "201" || "$HTTP_CODE" == "200" ]]; then
    pass "Add jdupont as contributor to projet-anfsi"
  else
    fail "Add jdupont as contributor" "HTTP $HTTP_CODE — $BODY"
  fi
fi

# ─── 7. jdupont gains access ────────────────────────────────────────────────
echo "--- 7. jdupont gains access to anfsi ---"
api GET /v1/collections/projet-anfsi "$JDUPONT_TOKEN"
if [[ "$HTTP_CODE" == "200" ]]; then
  pass "jdupont can now access projet-anfsi"
else
  fail "jdupont access to projet-anfsi" "Expected 200, got HTTP $HTTP_CODE"
fi

# ─── 8. jdupont creates fragment in anfsi ───────────────────────────────────
echo "--- 8. jdupont creates fragment in anfsi ---"
api POST /v1/collections/projet-anfsi/fragments "$JDUPONT_TOKEN" '{
  "type": "argument",
  "domain": "defense",
  "lang": "fr",
  "body": "La souverainete numerique est un enjeu strategique majeur pour la France. ANFSI permettra de centraliser les competences.",
  "tags": ["anfsi", "souverainete"],
  "access": {"read": "collection", "write": "collection"},
  "origin": "manual"
}'
if [[ "$HTTP_CODE" == "201" ]]; then
  ANFSI_FRAG_ID=$(json_val "d['data']['id']")
  pass "jdupont created fragment in projet-anfsi (id=$ANFSI_FRAG_ID)"
else
  fail "Create fragment in projet-anfsi" "HTTP $HTTP_CODE — $BODY"
fi

# ─── 9. Fragment visible in anfsi ───────────────────────────────────────────
echo "--- 9. Fragment visible in anfsi collection ---"
api GET /v1/collections/projet-anfsi/fragments "$JDUPONT_TOKEN"
if [[ "$HTTP_CODE" == "200" ]]; then
  ANFSI_COUNT=$(json_val "d['meta']['count']")
  if [[ "$ANFSI_COUNT" -ge 1 ]]; then
    pass "Fragment visible in projet-anfsi (count=$ANFSI_COUNT)"
  else
    fail "Fragment visible in projet-anfsi" "count=$ANFSI_COUNT, expected >= 1"
  fi
else
  fail "List fragments in projet-anfsi" "HTTP $HTTP_CODE"
fi

# ─── 10. Fragment NOT visible in common ─────────────────────────────────────
echo "--- 10. Fragment NOT visible in common ---"
api GET /v1/collections/common/fragments "$ADMIN_TOKEN"
if [[ "$HTTP_CODE" == "200" ]]; then
  # Check that the ANFSI fragment ID is not in the common list
  HAS_ANFSI=$(echo "$BODY" | python3 -c "
import sys, json
data = json.load(sys.stdin)['data']
ids = [f['id'] for f in data]
print('yes' if '$ANFSI_FRAG_ID' in ids else 'no')
" 2>/dev/null || echo "error")
  if [[ "$HAS_ANFSI" == "no" ]]; then
    pass "ANFSI fragment NOT in common collection"
  else
    fail "ANFSI fragment isolation" "Fragment $ANFSI_FRAG_ID found in common collection"
  fi
else
  fail "List fragments in common" "HTTP $HTTP_CODE"
fi

# ─── 11. Backward compat /v1/fragments ──────────────────────────────────────
echo "--- 11. Backward compat /v1/fragments ---"
api GET /v1/fragments "$ADMIN_TOKEN"
if [[ "$HTTP_CODE" == "200" ]]; then
  V1_COUNT=$(json_val "d['meta']['count']")
  pass "GET /v1/fragments works (count=$V1_COUNT)"
else
  fail "GET /v1/fragments backward compat" "HTTP $HTTP_CODE"
fi

# ─── 12. ANFSI isolation verified ───────────────────────────────────────────
echo "--- 12. ANFSI isolation (count=1) ---"
api GET /v1/collections/projet-anfsi/fragments "$ADMIN_TOKEN"
if [[ "$HTTP_CODE" == "200" ]]; then
  ISO_COUNT=$(json_val "d['meta']['count']")
  if [[ "$ISO_COUNT" == "1" ]]; then
    pass "ANFSI collection has exactly 1 fragment"
  else
    fail "ANFSI isolation" "Expected 1 fragment, got $ISO_COUNT"
  fi
else
  fail "ANFSI isolation check" "HTTP $HTTP_CODE"
fi

# ─── 13. Admin creates fragment in common ───────────────────────────────────
echo "--- 13. Admin creates fragment in common ---"
api POST /v1/collections/common/fragments "$ADMIN_TOKEN" '{
  "type": "argument",
  "domain": "open-source",
  "lang": "fr",
  "body": "Les logiciels libres garantissent la transparence, la securite et la perennite des systemes informatiques de etat.",
  "tags": ["open-source", "transparence"],
  "access": {"read": "public", "write": "team"},
  "origin": "manual"
}'
if [[ "$HTTP_CODE" == "201" ]]; then
  COMMON_FRAG_ID=$(json_val "d['data']['id']")
  pass "Admin created fragment in common (id=$COMMON_FRAG_ID)"
else
  fail "Create fragment in common" "HTTP $HTTP_CODE — $BODY"
fi

# ─── 14. Cross-collection composition ──────────────────────────────────────
echo "--- 14. Cross-collection composition ---"
# This test verifies that fragments from BOTH collections can be retrieved
# by fetching them individually (simulating what a composer would do).

# Fetch the ANFSI fragment
api GET "/v1/fragments/$ANFSI_FRAG_ID" "$ADMIN_TOKEN"
ANFSI_BODY=""
if [[ "$HTTP_CODE" == "200" ]]; then
  ANFSI_BODY=$(json_val "d['data']['body']")
fi

# Fetch the common fragment
api GET "/v1/fragments/$COMMON_FRAG_ID" "$ADMIN_TOKEN"
COMMON_BODY=""
if [[ "$HTTP_CODE" == "200" ]]; then
  COMMON_BODY=$(json_val "d['data']['body']")
fi

if [[ -n "$ANFSI_BODY" && "$ANFSI_BODY" != "None" && -n "$COMMON_BODY" && "$COMMON_BODY" != "None" ]]; then
  pass "Cross-collection composition: fragments from both collections accessible"
else
  fail "Cross-collection composition" "Could not fetch fragments from both collections"
fi

# Verify the two fragments are in different collections by checking collection_slug
api GET /v1/collections/projet-anfsi/fragments "$ADMIN_TOKEN"
ANFSI_LIST_IDS=$(echo "$BODY" | python3 -c "
import sys, json
data = json.load(sys.stdin)['data']
print(','.join([f['id'] for f in data]))
" 2>/dev/null || echo "")

api GET /v1/collections/common/fragments "$ADMIN_TOKEN"
COMMON_LIST_IDS=$(echo "$BODY" | python3 -c "
import sys, json
data = json.load(sys.stdin)['data']
print(','.join([f['id'] for f in data]))
" 2>/dev/null || echo "")

if echo "$ANFSI_LIST_IDS" | grep -q "$ANFSI_FRAG_ID" && echo "$COMMON_LIST_IDS" | grep -q "$COMMON_FRAG_ID"; then
  if ! echo "$COMMON_LIST_IDS" | grep -q "$ANFSI_FRAG_ID"; then
    pass "Cross-collection isolation confirmed: each fragment in its own collection only"
  else
    fail "Cross-collection isolation" "ANFSI fragment leaked into common listing"
  fi
else
  fail "Cross-collection isolation" "Fragment not found in expected collection"
fi

# ─── 15. Remove jdupont from anfsi — access revoked ────────────────────────
echo "--- 15. Remove jdupont from anfsi ---"
api DELETE "/v1/collections/projet-anfsi/members/$JDUPONT_ID" "$ADMIN_TOKEN"
if [[ "$HTTP_CODE" == "200" ]]; then
  pass "Removed jdupont from projet-anfsi"
else
  fail "Remove jdupont from projet-anfsi" "HTTP $HTTP_CODE — $BODY"
fi

# Verify access revoked
api GET /v1/collections/projet-anfsi/fragments "$JDUPONT_TOKEN"
if [[ "$HTTP_CODE" == "403" ]]; then
  pass "jdupont access to projet-anfsi revoked"
else
  fail "jdupont access revocation" "Expected 403, got HTTP $HTTP_CODE"
fi

# ─── 16. jdupont still has common access ────────────────────────────────────
echo "--- 16. jdupont still has common access ---"
# First ensure jdupont is a member of common
api POST /v1/collections/common/members "$ADMIN_TOKEN" "{\"user_id\":\"$JDUPONT_ID\",\"role\":\"reader\"}"
# It's fine if this fails (already a member)

api GET /v1/collections/common/fragments "$JDUPONT_TOKEN"
if [[ "$HTTP_CODE" == "200" ]]; then
  pass "jdupont still has access to common collection"
else
  fail "jdupont common access" "Expected 200, got HTTP $HTTP_CODE"
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
echo "  Total:  $((PASS_COUNT + FAIL_COUNT))"
echo "============================================="

if [[ "$FAIL_COUNT" -gt 0 ]]; then
  exit 1
fi
exit 0
