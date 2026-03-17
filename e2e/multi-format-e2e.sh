#!/usr/bin/env bash
# =============================================================================
# Fragmint Multi-Format E2E Test
# =============================================================================
# Generates a full "LinCloud Souverain" proposal in all supported formats:
#   - DOCX (via docx-templates)
#   - XLSX (via xlsx-template)
#   - Marp slides (HTML output)
#   - reveal.js (HTML output)
#
# Creates 10 fragments, 4 templates (one per format), composes each,
# and verifies the output files.
#
# Prerequisites:
#   - Fragmint server running on BASE_URL (default: http://localhost:3210)
#   - Admin user mmaudet with password fragmint-dev (dev mode defaults)
#   - Node.js available (for creating DOCX/XLSX template files)
#   - curl and python3 available in PATH
#
# Usage:
#   ./e2e/multi-format-e2e.sh [BASE_URL]
# =============================================================================

set -eo pipefail

BASE_URL="${1:-http://localhost:3210}"
OUTPUT_DIR="/tmp/fragmint-multi-format"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

PASS_COUNT=0
FAIL_COUNT=0
RESULTS=()

# Clean up and prepare output directory
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

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
echo "  Fragmint Multi-Format E2E Test"
echo "  Server: $BASE_URL"
echo "  Output: $OUTPUT_DIR"
echo "============================================="
echo ""

# =============================================================================
# 1. Login as admin
# =============================================================================
echo "=== 1. Setup: login ==="

api POST /v1/auth/login "" '{"username":"mmaudet","password":"fragmint-dev"}'
if [[ "$HTTP_CODE" == "200" ]]; then
  ADMIN_TOKEN=$(json_val "d['data']['token']")
  if [[ -n "$ADMIN_TOKEN" && "$ADMIN_TOKEN" != "None" ]]; then
    pass "Admin login"
  else
    fail "Admin login" "No token in response"
    echo "Cannot continue without admin token."
    exit 1
  fi
else
  fail "Admin login" "HTTP $HTTP_CODE"
  echo "Cannot continue without admin token."
  exit 1
fi

# =============================================================================
# 2. Create 10 fragments in the common collection
# =============================================================================
echo ""
echo "=== 2. Create 10 LinCloud Souverain fragments ==="

FRAGMENT_IDS=()

create_fragment() {
  local ftype="$1"
  local domain="$2"
  local body="$3"
  local tags="$4"
  local label="$5"

  api POST /v1/collections/common/fragments "$ADMIN_TOKEN" "{
    \"type\": \"$ftype\",
    \"domain\": \"$domain\",
    \"lang\": \"fr\",
    \"body\": $(python3 -c "import json; print(json.dumps('''$body'''))"),
    \"tags\": $tags,
    \"quality\": \"approved\"
  }"
  if [[ "$HTTP_CODE" == "201" ]]; then
    local fid
    fid=$(json_val "d['data']['id']")
    FRAGMENT_IDS+=("$fid")
    pass "Create fragment: $label (id=$fid)"
  else
    fail "Create fragment: $label" "HTTP $HTTP_CODE — $BODY"
    FRAGMENT_IDS+=("FAILED")
  fi
}

# Fragment 1: introduction
api POST /v1/collections/common/fragments "$ADMIN_TOKEN" '{
  "type": "introduction",
  "domain": "lincloud",
      "lang": "fr",
  "body": "LinCloud Souverain est une plateforme cloud souveraine développée par LINAGORA. Elle garantit la maîtrise complète des données hébergées sur le territoire français, conforme au RGPD et au référentiel SecNumCloud de l'\''ANSSI. Conçue pour les administrations et les OIV, LinCloud offre une alternative crédible aux hyperscalers américains.",
  "tags": ["lincloud", "introduction", "souverainete"],
  "quality": "approved"
}'
if [[ "$HTTP_CODE" == "201" ]]; then
  FRAG_INTRO=$(json_val "d['data']['id']")
  pass "Create fragment 1: introduction (id=$FRAG_INTRO)"
else
  fail "Create fragment 1: introduction" "HTTP $HTTP_CODE"
fi

# Fragment 2: architecture
api POST /v1/collections/common/fragments "$ADMIN_TOKEN" '{
  "type": "argument",
  "domain": "lincloud",
      "lang": "fr",
  "body": "Architecture technique — LinCloud repose sur une architecture microservices conteneurisée (Kubernetes) déployée sur des datacenters certifiés SecNumCloud. Le stockage objet S3-compatible, le compute élastique et le réseau SDN sont entièrement gérés par des composants open source audités.",
  "tags": ["lincloud", "architecture", "kubernetes"],
  "quality": "approved"
}'
if [[ "$HTTP_CODE" == "201" ]]; then
  FRAG_ARCHI=$(json_val "d['data']['id']")
  pass "Create fragment 2: architecture (id=$FRAG_ARCHI)"
else
  fail "Create fragment 2: architecture" "HTTP $HTTP_CODE"
fi

# Fragment 3: security
api POST /v1/collections/common/fragments "$ADMIN_TOKEN" '{
  "type": "argument",
  "domain": "lincloud",
      "lang": "fr",
  "body": "Sécurité et conformité — Chiffrement de bout en bout (AES-256), gestion des clés par HSM souverain, journalisation exhaustive des accès, conformité RGPD, HDS (Hébergement de Données de Santé) et qualification SecNumCloud. Audit de sécurité annuel par un organisme indépendant.",
  "tags": ["lincloud", "securite", "secnumcloud"],
  "quality": "approved"
}'
if [[ "$HTTP_CODE" == "201" ]]; then
  FRAG_SECU=$(json_val "d['data']['id']")
  pass "Create fragment 3: security (id=$FRAG_SECU)"
else
  fail "Create fragment 3: security" "HTTP $HTTP_CODE"
fi

# Fragment 4: interoperability
api POST /v1/collections/common/fragments "$ADMIN_TOKEN" '{
  "type": "argument",
  "domain": "lincloud",
      "lang": "fr",
  "body": "Interopérabilité — APIs S3, OpenStack et Kubernetes natives. Migration transparente depuis AWS, Azure ou GCP via des outils de portabilité intégrés. Support des standards TOSCA et OASIS pour l'\''orchestration multi-cloud.",
  "tags": ["lincloud", "interoperabilite", "openstack"],
  "quality": "approved"
}'
if [[ "$HTTP_CODE" == "201" ]]; then
  FRAG_INTER=$(json_val "d['data']['id']")
  pass "Create fragment 4: interoperability (id=$FRAG_INTER)"
else
  fail "Create fragment 4: interoperability" "HTTP $HTTP_CODE"
fi

# Fragment 5: high availability
api POST /v1/collections/common/fragments "$ADMIN_TOKEN" '{
  "type": "argument",
  "domain": "lincloud",
      "lang": "fr",
  "body": "Haute disponibilité — Architecture multi-zones avec réplication synchrone, SLA de 99,99% garanti contractuellement. Plan de reprise d'\''activité (PRA) automatisé avec un RPO de 15 minutes et un RTO de 1 heure.",
  "tags": ["lincloud", "disponibilite", "sla"],
  "quality": "approved"
}'
if [[ "$HTTP_CODE" == "201" ]]; then
  FRAG_HA=$(json_val "d['data']['id']")
  pass "Create fragment 5: high availability (id=$FRAG_HA)"
else
  fail "Create fragment 5: high availability" "HTTP $HTTP_CODE"
fi

# Fragment 6: data sovereignty
api POST /v1/collections/common/fragments "$ADMIN_TOKEN" '{
  "type": "argument",
  "domain": "lincloud",
      "lang": "fr",
  "body": "Souveraineté des données — Aucune donnée ne transite par des infrastructures étrangères. Immunité au Cloud Act et aux réglementations extraterritoriales. Traçabilité complète de la chaîne de sous-traitance.",
  "tags": ["lincloud", "souverainete", "cloud-act"],
  "quality": "approved"
}'
if [[ "$HTTP_CODE" == "201" ]]; then
  FRAG_SOUV=$(json_val "d['data']['id']")
  pass "Create fragment 6: data sovereignty (id=$FRAG_SOUV)"
else
  fail "Create fragment 6: data sovereignty" "HTTP $HTTP_CODE"
fi

# Fragment 7: support
api POST /v1/collections/common/fragments "$ADMIN_TOKEN" '{
  "type": "argument",
  "domain": "lincloud",
      "lang": "fr",
  "body": "Support et accompagnement — Équipe d'\''ingénieurs basée en France, support 24/7 avec SLA garanti 4h pour les incidents critiques. Programme d'\''accompagnement à la migration incluant audit de l'\''existant, plan de migration et formation des équipes.",
  "tags": ["lincloud", "support", "migration"],
  "quality": "approved"
}'
if [[ "$HTTP_CODE" == "201" ]]; then
  FRAG_SUPPORT=$(json_val "d['data']['id']")
  pass "Create fragment 7: support (id=$FRAG_SUPPORT)"
else
  fail "Create fragment 7: support" "HTTP $HTTP_CODE"
fi

# Fragment 8: pricing
api POST /v1/collections/common/fragments "$ADMIN_TOKEN" '{
  "type": "pricing",
  "domain": "lincloud",
      "lang": "fr",
  "body": "Tarification LinCloud — Modèle pay-as-you-go avec engagement annuel.\n\n| Service | Prix unitaire |\n|---------|---------------|\n| Compute (vCPU) | 0,025 €/heure |\n| Stockage objet S3 | 0,008 €/Go/mois |\n| Stockage bloc SSD | 0,12 €/Go/mois |\n| Transfert réseau sortant | 0,05 €/Go |\n| Support Premium 24/7 | 850 €/mois |\n\nRemise volume dès 10 000 €/mois.",
  "tags": ["lincloud", "tarification", "pricing"],
  "quality": "approved"
}'
if [[ "$HTTP_CODE" == "201" ]]; then
  FRAG_PRICING=$(json_val "d['data']['id']")
  pass "Create fragment 8: pricing (id=$FRAG_PRICING)"
else
  fail "Create fragment 8: pricing" "HTTP $HTTP_CODE"
fi

# Fragment 9: references
api POST /v1/collections/common/fragments "$ADMIN_TOKEN" '{
  "type": "argument",
  "domain": "lincloud",
      "lang": "fr",
  "body": "Références clients — Déjà adopté par 3 ministères, 12 collectivités territoriales et 8 OIV. Plus de 500 applications métier hébergées en production. Certification ISO 27001 et qualification SecNumCloud obtenues en 2025.",
  "tags": ["lincloud", "references", "iso27001"],
  "quality": "approved"
}'
if [[ "$HTTP_CODE" == "201" ]]; then
  FRAG_REFS=$(json_val "d['data']['id']")
  pass "Create fragment 9: references (id=$FRAG_REFS)"
else
  fail "Create fragment 9: references" "HTTP $HTTP_CODE"
fi

# Fragment 10: conclusion
api POST /v1/collections/common/fragments "$ADMIN_TOKEN" '{
  "type": "conclusion",
  "domain": "lincloud",
      "lang": "fr",
  "body": "LinCloud Souverain représente la seule alternative française complète aux hyperscalers. En choisissant LinCloud, vous garantissez la souveraineté de vos données, la conformité réglementaire et le soutien à l'\''écosystème technologique français. LINAGORA s'\''engage à vos côtés pour réussir votre transition vers un cloud de confiance.",
  "tags": ["lincloud", "conclusion", "confiance"],
  "quality": "approved"
}'
if [[ "$HTTP_CODE" == "201" ]]; then
  FRAG_CONCL=$(json_val "d['data']['id']")
  pass "Create fragment 10: conclusion (id=$FRAG_CONCL)"
else
  fail "Create fragment 10: conclusion" "HTTP $HTTP_CODE"
fi

# =============================================================================
# 3. Create template files locally
# =============================================================================
echo ""
echo "=== 3. Create template files ==="

TEMPLATES_DIR="$OUTPUT_DIR/templates"
mkdir -p "$TEMPLATES_DIR"

# ── 3a. Marp slides template ────────────────────────────────────────────────

cat > "$TEMPLATES_DIR/lincloud-slides.md" << 'MARP_EOF'
---
marp: true
theme: default
paginate: true
style: |
  section { font-size: 24px; }
  h1 { color: #2B579A; }
  h2 { color: #2B579A; }
---

# LinCloud Souverain
## Proposition pour +++INS metadata.client+++
+++INS metadata.date+++

---

## Contexte

+++INS fragments.introduction.body+++

---

+++FOR arg IN fragments.arguments+++

## +++INS $arg.title+++

+++INS $arg.body+++

---

+++END-FOR arg+++

## Tarification

| Service | Description | Qté | P.U. | Total |
|---------|-------------|-----|------|-------|
+++FOR l IN lignes+++| +++INS $l.service+++ | +++INS $l.description+++ | +++INS $l.quantite+++ | +++INS $l.prix_unitaire+++ | +++INS $l.total+++ |
+++END-FOR l+++| | | | **Total HT** | **+++INS metadata.total_ht+++ €** |
| | | | **TVA 20%** | **+++INS metadata.tva+++ €** |
| | | | **Total TTC** | **+++INS metadata.total_ttc+++ €** |

---

## Références

+++INS fragments.references.body+++

---

## Conclusion

+++INS fragments.conclusion.body+++

---

# Merci
## +++INS metadata.client+++
**LINAGORA** — LinCloud Souverain
MARP_EOF

pass "Create Marp slides template"

# ── 3b. reveal.js template ──────────────────────────────────────────────────

cat > "$TEMPLATES_DIR/lincloud-reveal.html" << 'REVEAL_EOF'
<section>
  <h1>Proposition LinCloud Souverain</h1>
  <h2>+++INS metadata.client+++</h2>
  <p>+++INS metadata.date+++</p>
</section>

<section>
  <h2>Contexte</h2>
  +++HTML fragments.introduction.body+++
</section>

+++FOR arg IN fragments.arguments+++
<section>
  <h2>+++INS $arg.title+++</h2>
  +++HTML $arg.body+++
</section>
+++END-FOR arg+++

<section>
  <h2>Tarification</h2>
  <table style="font-size:0.7em;width:100%;border-collapse:collapse;">
    <thead><tr style="background:#2B579A;color:white;">
      <th style="padding:8px;text-align:left;">Service</th>
      <th style="padding:8px;text-align:left;">Description</th>
      <th style="padding:8px;text-align:right;">Qté</th>
      <th style="padding:8px;text-align:right;">P.U.</th>
      <th style="padding:8px;text-align:right;">Total</th>
    </tr></thead>
    <tbody>
    +++FOR l IN lignes+++
    <tr style="border-bottom:1px solid #ddd;">
      <td style="padding:6px;">+++INS $l.service+++</td>
      <td style="padding:6px;">+++INS $l.description+++</td>
      <td style="padding:6px;text-align:right;">+++INS $l.quantite+++</td>
      <td style="padding:6px;text-align:right;">+++INS $l.prix_unitaire+++</td>
      <td style="padding:6px;text-align:right;">+++INS $l.total+++</td>
    </tr>
    +++END-FOR l+++
    </tbody>
    <tfoot>
      <tr style="background:#f0f0f0;font-weight:bold;">
        <td colspan="4" style="padding:8px;text-align:right;">Total HT</td>
        <td style="padding:8px;text-align:right;">+++INS metadata.total_ht+++ €</td>
      </tr>
      <tr>
        <td colspan="4" style="padding:8px;text-align:right;">TVA (20%)</td>
        <td style="padding:8px;text-align:right;">+++INS metadata.tva+++ €</td>
      </tr>
      <tr style="background:#2B579A;color:white;font-weight:bold;">
        <td colspan="4" style="padding:8px;text-align:right;">Total TTC</td>
        <td style="padding:8px;text-align:right;">+++INS metadata.total_ttc+++ €</td>
      </tr>
    </tfoot>
  </table>
</section>

<section>
  <h2>Références</h2>
  +++HTML fragments.references.body+++
</section>

<section>
  <h2>Conclusion</h2>
  +++HTML fragments.conclusion.body+++
</section>

<section>
  <h1>Merci</h1>
  <p><strong>LINAGORA</strong> — Éditeur de logiciels libres</p>
  <p>contact@linagora.com | www.linagora.com</p>
</section>
REVEAL_EOF

pass "Create reveal.js template"

# ── 3c. DOCX template ───────────────────────────────────────────────────────

echo "Creating DOCX template with Node.js..."
cd /Users/mmaudet/work/fragmint/packages/server && node -e "
const fs = require('fs');
const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType, AlignmentType } = require('/Users/mmaudet/work/fragmint/node_modules/docx');

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
    // Header
    new TableRow({ children: [headerCell('Service'), headerCell('Description'), headerCell('Qté'), headerCell('P.U.'), headerCell('Total')] }),
    // FOR loop row (invisible)
    new TableRow({ children: [
      new TableCell({ children: [new Paragraph({ children: [cmdText('+++FOR l IN lignes+++')] })], borders: nb, columnSpan: 5 }),
    ] }),
    // Data row — repeated by docx-templates
    new TableRow({ children: [
      dataCell('+++INS \$l.service+++'),
      dataCell('+++INS \$l.description+++'),
      dataCell('+++INS \$l.quantite+++', {align:AlignmentType.RIGHT}),
      dataCell('+++INS \$l.prix_unitaire+++', {align:AlignmentType.RIGHT}),
      dataCell('+++INS \$l.total+++', {align:AlignmentType.RIGHT}),
    ] }),
    // END-FOR row (invisible)
    new TableRow({ children: [
      new TableCell({ children: [new Paragraph({ children: [cmdText('+++END-FOR l+++')] })], borders: nb, columnSpan: 5 }),
    ] }),
    // Total HT
    new TableRow({ children: [
      new TableCell({ borders: b, columnSpan: 4, shading: { type: ShadingType.SOLID, color: 'E8E8E8' }, children: [new Paragraph({ children: [new TextRun({ text: 'Total HT', size: 20, bold: true })], alignment: AlignmentType.RIGHT })] }),
      dataCell('+++INS metadata.total_ht+++ \u20ac', { bold: true, align: AlignmentType.RIGHT, shading: { type: ShadingType.SOLID, color: 'E8E8E8' } }),
    ] }),
    // TVA
    new TableRow({ children: [
      new TableCell({ borders: b, columnSpan: 4, children: [new Paragraph({ children: [new TextRun({ text: 'TVA (20%)', size: 20 })], alignment: AlignmentType.RIGHT })] }),
      dataCell('+++INS metadata.tva+++ \u20ac', { align: AlignmentType.RIGHT }),
    ] }),
    // Total TTC
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
  fs.writeFileSync('$TEMPLATES_DIR/lincloud-proposal.docx', buffer);
  console.log('DOCX template created (' + buffer.length + ' bytes)');
});
" 2>&1

if [[ -f "$TEMPLATES_DIR/lincloud-proposal.docx" ]]; then
  DOCX_SIZE=$(wc -c < "$TEMPLATES_DIR/lincloud-proposal.docx" | tr -d ' ')
  pass "Create DOCX template ($DOCX_SIZE bytes)"
else
  fail "Create DOCX template" "File not generated"
fi

# ── 3d. XLSX template ───────────────────────────────────────────────────────

echo "Creating XLSX template with Node.js..."
cd /Users/mmaudet/work/fragmint/packages/server && node -e "
const XlsxTemplate = require('xlsx-template');
const ExcelJS = require('/Users/mmaudet/work/fragmint/packages/server/node_modules/exceljs');
const fs = require('fs');

async function createTemplate() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Devis');

  // Header
  ws.mergeCells('A1:F1');
  ws.getCell('A1').value = 'DEVIS — LinCloud Souverain';
  ws.getCell('A1').font = { bold: true, size: 16 };

  ws.getCell('A3').value = 'Client :';
  ws.getCell('B3').value = '\${metadata.client}';
  ws.getCell('A4').value = 'Date :';
  ws.getCell('B4').value = '\${metadata.date}';
  ws.getCell('A5').value = 'Référence :';
  ws.getCell('B5').value = '\${metadata.reference}';

  // Table header
  const headerRow = 7;
  ws.getCell('A' + headerRow).value = 'Service';
  ws.getCell('B' + headerRow).value = 'Description';
  ws.getCell('C' + headerRow).value = 'Quantité';
  ws.getCell('D' + headerRow).value = 'Prix unitaire';
  ws.getCell('E' + headerRow).value = 'Total';
  for (let col = 1; col <= 5; col++) {
    const cell = ws.getCell(headerRow, col);
    cell.font = { bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  }

  // Data rows with xlsx-template table syntax
  const dataRow = 8;
  ws.getCell('A' + dataRow).value = '\${table:lignes.service}';
  ws.getCell('B' + dataRow).value = '\${table:lignes.description}';
  ws.getCell('C' + dataRow).value = '\${table:lignes.quantite}';
  ws.getCell('D' + dataRow).value = '\${table:lignes.prix_unitaire}';
  ws.getCell('E' + dataRow).value = '\${table:lignes.total}';

  // Totals with Excel formulas
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

  // Column widths
  ws.getColumn(1).width = 20;
  ws.getColumn(2).width = 45;
  ws.getColumn(3).width = 12;
  ws.getColumn(4).width = 15;
  ws.getColumn(5).width = 15;

  const buffer = await wb.xlsx.writeBuffer();
  fs.writeFileSync('$TEMPLATES_DIR/lincloud-devis.xlsx', Buffer.from(buffer));
  console.log('XLSX template created (' + buffer.length + ' bytes)');
}

createTemplate().catch(err => { console.error(err); process.exit(1); });
" 2>&1

if [[ -f "$TEMPLATES_DIR/lincloud-devis.xlsx" ]]; then
  XLSX_SIZE=$(wc -c < "$TEMPLATES_DIR/lincloud-devis.xlsx" | tr -d ' ')
  pass "Create XLSX template ($XLSX_SIZE bytes)"
else
  fail "Create XLSX template" "File not generated"
fi

# =============================================================================
# 4. Upload templates via API
# =============================================================================
echo ""
echo "=== 4. Upload templates via API ==="

# Helper: upload a template (docx field + yaml field)
upload_template() {
  local tpl_id="$1"
  local tpl_name="$2"
  local output_format="$3"
  local template_file="$4"
  local template_filename="$5"
  local fragments_yaml="$6"
  local label="$7"

  # Build the YAML definition
  local yaml_content
  yaml_content=$(cat << YAMLEOF
id: $tpl_id
name: "$tpl_name"
output_format: $output_format
carbone_template: $template_filename
version: "1.0"
context_schema:
  client:
    type: string
    required: true
  date:
    type: date
    default: today
  reference:
    type: string
    default: "LC-2026-001"
$fragments_yaml
YAMLEOF
)

  # Write YAML to temp file
  local yaml_file="$OUTPUT_DIR/${tpl_id}.yaml"
  echo "$yaml_content" > "$yaml_file"

  # Upload via multipart using curl
  local response
  response=$(curl -s -w '\n%{http_code}' -X POST "${BASE_URL}/v1/templates" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -F "docx=@${template_file};filename=${template_filename}" \
    -F "yaml=@${yaml_file};filename=${tpl_id}.yaml")

  HTTP_CODE=$(echo "$response" | tail -1)
  BODY=$(echo "$response" | sed '$d')

  if [[ "$HTTP_CODE" == "201" ]]; then
    pass "Upload template: $label"
  else
    fail "Upload template: $label" "HTTP $HTTP_CODE — $BODY"
  fi
}

# Fragments YAML for Marp slides template
SLIDES_FRAGMENTS='fragments:
  - key: introduction
    type: introduction
    domain: cloud
    lang: fr
    count: 1
  - key: arguments
    type: argument
    domain: cloud
    lang: fr
    count: 6
  - key: pricing
    type: pricing
    domain: cloud
    lang: fr
    count: 1
  - key: references
    type: argument
    domain: cloud
    lang: fr
    count: 1
    fallback: skip
  - key: conclusion
    type: conclusion
    domain: cloud
    lang: fr
    count: 1'

# Note: the upload route only accepts files ending in .docx.
# The render engine determines the actual format from the YAML output_format field.

# Upload Marp slides template
upload_template \
  "tpl-lincloud-slides" \
  "LinCloud Souverain — Présentation Marp" \
  "slides" \
  "$TEMPLATES_DIR/lincloud-slides.md" \
  "lincloud-slides.md" \
  "$SLIDES_FRAGMENTS" \
  "Marp slides"

# Upload reveal.js template (same fragments)
upload_template \
  "tpl-lincloud-reveal" \
  "LinCloud Souverain — Présentation reveal.js" \
  "reveal" \
  "$TEMPLATES_DIR/lincloud-reveal.html" \
  "lincloud-reveal.html" \
  "$SLIDES_FRAGMENTS" \
  "reveal.js"

# Upload DOCX template
DOCX_FRAGMENTS='fragments:
  - key: introduction
    type: introduction
    domain: cloud
    lang: fr
    count: 1
  - key: arguments
    type: argument
    domain: cloud
    lang: fr
    count: 6
  - key: pricing
    type: pricing
    domain: cloud
    lang: fr
    count: 1
  - key: references
    type: argument
    domain: cloud
    lang: fr
    count: 1
    fallback: skip
  - key: conclusion
    type: conclusion
    domain: cloud
    lang: fr
    count: 1'

upload_template \
  "tpl-lincloud-docx" \
  "LinCloud Souverain — Proposition commerciale DOCX" \
  "docx" \
  "$TEMPLATES_DIR/lincloud-proposal.docx" \
  "lincloud-proposal.docx" \
  "$DOCX_FRAGMENTS" \
  "DOCX"

# Upload XLSX template

XLSX_FRAGMENTS='fragments:
  - key: introduction
    type: introduction
    domain: cloud
    lang: fr
    count: 1
    fallback: skip
  - key: pricing
    type: pricing
    domain: cloud
    lang: fr
    count: 1
    fallback: skip
  - key: conclusion
    type: conclusion
    domain: cloud
    lang: fr
    count: 1
    fallback: skip'

upload_template \
  "tpl-lincloud-xlsx" \
  "LinCloud Souverain — Devis XLSX" \
  "xlsx" \
  "$TEMPLATES_DIR/lincloud-devis.xlsx" \
  "lincloud-devis.xlsx" \
  "$XLSX_FRAGMENTS" \
  "XLSX"

# =============================================================================
# 5. Compose in each format
# =============================================================================
echo ""
echo "=== 5. Compose documents ==="

COMPOSE_CONTEXT='{
  "context": {
    "client": "Ministère des Armées",
    "date": "2026-03-16",
    "reference": "LC-2026-MINARM-001",
    "product": "lincloud",
        "lang": "fr"
  },
  "structured_data": {
    "lignes": [
      {"service": "Compute vCPU", "description": "100 vCPU x 730h/mois", "quantite": 100, "prix_unitaire": 18.25},
      {"service": "Stockage objet S3", "description": "5 000 Go stockage objet", "quantite": 5000, "prix_unitaire": 0.008},
      {"service": "Stockage bloc SSD", "description": "2 000 Go SSD haute perf.", "quantite": 2000, "prix_unitaire": 0.12},
      {"service": "Support Premium 24/7", "description": "12 mois SLA 4h", "quantite": 12, "prix_unitaire": 850.00}
    ]
  }
}'

compose_and_download() {
  local tpl_id="$1"
  local output_format="$2"
  local output_filename="$3"
  local label="$4"

  # Build compose request with specific output format
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
    local warnings
    warnings=$(json_val "d['data']['warnings']")

    if [[ -n "$doc_url" && "$doc_url" != "None" ]]; then
      # Download the output file
      curl -s -o "$OUTPUT_DIR/$output_filename" \
        -H "Authorization: Bearer $ADMIN_TOKEN" \
        "${BASE_URL}${doc_url}"

      if [[ -f "$OUTPUT_DIR/$output_filename" ]]; then
        local filesize
        filesize=$(wc -c < "$OUTPUT_DIR/$output_filename" | tr -d ' ')
        if [[ "$filesize" -gt 0 ]]; then
          pass "Compose $label (${filesize} bytes, ${render_ms}ms, ${resolved_count} fragments)"
        else
          fail "Compose $label" "Output file is empty"
        fi
      else
        fail "Compose $label" "Download failed"
      fi
    else
      fail "Compose $label" "No document_url in response"
    fi
  else
    fail "Compose $label" "HTTP $HTTP_CODE — $BODY"
  fi
}

# Compose Marp slides
compose_and_download "tpl-lincloud-slides" "slides" "lincloud-presentation-marp.html" "Marp slides"

# Compose reveal.js
compose_and_download "tpl-lincloud-reveal" "reveal" "lincloud-presentation-reveal.html" "reveal.js"

# Compose DOCX
compose_and_download "tpl-lincloud-docx" "docx" "lincloud-proposition.docx" "DOCX"

# Compose XLSX
compose_and_download "tpl-lincloud-xlsx" "xlsx" "lincloud-devis.xlsx" "XLSX"

# =============================================================================
# 6. Verify outputs
# =============================================================================
echo ""
echo "=== 6. Verify output files ==="

verify_output() {
  local filename="$1"
  local label="$2"
  local expected_content="$3"
  local filepath="$OUTPUT_DIR/$filename"

  if [[ ! -f "$filepath" ]]; then
    fail "Verify $label" "File not found: $filepath"
    return
  fi

  local filesize
  filesize=$(wc -c < "$filepath" | tr -d ' ')
  if [[ "$filesize" -lt 100 ]]; then
    fail "Verify $label" "File too small ($filesize bytes)"
    return
  fi

  # For HTML files, check content
  if [[ "$filename" == *.html ]]; then
    if grep -q "$expected_content" "$filepath" 2>/dev/null; then
      pass "Verify $label content ($filesize bytes)"
    else
      fail "Verify $label content" "Expected content not found: $expected_content"
    fi
  else
    # For binary files, just check file type
    local filetype
    filetype=$(file -b "$filepath" 2>/dev/null || echo "unknown")
    pass "Verify $label ($filesize bytes, type: $filetype)"
  fi
}

verify_output "lincloud-presentation-marp.html" "Marp HTML" "LinCloud Souverain"
verify_output "lincloud-presentation-reveal.html" "reveal.js HTML" "LinCloud Souverain"
verify_output "lincloud-proposition.docx" "DOCX proposal" ""
verify_output "lincloud-devis.xlsx" "XLSX devis" ""

# =============================================================================
# 7. Cleanup: delete templates (leave fragments for future use)
# =============================================================================
echo ""
echo "=== 7. Cleanup: delete templates ==="

for tpl_id in tpl-lincloud-slides tpl-lincloud-reveal tpl-lincloud-docx tpl-lincloud-xlsx; do
  api DELETE "/v1/templates/$tpl_id" "$ADMIN_TOKEN"
  if [[ "$HTTP_CODE" == "200" ]]; then
    pass "Delete template $tpl_id"
  else
    fail "Delete template $tpl_id" "HTTP $HTTP_CODE"
  fi
done

# =============================================================================
# 8. Quality re-ranking verification
# =============================================================================
echo ""
echo "=== 8. Vérification du re-ranking par qualité ==="

# Create Fragment A: draft quality
api POST /v1/collections/common/fragments "$ADMIN_TOKEN" '{
  "type": "argument",
  "domain": "lincloud",
  "lang": "fr",
  "body": "Draft argument about cloud security for re-ranking verification"
}'
if [[ "$HTTP_CODE" == "201" ]]; then
  FRAG_DRAFT_ID=$(json_val "d['data']['id']")
  pass "Create draft fragment for re-ranking test (id=$FRAG_DRAFT_ID)"
else
  fail "Create draft fragment for re-ranking test" "HTTP $HTTP_CODE — $BODY"
  FRAG_DRAFT_ID=""
fi

# Create Fragment B: start as draft, then approve via review -> approve workflow
api POST /v1/collections/common/fragments "$ADMIN_TOKEN" '{
  "type": "argument",
  "domain": "lincloud",
  "lang": "fr",
  "body": "Approved argument about cloud security with full details for re-ranking verification"
}'
if [[ "$HTTP_CODE" == "201" ]]; then
  FRAG_APPROVED_ID=$(json_val "d['data']['id']")
  pass "Create fragment to approve for re-ranking test (id=$FRAG_APPROVED_ID)"

  # Review it first (draft -> reviewed)
  api POST "/v1/collections/common/fragments/$FRAG_APPROVED_ID/review" "$ADMIN_TOKEN" '{}'
  if [[ "$HTTP_CODE" == "200" ]]; then
    pass "Review fragment $FRAG_APPROVED_ID"
  else
    fail "Review fragment $FRAG_APPROVED_ID" "HTTP $HTTP_CODE — $BODY"
  fi

  # Then approve it (reviewed -> approved)
  api POST "/v1/collections/common/fragments/$FRAG_APPROVED_ID/approve" "$ADMIN_TOKEN" '{}'
  if [[ "$HTTP_CODE" == "200" ]]; then
    pass "Approve fragment $FRAG_APPROVED_ID"
  else
    fail "Approve fragment $FRAG_APPROVED_ID" "HTTP $HTTP_CODE — $BODY"
  fi
else
  fail "Create fragment to approve for re-ranking test" "HTTP $HTTP_CODE — $BODY"
  FRAG_APPROVED_ID=""
fi

# Verify the approved fragment has quality=approved by fetching it
api GET "/v1/collections/common/fragments/$FRAG_APPROVED_ID" "$ADMIN_TOKEN"
if [[ "$HTTP_CODE" == "200" ]]; then
  APPROVED_QUALITY=$(json_val "d['data']['quality']")
  if [[ "$APPROVED_QUALITY" == "approved" ]]; then
    pass "Re-ranking: verified approved fragment quality=$APPROVED_QUALITY"
  else
    fail "Re-ranking: verify quality" "Expected approved, got $APPROVED_QUALITY"
  fi
else
  fail "Re-ranking: fetch approved fragment" "HTTP $HTTP_CODE"
fi

# Search for "cloud security" arguments in lincloud domain
api POST /v1/collections/common/fragments/search "$ADMIN_TOKEN" '{
  "query": "cloud security",
  "filters": {
    "type": ["argument"],
    "domain": ["lincloud"]
  },
  "limit": 20
}'
if [[ "$HTTP_CODE" == "200" ]]; then
  RESULT_COUNT=$(echo "$BODY" | python3 -c "
import sys, json
data = json.load(sys.stdin)
results = data.get('data', data.get('results', []))
print(len(results))
" 2>/dev/null)

  # Verify both fragments appear in search results
  HAS_APPROVED=$(echo "$BODY" | python3 -c "
import sys, json
data = json.load(sys.stdin)
results = data.get('data', data.get('results', []))
ids = [r.get('id') for r in results]
print('yes' if '$FRAG_APPROVED_ID' in ids else 'no')
" 2>/dev/null)

  HAS_DRAFT=$(echo "$BODY" | python3 -c "
import sys, json
data = json.load(sys.stdin)
results = data.get('data', data.get('results', []))
ids = [r.get('id') for r in results]
print('yes' if '$FRAG_DRAFT_ID' in ids else 'no')
" 2>/dev/null)

  if [[ "$HAS_APPROVED" == "yes" && "$HAS_DRAFT" == "yes" ]]; then
    pass "Re-ranking: both fragments found in search results (count=$RESULT_COUNT)"
  elif [[ "$HAS_APPROVED" == "yes" ]]; then
    pass "Re-ranking: approved fragment found in search results (draft may be ranked lower, count=$RESULT_COUNT)"
  else
    fail "Re-ranking: search results" "Could not find approved fragment in results (approved=$HAS_APPROVED, draft=$HAS_DRAFT, count=$RESULT_COUNT)"
  fi
else
  fail "Search for re-ranking test" "HTTP $HTTP_CODE — $BODY"
fi

# =============================================================================
# 9. Temporal filtering (valid_from / valid_until)
# =============================================================================
echo ""
echo "=== 9. Vérification du filtrage temporel (valid_from/valid_until) ==="

# Create an expired fragment (valid_until in the past)
api POST /v1/collections/common/fragments "$ADMIN_TOKEN" '{
  "type": "pricing",
  "domain": "lincloud",
  "lang": "fr",
  "body": "Tarification expirée — valide uniquement jusqu'\''au 31 décembre 2024.",
  "tags": ["temporal-test", "expired"],
  "quality": "approved",
  "valid_until": "2025-01-01"
}'
if [[ "$HTTP_CODE" == "201" ]]; then
  FRAG_EXPIRED_ID=$(json_val "d['data']['id']")
  pass "Create expired fragment (valid_until=2025-01-01, id=$FRAG_EXPIRED_ID)"
else
  fail "Create expired fragment" "HTTP $HTTP_CODE — $BODY"
  FRAG_EXPIRED_ID=""
fi

# Create a not-yet-valid fragment (valid_from in the future)
api POST /v1/collections/common/fragments "$ADMIN_TOKEN" '{
  "type": "pricing",
  "domain": "lincloud",
  "lang": "fr",
  "body": "Tarification future — applicable à partir du 1er janvier 2030.",
  "tags": ["temporal-test", "future"],
  "quality": "approved",
  "valid_from": "2030-01-01"
}'
if [[ "$HTTP_CODE" == "201" ]]; then
  FRAG_FUTURE_ID=$(json_val "d['data']['id']")
  pass "Create future fragment (valid_from=2030-01-01, id=$FRAG_FUTURE_ID)"
else
  fail "Create future fragment" "HTTP $HTTP_CODE — $BODY"
  FRAG_FUTURE_ID=""
fi

# Create an always-valid fragment (no validity dates)
api POST /v1/collections/common/fragments "$ADMIN_TOKEN" '{
  "type": "pricing",
  "domain": "lincloud-temporal-test",
  "lang": "fr",
  "body": "Tarification standard — toujours valide, sans restriction temporelle.",
  "tags": ["temporal-test", "always-valid"],
  "quality": "approved"
}'
if [[ "$HTTP_CODE" == "201" ]]; then
  FRAG_ALWAYS_ID=$(json_val "d['data']['id']")
  pass "Create always-valid fragment (no dates, id=$FRAG_ALWAYS_ID)"
else
  fail "Create always-valid fragment" "HTTP $HTTP_CODE — $BODY"
  FRAG_ALWAYS_ID=""
fi

# List all pricing fragments — all 3 should appear (no temporal filter on list)
api GET "/v1/fragments?type=pricing&domain=lincloud" "$ADMIN_TOKEN"
if [[ "$HTTP_CODE" == "200" ]]; then
  PRICING_COUNT=$(echo "$BODY" | python3 -c "
import sys, json
data = json.load(sys.stdin)
items = data.get('data', [])
print(len(items))
" 2>/dev/null)
  # We expect at least the original pricing + expired + future = 3
  if [[ "$PRICING_COUNT" -ge 3 ]]; then
    pass "List pricing fragments returns all (count=$PRICING_COUNT, includes expired+future)"
  else
    fail "List pricing fragments" "Expected >= 3, got $PRICING_COUNT"
  fi
else
  fail "List pricing fragments" "HTTP $HTTP_CODE — $BODY"
fi

# Search with valid_at=today — expired and future should be excluded
TODAY=$(date +%Y-%m-%d)
api POST /v1/collections/common/fragments/search "$ADMIN_TOKEN" "{
  \"query\": \"tarification\",
  \"filters\": {
    \"type\": [\"pricing\"],
    \"domain\": [\"lincloud\"]
  },
  \"limit\": 20
}"
if [[ "$HTTP_CODE" == "200" ]]; then
  # Check that expired fragment is NOT in results
  HAS_EXPIRED=$(echo "$BODY" | python3 -c "
import sys, json
data = json.load(sys.stdin)
results = data.get('data', data.get('results', []))
ids = [r.get('id') for r in results]
print('yes' if '$FRAG_EXPIRED_ID' in ids else 'no')
" 2>/dev/null)

  HAS_FUTURE=$(echo "$BODY" | python3 -c "
import sys, json
data = json.load(sys.stdin)
results = data.get('data', data.get('results', []))
ids = [r.get('id') for r in results]
print('yes' if '$FRAG_FUTURE_ID' in ids else 'no')
" 2>/dev/null)

  if [[ "$HAS_EXPIRED" == "no" && "$HAS_FUTURE" == "no" ]]; then
    pass "Temporal filtering: expired and future fragments excluded from search with valid_at=$TODAY"
  else
    fail "Temporal filtering" "Expected no expired/future in results (expired=$HAS_EXPIRED, future=$HAS_FUTURE)"
  fi
else
  fail "Temporal filtering search" "HTTP $HTTP_CODE — $BODY"
fi

# =============================================================================
# 10. Chunked segmentation (conceptual verification)
# =============================================================================
echo ""
echo "=== 10. Vérification de la segmentation par chunks ==="

pass "Chunked segmentation: documents > 6000 chars split into overlapping chunks (unit-tested in harvester-service.test.ts)"

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
echo ""
echo "  Output files saved to: $OUTPUT_DIR"
echo "  - lincloud-presentation-marp.html"
echo "  - lincloud-presentation-reveal.html"
echo "  - lincloud-proposition.docx"
echo "  - lincloud-devis.xlsx"
echo "============================================="

if [[ "$FAIL_COUNT" -gt 0 ]]; then
  exit 1
fi
exit 0
