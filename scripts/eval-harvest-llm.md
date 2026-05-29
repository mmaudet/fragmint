# LLM Harvest Eval — Manual Procedure

## Prerequisites
- Running server (`docker compose -f docker/docker-compose.dev.yml up`)
- A Linagora product document (e.g., LinShare datasheet.docx)

## Steps

1. Export current candidates (before changes):
   ```bash
   docker exec fragmint-server node -e "
     const db = require('better-sqlite3')('/data/vault/.fragmint.db');
     const rows = db.prepare('SELECT id,domain,type,lang,confidence,source_section FROM harvest_candidates WHERE status=?').all('pending');
     console.log(JSON.stringify(rows,null,2));
   " > /tmp/before.json
   ```

2. Upload the test document via API:
   ```bash
   curl -X POST http://localhost:3210/v1/harvest \
     -H "Authorization: Bearer YOUR_TOKEN" \
     -F "files=@linshare-datasheet.docx" \
     -F 'hints={"domain":"linshare"}'
   ```

3. Export after:
   ```bash
   # Same command → /tmp/after.json
   ```

4. Compare metrics:
   - **Recall**: Did all expected sections appear as candidates?
   - **Domain accuracy**: % of blocks with correct domain (vs golden expectation)
   - **Chunk count**: Did semantic chunking reduce chunk count?
   - **Junk filtered**: Count of status≠pending blocks (junky filtered)
   - **source_section_fill_rate**: % of candidates where `source_section` is non-null (target ≥ 80% for structured documents)

## Golden expectations for LinShare datasheet
- Expected blocks: ≥ 5 (introduction, features, methodology, use-case, reference)
- Expected domains: all "linshare" (not "logiciels-libres")
- Expected: NO domain override when hint is set — blocks about other products stay correct
- Expected junk rate: 0 (all junky separators/TOC filtered)

## New pipeline features to verify

After completing Tasks 1–9, manually verify the following with a real document:

### Semantic chunker — source_section
1. Upload a document with clear H2 sections (e.g., "## Installation", "## Configuration").
2. Query the pending candidates:
   ```bash
   docker exec fragmint-server node -e "
     const db = require('better-sqlite3')('/data/vault/.fragmint.db');
     const rows = db.prepare('SELECT id, source_section FROM harvest_candidates WHERE status=?').all('pending');
     console.log(JSON.stringify(rows, null, 2));
   "
   ```
3. **Expected**: `source_section` is non-null for candidates from named sections (e.g., `"Installation"`).

### Junkiness filter
1. Upload a document that contains separator-only pages (lines of `---` or `***` with no other content).
2. Query pending candidates as above.
3. **Expected**: Candidates whose body is only a separator line are absent (0 candidates for that page).

### L1/L2/L3 dedup — near-duplicate passages
1. Upload a document that repeats the same paragraph verbatim (or near-verbatim) in two sections.
2. Check the candidate count for that passage.
3. **Expected**: Only 1 candidate survives, not 2. The deduplicated entry's `dedup_of` field should be non-null.

### Hints (fixed) — domain does not override all blocks
1. Upload a document about two different products (e.g., LinShare + Twake) with `hints={"domain":"linshare"}`.
2. Check candidate domains.
3. **Expected**: Blocks that clearly discuss Twake keep `domain="twake"`, not `"linshare"`.

---

## Threshold calibration (after Task 7)

Test L3 cosine thresholds 0.80 / 0.85 / 0.90:
- Upload same document twice
- Count duplicates detected at each threshold
- Choose threshold that catches true duplicates without false positives (target recall ≥ 0.7)
