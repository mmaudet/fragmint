#!/usr/bin/env bash
# =============================================================================
# Démonstration Fragmint — LinCloud Souverain
# =============================================================================
# Ce script exécute un scénario complet de démonstration :
#   1. Connexion en tant qu'administrateur
#   2. Création d'une collection « demo-lincloud »
#   3. Chargement de 10 fragments depuis les fichiers JSON
#   4. Création et upload de 4 templates (Marp, reveal.js, DOCX, XLSX)
#   5. Composition des 4 formats de sortie
#   6. Téléchargement des fichiers générés
#
# Utilisation :
#   bash e2e/demo/run-demo.sh [BASE_URL] [--keep]
#
#   BASE_URL  — URL du serveur Fragmint (défaut : http://localhost:3210)
#   --keep    — Conserver la collection et les données après exécution
#
# Prérequis :
#   - Serveur Fragmint lancé (pnpm dev)
#   - curl, python3 et node disponibles
#   - Utilisateur admin mmaudet / fragmint-dev (mode dev par défaut)
# =============================================================================

set -eo pipefail

# ── Paramètres ───────────────────────────────────────────────────────────────

BASE_URL="http://localhost:3210"
KEEP_DATA=false

for arg in "$@"; do
  case "$arg" in
    --keep) KEEP_DATA=true ;;
    http*) BASE_URL="$arg" ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUTPUT_DIR="$SCRIPT_DIR/output"
FRAGMENTS_DIR="$SCRIPT_DIR/fragments"
TEMPLATES_DIR="$SCRIPT_DIR/templates"
TEMP_DIR="$OUTPUT_DIR/.tmp"

# Compteurs de résultats
PASS_COUNT=0
FAIL_COUNT=0
RESULTS=()

# Préparer le répertoire de sortie
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR" "$TEMP_DIR"

# ── Fonctions utilitaires ────────────────────────────────────────────────────

pass() {
  PASS_COUNT=$((PASS_COUNT + 1))
  RESULTS+=("[OK]   $1")
  echo "  [OK]   $1"
}

fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  RESULTS+=("[FAIL] $1 — $2")
  echo "  [FAIL] $1 — $2"
}

# Effectuer un appel API. Positionne HTTP_CODE et BODY.
api() {
  local method="$1"
  local path="$2"
  local token="${3:-}"
  local data="${4:-}"

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

# ── Vérification des prérequis ───────────────────────────────────────────────

echo ""
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║     Démonstration Fragmint — LinCloud Souverain          ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""
echo "  Serveur  : $BASE_URL"
echo "  Sortie   : $OUTPUT_DIR"
echo "  Conserver : $KEEP_DATA"
echo ""

# Vérifier que curl est disponible
if ! command -v curl &>/dev/null; then
  echo "ERREUR : curl n'est pas installé."
  exit 1
fi

# Vérifier que python3 est disponible
if ! command -v python3 &>/dev/null; then
  echo "ERREUR : python3 n'est pas installé."
  exit 1
fi

# Vérifier que node est disponible
if ! command -v node &>/dev/null; then
  echo "ERREUR : node n'est pas installé."
  exit 1
fi

# Vérifier que le serveur répond
if ! curl -s -o /dev/null -w '' --connect-timeout 5 "${BASE_URL}/v1/health" 2>/dev/null; then
  echo "ERREUR : Le serveur Fragmint ne répond pas sur $BASE_URL"
  echo "         Lancez-le avec : pnpm dev"
  exit 1
fi

echo "  Prérequis vérifiés."
echo ""

# =============================================================================
# Étape 1 — Connexion administrateur
# =============================================================================
echo "── Étape 1 : Connexion administrateur ───────────────────────"

api POST /v1/auth/login "" '{"username":"mmaudet","password":"fragmint-dev"}'
if [[ "$HTTP_CODE" == "200" ]]; then
  ADMIN_TOKEN=$(json_val "d['data']['token']")
  if [[ -n "$ADMIN_TOKEN" && "$ADMIN_TOKEN" != "None" ]]; then
    pass "Connexion admin"
  else
    fail "Connexion admin" "Pas de token dans la réponse"
    echo "  Impossible de continuer sans token admin."
    exit 1
  fi
else
  fail "Connexion admin" "HTTP $HTTP_CODE"
  echo "  Impossible de continuer sans token admin."
  exit 1
fi

# =============================================================================
# Étape 2 — Création de la collection demo-lincloud
# =============================================================================
echo ""
echo "── Étape 2 : Création de la collection ──────────────────────"

COLLECTION="demo-lincloud"

api POST /v1/collections "$ADMIN_TOKEN" "{
  \"id\": \"$COLLECTION\",
  \"name\": \"Demo LinCloud Souverain\",
  \"type\": \"team\"
}"
if [[ "$HTTP_CODE" == "201" ]]; then
  pass "Création collection $COLLECTION"
elif [[ "$HTTP_CODE" == "409" ]]; then
  pass "Collection $COLLECTION existe déjà (réutilisation)"
else
  # Essayer d'utiliser la collection common si la création échoue
  echo "  Note: Impossible de créer la collection, utilisation de 'common'"
  COLLECTION="common"
  pass "Utilisation de la collection $COLLECTION"
fi

# =============================================================================
# Étape 3 — Chargement des 10 fragments
# =============================================================================
echo ""
echo "── Étape 3 : Chargement des 10 fragments ────────────────────"

FRAGMENT_IDS=()

for frag_file in "$FRAGMENTS_DIR"/*.json; do
  frag_name=$(basename "$frag_file" .json)

  # Lire le fichier JSON et envoyer à l'API
  frag_data=$(cat "$frag_file")

  api POST "/v1/collections/$COLLECTION/fragments" "$ADMIN_TOKEN" "$frag_data"

  if [[ "$HTTP_CODE" == "201" ]]; then
    frag_id=$(json_val "d['data']['id']")
    FRAGMENT_IDS+=("$frag_id")
    pass "Fragment $frag_name (id=$frag_id)"
  else
    fail "Fragment $frag_name" "HTTP $HTTP_CODE — $BODY"
    FRAGMENT_IDS+=("FAILED")
  fi
done

echo ""
echo "  ${#FRAGMENT_IDS[@]} fragments chargés."

# =============================================================================
# Étape 4 — Création des fichiers template
# =============================================================================
echo ""
echo "── Étape 4 : Création des templates ─────────────────────────"

# Les templates Marp et reveal.js sont déjà en fichiers statiques.
# Les templates DOCX et XLSX doivent être générés programmatiquement.

# ── 4a. Génération du template DOCX ──────────────────────────────────────────

echo "  Génération du template DOCX avec Node.js..."
cd "$PROJECT_ROOT/packages/server" && node -e "
const fs = require('fs');
const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType, AlignmentType } = require('$PROJECT_ROOT/node_modules/docx');

const b = { top:{style:BorderStyle.SINGLE,size:1,color:'CCCCCC'}, bottom:{style:BorderStyle.SINGLE,size:1,color:'CCCCCC'}, left:{style:BorderStyle.SINGLE,size:1,color:'CCCCCC'}, right:{style:BorderStyle.SINGLE,size:1,color:'CCCCCC'} };
const hs = { type: ShadingType.SOLID, color: '2B579A' };
const ht = (t) => new TextRun({ text: t, bold: true, size: 20, color: 'FFFFFF' });
const ct = (t, o={}) => new TextRun({ text: t, size: 22, ...o });

function headerCell(text) {
  return new TableCell({
    borders: b, shading: hs,
    children: [new Paragraph({ children: [ht(text)], alignment: AlignmentType.CENTER })],
  });
}
function dataCell(text, opts={}) {
  return new TableCell({
    borders: b, shading: opts.shading,
    children: [new Paragraph({ children: [new TextRun({ text, size: 20, bold: opts.bold || false, color: opts.color })], alignment: opts.align || AlignmentType.LEFT })],
  });
}

const cmdText = (t) => new TextRun({ text: t, size: 2, color: 'FFFFFF' });
const nb = { top:{style:BorderStyle.NONE}, bottom:{style:BorderStyle.NONE}, left:{style:BorderStyle.NONE}, right:{style:BorderStyle.NONE} };

const pricingTable = new Table({
  width: { size: 100, type: WidthType.PERCENTAGE },
  rows: [
    new TableRow({ children: [headerCell('Service'), headerCell('Description'), headerCell('Qté'), headerCell('P.U.'), headerCell('Total')] }),
    new TableRow({ children: [
      new TableCell({ children: [new Paragraph({ children: [cmdText('+++FOR l IN lignes+++')] })], borders: nb, columnSpan: 5 }),
    ] }),
    new TableRow({ children: [
      dataCell('+++INS \$l.service+++'),
      dataCell('+++INS \$l.description+++'),
      dataCell('+++INS \$l.quantite+++', {align:AlignmentType.RIGHT}),
      dataCell('+++INS \$l.prix_unitaire+++', {align:AlignmentType.RIGHT}),
      dataCell('+++INS \$l.total+++', {align:AlignmentType.RIGHT}),
    ] }),
    new TableRow({ children: [
      new TableCell({ children: [new Paragraph({ children: [cmdText('+++END-FOR l+++')] })], borders: nb, columnSpan: 5 }),
    ] }),
    new TableRow({ children: [
      new TableCell({ borders: b, columnSpan: 4, shading: { type: ShadingType.SOLID, color: 'E8E8E8' }, children: [new Paragraph({ children: [new TextRun({ text: 'Total HT', size: 20, bold: true })], alignment: AlignmentType.RIGHT })] }),
      dataCell('+++INS metadata.total_ht+++ \u20ac', { bold: true, align: AlignmentType.RIGHT, shading: { type: ShadingType.SOLID, color: 'E8E8E8' } }),
    ] }),
    new TableRow({ children: [
      new TableCell({ borders: b, columnSpan: 4, children: [new Paragraph({ children: [new TextRun({ text: 'TVA (20%)', size: 20 })], alignment: AlignmentType.RIGHT })] }),
      dataCell('+++INS metadata.tva+++ \u20ac', { align: AlignmentType.RIGHT }),
    ] }),
    new TableRow({ children: [
      new TableCell({ borders: b, columnSpan: 4, shading: { type: ShadingType.SOLID, color: '2B579A' }, children: [new Paragraph({ children: [new TextRun({ text: 'Total TTC', size: 20, bold: true, color: 'FFFFFF' })], alignment: AlignmentType.RIGHT })] }),
      new TableCell({ borders: b, shading: { type: ShadingType.SOLID, color: '2B579A' }, children: [new Paragraph({ children: [new TextRun({ text: '+++INS metadata.total_ttc+++ \u20ac', size: 20, bold: true, color: 'FFFFFF' })], alignment: AlignmentType.RIGHT })] }),
    ] }),
  ],
});

const doc = new Document({
  sections: [{
    children: [
      new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Proposition LinCloud Souverain', bold: true, size: 48, color: '2B579A' })], spacing: { after: 200 } }),
      new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '+++INS metadata.client+++', size: 28 })], spacing: { after: 100 } }),
      new Paragraph({ alignment: AlignmentType.CENTER, children: [ct('+++INS metadata.date+++', { italics: true })], spacing: { after: 400 } }),
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: 'Contexte', color: '2B579A', bold: true })] }),
      new Paragraph({ children: [ct('+++INS fragments.introduction.body+++')] , spacing: { after: 300 } }),
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: 'Notre solution', color: '2B579A', bold: true })], spacing: { before: 300 } }),
      new Paragraph({ children: [new TextRun({ text: '+++FOR arg IN fragments.arguments+++', size: 2, color: 'FFFFFF' })] }),
      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [ct('+++INS \$arg.title+++', { bold: true })] }),
      new Paragraph({ children: [ct('+++INS \$arg.body+++')] , spacing: { after: 200 } }),
      new Paragraph({ children: [new TextRun({ text: '+++END-FOR arg+++', size: 2, color: 'FFFFFF' })] }),
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: 'Tarification', color: '2B579A', bold: true })], spacing: { before: 400, after: 200 } }),
      pricingTable,
      new Paragraph({ spacing: { after: 300 } }),
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: 'Références', color: '2B579A', bold: true })], spacing: { before: 300 } }),
      new Paragraph({ children: [ct('+++INS fragments.references.body+++')] , spacing: { after: 300 } }),
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: 'Conclusion', color: '2B579A', bold: true })], spacing: { before: 300 } }),
      new Paragraph({ children: [ct('+++INS fragments.conclusion.body+++')] }),
    ],
  }],
});

Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync('$TEMP_DIR/lincloud-proposal.docx', buffer);
  console.log('  Template DOCX créé (' + buffer.length + ' octets)');
});
" 2>&1

if [[ -f "$TEMP_DIR/lincloud-proposal.docx" ]]; then
  DOCX_SIZE=$(wc -c < "$TEMP_DIR/lincloud-proposal.docx" | tr -d ' ')
  pass "Template DOCX ($DOCX_SIZE octets)"
else
  fail "Template DOCX" "Fichier non généré"
fi

# ── 4b. Génération du template XLSX ──────────────────────────────────────────

echo "  Génération du template XLSX avec Node.js..."
cd "$PROJECT_ROOT/packages/server" && node -e "
const ExcelJS = require('$PROJECT_ROOT/packages/server/node_modules/exceljs');
const fs = require('fs');

async function createTemplate() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Devis');

  ws.mergeCells('A1:F1');
  ws.getCell('A1').value = 'DEVIS — LinCloud Souverain';
  ws.getCell('A1').font = { bold: true, size: 16 };

  ws.getCell('A3').value = 'Client :';
  ws.getCell('B3').value = '\${metadata.client}';
  ws.getCell('A4').value = 'Date :';
  ws.getCell('B4').value = '\${metadata.date}';
  ws.getCell('A5').value = 'Référence :';
  ws.getCell('B5').value = '\${metadata.reference}';

  const headerRow = 7;
  ws.getCell('A' + headerRow).value = 'Service';
  ws.getCell('B' + headerRow).value = 'Description';
  ws.getCell('C' + headerRow).value = 'Quantité';
  ws.getCell('D' + headerRow).value = 'Prix unitaire';
  ws.getCell('E' + headerRow).value = 'Total';
  for (let col = 1; col <= 5; col++) {
    const cell = ws.getCell(headerRow, col);
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
  }

  const dataRow = 8;
  ws.getCell('A' + dataRow).value = '\${table:lignes.service}';
  ws.getCell('B' + dataRow).value = '\${table:lignes.description}';
  ws.getCell('C' + dataRow).value = '\${table:lignes.quantite}';
  ws.getCell('D' + dataRow).value = '\${table:lignes.prix_unitaire}';
  ws.getCell('E' + dataRow).value = '\${table:lignes.total}';

  ws.getCell('D13').value = 'Total HT :';
  ws.getCell('D13').font = { bold: true };
  ws.getCell('E13').value = '\${metadata.total_ht}';
  ws.getCell('E13').font = { bold: true };
  ws.getCell('E13').numFmt = '#,##0.00\\ \"€\"';

  ws.getCell('D14').value = 'TVA (20%) :';
  ws.getCell('E14').value = '\${metadata.tva}';
  ws.getCell('E14').numFmt = '#,##0.00\\ \"€\"';

  ws.getCell('D15').value = 'Total TTC :';
  ws.getCell('D15').font = { bold: true };
  ws.getCell('E15').value = '\${metadata.total_ttc}';
  ws.getCell('E15').font = { bold: true };
  ws.getCell('E15').numFmt = '#,##0.00\\ \"€\"';

  ws.getColumn(1).width = 20;
  ws.getColumn(2).width = 45;
  ws.getColumn(3).width = 12;
  ws.getColumn(4).width = 15;
  ws.getColumn(5).width = 15;

  const buffer = await wb.xlsx.writeBuffer();
  fs.writeFileSync('$TEMP_DIR/lincloud-devis.xlsx', Buffer.from(buffer));
  console.log('  Template XLSX créé (' + buffer.length + ' octets)');
}

createTemplate().catch(err => { console.error(err); process.exit(1); });
" 2>&1

if [[ -f "$TEMP_DIR/lincloud-devis.xlsx" ]]; then
  XLSX_SIZE=$(wc -c < "$TEMP_DIR/lincloud-devis.xlsx" | tr -d ' ')
  pass "Template XLSX ($XLSX_SIZE octets)"
else
  fail "Template XLSX" "Fichier non généré"
fi

# =============================================================================
# Étape 5 — Upload des 4 templates
# =============================================================================
echo ""
echo "── Étape 5 : Upload des templates ───────────────────────────"

# Fonction d'upload d'un template (fichier source + définition YAML)
upload_template() {
  local yaml_file="$1"
  local template_file="$2"
  local template_filename="$3"
  local label="$4"

  local response
  response=$(curl -s -w '\n%{http_code}' -X POST "${BASE_URL}/v1/templates" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -F "docx=@${template_file};filename=${template_filename}" \
    -F "yaml=@${yaml_file};filename=$(basename "$yaml_file")")

  HTTP_CODE=$(echo "$response" | tail -1)
  BODY=$(echo "$response" | sed '$d')

  if [[ "$HTTP_CODE" == "201" ]]; then
    pass "Upload template : $label"
  else
    fail "Upload template : $label" "HTTP $HTTP_CODE — $BODY"
  fi
}

# Upload Marp
upload_template \
  "$TEMPLATES_DIR/marp/lincloud-slides.yaml" \
  "$TEMPLATES_DIR/marp/lincloud-slides.md" \
  "lincloud-slides.md" \
  "Marp slides"

# Upload reveal.js
upload_template \
  "$TEMPLATES_DIR/reveal/lincloud-reveal.yaml" \
  "$TEMPLATES_DIR/reveal/lincloud-reveal.html" \
  "lincloud-reveal.html" \
  "reveal.js"

# Upload DOCX
upload_template \
  "$TEMPLATES_DIR/docx/lincloud-proposition.yaml" \
  "$TEMP_DIR/lincloud-proposal.docx" \
  "lincloud-proposal.docx" \
  "DOCX"

# Upload XLSX
upload_template \
  "$TEMPLATES_DIR/xlsx/lincloud-devis.yaml" \
  "$TEMP_DIR/lincloud-devis.xlsx" \
  "lincloud-devis.xlsx" \
  "XLSX"

# =============================================================================
# Étape 6 — Composition des 4 formats
# =============================================================================
echo ""
echo "── Étape 6 : Composition des documents ──────────────────────"

# Contexte de composition (données métier pour le devis)
COMPOSE_CONTEXT='{
  "context": {
    "client": "Ministère des Armées",
    "date": "2026-03-16",
    "reference": "LC-2026-MINARM-001",
    "product": "lincloud",
    "lang": "fr",
    "total_ht": "12 305,00",
    "tva": "2 461,00",
    "total_ttc": "14 766,00"
  },
  "structured_data": {
    "lignes": [
      {"service": "Compute vCPU", "description": "100 vCPU x 730h/mois", "quantite": 100, "prix_unitaire": 18.25, "total": 1825.00},
      {"service": "Stockage objet S3", "description": "5 000 Go stockage objet", "quantite": 5000, "prix_unitaire": 0.008, "total": 40.00},
      {"service": "Stockage bloc SSD", "description": "2 000 Go SSD haute perf.", "quantite": 2000, "prix_unitaire": 0.12, "total": 240.00},
      {"service": "Support Premium 24/7", "description": "12 mois SLA 4h", "quantite": 12, "prix_unitaire": 850.00, "total": 10200.00}
    ]
  }
}'

compose_and_download() {
  local tpl_id="$1"
  local output_format="$2"
  local output_filename="$3"
  local label="$4"

  # Construire la requête de composition avec le format de sortie
  local compose_body
  compose_body=$(echo "$COMPOSE_CONTEXT" | python3 -c "
import sys, json
data = json.load(sys.stdin)
data['output'] = {'format': '$output_format', 'filename': '$output_filename'}
print(json.dumps(data))
")

  api POST "/v1/templates/$tpl_id/compose" "$ADMIN_TOKEN" "$compose_body"

  if [[ "$HTTP_CODE" == "200" ]]; then
    local doc_url
    doc_url=$(json_val "d['data']['document_url']")
    local render_ms
    render_ms=$(json_val "d['data']['render_ms']")
    local resolved_count
    resolved_count=$(json_val "len(d['data']['resolved'])")

    if [[ -n "$doc_url" && "$doc_url" != "None" ]]; then
      # Télécharger le fichier généré
      curl -s -o "$OUTPUT_DIR/$output_filename" \
        -H "Authorization: Bearer $ADMIN_TOKEN" \
        "${BASE_URL}${doc_url}"

      if [[ -f "$OUTPUT_DIR/$output_filename" ]]; then
        local filesize
        filesize=$(wc -c < "$OUTPUT_DIR/$output_filename" | tr -d ' ')
        if [[ "$filesize" -gt 0 ]]; then
          pass "Composition $label (${filesize} octets, ${render_ms}ms, ${resolved_count} fragments)"
        else
          fail "Composition $label" "Fichier de sortie vide"
        fi
      else
        fail "Composition $label" "Téléchargement échoué"
      fi
    else
      fail "Composition $label" "Pas de document_url dans la réponse"
    fi
  else
    fail "Composition $label" "HTTP $HTTP_CODE — $BODY"
  fi
}

# Composer les 4 formats
compose_and_download "tpl-lincloud-slides" "slides" "lincloud-presentation-marp.html" "Marp slides"
compose_and_download "tpl-lincloud-reveal" "reveal" "lincloud-presentation-reveal.html" "reveal.js"
compose_and_download "tpl-lincloud-docx"   "docx"   "lincloud-proposition.docx"          "DOCX"
compose_and_download "tpl-lincloud-xlsx"   "xlsx"   "lincloud-devis.xlsx"                "XLSX"

# =============================================================================
# Étape 7 — Nettoyage (sauf si --keep)
# =============================================================================
echo ""

if [[ "$KEEP_DATA" == "false" ]]; then
  echo "── Étape 7 : Nettoyage ──────────────────────────────────────"

  # Supprimer les templates
  for tpl_id in tpl-lincloud-slides tpl-lincloud-reveal tpl-lincloud-docx tpl-lincloud-xlsx; do
    api DELETE "/v1/templates/$tpl_id" "$ADMIN_TOKEN"
    if [[ "$HTTP_CODE" == "200" ]]; then
      pass "Suppression template $tpl_id"
    else
      fail "Suppression template $tpl_id" "HTTP $HTTP_CODE"
    fi
  done

  # Supprimer la collection (et ses fragments)
  if [[ "$COLLECTION" != "common" ]]; then
    api DELETE "/v1/collections/$COLLECTION" "$ADMIN_TOKEN"
    if [[ "$HTTP_CODE" == "200" ]]; then
      pass "Suppression collection $COLLECTION"
    else
      fail "Suppression collection $COLLECTION" "HTTP $HTTP_CODE"
    fi
  fi
else
  echo "── Étape 7 : Nettoyage ignoré (--keep) ──────────────────────"
  echo "  Les données restent disponibles dans la collection '$COLLECTION'."
  echo "  Templates : tpl-lincloud-slides, tpl-lincloud-reveal, tpl-lincloud-docx, tpl-lincloud-xlsx"
fi

# Nettoyer les fichiers temporaires
rm -rf "$TEMP_DIR"

# ── Résumé ───────────────────────────────────────────────────────────────────
echo ""
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║                      RÉSUMÉ                              ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""
for r in "${RESULTS[@]}"; do
  echo "  $r"
done
echo ""
echo "  ─────────────────────────────────────────────────────────"
echo "  Réussis : $PASS_COUNT"
echo "  Échoués : $FAIL_COUNT"
echo "  Total   : $((PASS_COUNT + FAIL_COUNT))"
echo ""

# Afficher les fichiers générés
if ls "$OUTPUT_DIR"/*.html "$OUTPUT_DIR"/*.docx "$OUTPUT_DIR"/*.xlsx 2>/dev/null | head -1 > /dev/null 2>&1; then
  echo "  Fichiers générés :"
  echo ""
  for f in "$OUTPUT_DIR"/lincloud-*; do
    if [[ -f "$f" ]]; then
      fsize=$(wc -c < "$f" | tr -d ' ')
      fname=$(basename "$f")
      printf "    %-45s %s octets\n" "$fname" "$fsize"
    fi
  done
  echo ""
  echo "  Répertoire de sortie : $OUTPUT_DIR"
fi

echo ""
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║  Pour relancer : bash e2e/demo/run-demo.sh              ║"
echo "║  Avec données  : bash e2e/demo/run-demo.sh --keep       ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""

if [[ "$FAIL_COUNT" -gt 0 ]]; then
  exit 1
fi
exit 0
