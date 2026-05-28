#!/usr/bin/env bash
# Test non-régression retrieval — 3 sections × 3 modes
# Usage: ./scripts/test-retrieval-modes.sh [PLAN_ID]
#
# Pour chaque mode (vector-only / hybrid / agentic-only) :
#   - Switch le mode via l'API admin
#   - Lance searchSection pour chaque section
#   - Affiche les top-5 avec score + type du fragment
#
# Critères de lecture :
#   vector-only : score = cosine brut (0-1)
#   hybrid      : score = RRF normalisé, vs=cosine, llm=juge/10
#   agentic     : score = LLM/10 normalisé, justification textuelle
#
# Sections et types attendus :
#   "références clients"     → type: reference / testimonial
#   "souveraineté"          → type: argument / introduction
#   "architecture"          → type: methodology / argument (technique)
#
# Risque à surveiller : Fix 2+4 rendent-ils le LLM trop obsédé par le type ?
#   → sections thématiques/techniques doivent donner des résultats cohérents
#     même si le type n'est pas guidé explicitement

BASE_URL="${FRAGMINT_BASE_URL:-http://localhost:3210}"
PLAN_ID="${1:-}"

if [ -z "$PLAN_ID" ]; then
  echo "Usage: $0 <PLAN_ID>"
  echo ""
  echo "Créer un plan test :"
  echo "  scripts/create-test-plan.sh"
  exit 1
fi

# Sections (titre + ID stable pré-calculé)
declare -a SEC_IDS=("sec_258c559e5de0" "sec_97a98c942a3b" "sec_0c4f644cfcb9")
declare -a SEC_TITLES=("Références clients et études de cas" "Argumentaire souveraineté numérique" "Architecture technique et méthodologie")
declare -a SEC_EXPECTED=("reference/testimonial" "argument/introduction" "methodology/argument")

# --- Auth ---
LOGIN=$(curl -sf -X POST "$BASE_URL/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"username":"mmaudet","password":"fragmint-dev"}')
TOKEN=$(echo "$LOGIN" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["token"])')

search_section() {
  local sid="$1"
  local outfile="$2"
  curl -s -X POST "$BASE_URL/v1/plans/$PLAN_ID/sections/$sid/search" \
    -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' \
    -d '{}' > "$outfile"
  local http_status=$?
  return $http_status
}

parse_section_result() {
  local file="$1"
  local sid="$2"
  python3 << PYEOF
import json
with open("$file") as f:
    raw = f.read()
    clean = ''.join(c for c in raw if ord(c) >= 32 or c in '\n\t')
    d = json.loads(clean)

err = d.get("error")
if err:
    print("    ERROR:", err)
    exit()

state = (d.get("data") or {}).get("state", {})
section = next((s for s in state.get("sections", []) if s["id"] == "$sid"), None)
if not section:
    print("    (section introuvable)")
    exit()

candidates = section.get("candidates", [])
if not candidates:
    print("    (aucun candidat retourné)")
    exit()

for c in candidates:
    score = c.get("score")
    score_str = str(round(score*100))+"%" if score is not None else "N/A"
    bd = c.get("score_breakdown") or {}
    method = bd.get("method","?")
    frag_title = (c.get("title","") or "(sans titre)")[:65]
    # Context by method
    extra = ""
    if method == "hybrid_rrf":
        vs = bd.get("vector_score")
        ls = bd.get("llm_score")
        if vs is not None: extra += " vs="+str(round(vs*100))+"%"
        if ls is not None: extra += " llm="+str(ls)+"/10"
    elif method == "agentic":
        ls = bd.get("llm_score")
        if ls is not None: extra += " llm="+str(ls)+"/10"
    just = (c.get("justification") or "")
    print("    ["+score_str+"]["+method+"]"+extra+"  "+frag_title)
    if just:
        print("      -> "+(just[:90]))
PYEOF
}

run_mode() {
  local mode="$1"
  local label="$2"

  echo ""
  echo "========================================================"
  echo "  MODE: $label"
  echo "========================================================"

  # Switch mode
  curl -sf -X POST "$BASE_URL/v1/admin/retrieval/mode" \
    -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' \
    -d "{\"mode\":\"$mode\"}" > /dev/null

  for i in 0 1 2; do
    local sid="${SEC_IDS[$i]}"
    local stitle="${SEC_TITLES[$i]}"
    local sexpected="${SEC_EXPECTED[$i]}"
    local tmpfile="/tmp/search_${mode}_${i}.json"

    echo ""
    echo "  -- Section $((i+1)): $stitle"
    echo "     Attend: type=$sexpected"

    search_section "$sid" "$tmpfile"
    parse_section_result "$tmpfile" "$sid"
  done
}

echo "Plan ID : $PLAN_ID"
echo "URL     : $BASE_URL"
echo "Date    : $(date '+%Y-%m-%d %H:%M')"

run_mode "vector-only"  "VECTOR-ONLY (baseline, cosine pur)"
run_mode "hybrid"       "HYBRID (RRF = cosine + LLM judge)"
run_mode "agentic-only" "AGENTIC (LLM browse index + per-fragment judge)"

echo ""
echo "========================================================"
echo "  CHECKLIST DE VALIDATION"
echo "========================================================"
echo "  [ ] 'Références clients' : hybrid/agentic retournent-ils + de reference/testimonial que vector ?"
echo "  [ ] 'Souveraineté'       : le LLM n'est-il PAS trop obsédé par le type ? (attend argument/intro)"
echo "  [ ] 'Architecture'       : methodology présent ? vector est-il déjà bon ici ?"
echo "  [ ] Hybrid vs Vector     : CHU Bordeaux (69% cosine) et Conseil Régional (62%) remontent-ils ?"
echo "  [ ] Agentic              : justifications cohérentes avec le contenu réel ?"
echo ""
echo "Logs docker pour plus de détail :"
echo "  docker compose -f docker/docker-compose.dev.yml logs --tail=200 server | grep 'retrieval'"
