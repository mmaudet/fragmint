# Fragmint E2E Tests

## collections-e2e.sh

End-to-end test for the collections workflow. Validates multi-tenant fragment isolation, access control, and cross-collection composition.

### Prerequisites

- Fragmint server running in dev mode (`pnpm dev` or equivalent)
- Default admin user `mmaudet` / `fragmint-dev`
- `curl` and `python3` available in PATH

### Usage

```bash
# Against default local server (http://localhost:3737)
./e2e/collections-e2e.sh

# Against a custom URL
./e2e/collections-e2e.sh http://localhost:4000
```

### Test Scenario

| # | Test | Description |
|---|------|-------------|
| 1 | Admin login | Authenticate as mmaudet |
| 2 | Create user | Create jdupont (contributor role) |
| 3 | Common collection | Verify the system 'common' collection exists |
| 4 | Create team collection | Create 'projet-anfsi' team collection |
| 5 | Access denied | jdupont cannot access projet-anfsi (no membership) |
| 6 | Add member | Add jdupont as contributor to projet-anfsi |
| 7 | Access granted | jdupont can now access projet-anfsi |
| 8 | Create fragment | jdupont creates a fragment in projet-anfsi |
| 9 | Fragment visible | Fragment appears in projet-anfsi listing |
| 10 | Fragment isolated | Fragment does NOT appear in common listing |
| 11 | Backward compat | GET /v1/fragments still works (no collection filter) |
| 12 | Isolation count | projet-anfsi has exactly 1 fragment |
| 13 | Common fragment | Admin creates a fragment in common |
| 14 | Cross-collection | Fragments from both collections accessible by ID; each stays in its own collection listing |
| 15 | Revoke access | Remove jdupont from projet-anfsi; access denied |
| 16 | Common preserved | jdupont retains access to common collection |

### Exit Code

- `0` — all tests passed
- `1` — one or more tests failed

---

## multi-format-e2e.sh

End-to-end test for multi-format document generation. Creates a complete "LinCloud Souverain" sovereign cloud proposal and renders it in all supported formats: DOCX, XLSX, Marp slides (HTML), and reveal.js (HTML).

### Prerequisites

- Fragmint server running on port 3210 (or custom URL)
- Default admin user `mmaudet` / `fragmint-dev`
- `curl`, `python3`, and `node` available in PATH
- npm packages `docx` and `exceljs` installed (workspace root)

### Usage

```bash
# Against default local server (http://localhost:3210)
./e2e/multi-format-e2e.sh

# Against a custom URL
./e2e/multi-format-e2e.sh http://localhost:4000
```

### Test Scenario

| Phase | Description |
|-------|-------------|
| 1. Login | Authenticate as admin |
| 2. Create fragments | Create 10 fragments for a fictional "LinCloud Souverain" cloud platform (introduction, 6 arguments, pricing, references, conclusion) |
| 3. Create templates | Generate template files locally: Marp (.md), reveal.js (.html), DOCX (.docx via `docx` npm), XLSX (.xlsx via `exceljs`) |
| 4. Upload templates | Upload all 4 templates via multipart POST to `/v1/templates` |
| 5. Compose | POST `/v1/templates/:id/compose` for each format, download output files |
| 6. Verify | Check output files exist, are non-empty, and contain expected content (for HTML formats) |
| 7. Cleanup | Delete templates via API |

### Output Files

Generated files are saved to `/tmp/fragmint-multi-format/` for manual inspection:
- `lincloud-presentation-marp.html` — Marp slide deck
- `lincloud-presentation-reveal.html` — reveal.js presentation
- `lincloud-proposition.docx` — Word proposal document
- `lincloud-devis.xlsx` — Excel pricing spreadsheet

### Exit Code

- `0` — all tests passed
- `1` — one or more tests failed

---

## Demo LinCloud Souverain

Un scenario complet de demonstration est disponible dans `demo/`. Il cree 10 fragments, 4 templates, et genere des documents dans tous les formats supportes.

```bash
bash e2e/demo/run-demo.sh
```

Le script accepte une URL de serveur en argument et l'option `--keep` pour conserver les donnees apres execution :

```bash
bash e2e/demo/run-demo.sh http://localhost:3210 --keep
```

Voir `demo/README.md` pour les details.
