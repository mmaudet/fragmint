#!/usr/bin/env python3
"""
Migration 2026-06-09 — Tags Twake vault
Applies tag additions and type fixes to Twake fragment files and SQLite DB.
"""
import re
import os
import sqlite3
import json
import glob
import shutil
import yaml

VAULT = os.path.join(os.path.dirname(__file__), '..', 'example-vault')
FRAGMENTS_DIR = os.path.join(VAULT, 'fragments')
DB_PATH = os.path.join(VAULT, '.fragmint.db')

FRONTMATTER_RE = re.compile(r'^---\n(.*?)\n---\n(.*)', re.DOTALL)

changes_summary = []


def parse_file(path):
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    m = FRONTMATTER_RE.match(content)
    if not m:
        raise ValueError(f"No frontmatter found in {path}")
    fm_str, body = m.group(1), m.group(2)
    fm = yaml.safe_load(fm_str)
    return fm, body


def write_file(path, fm, body):
    fm_str = yaml.dump(fm, allow_unicode=True, default_flow_style=False, sort_keys=False)
    content = f"---\n{fm_str}---\n{body}"
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)


def add_tag(fm, tag):
    tags = fm.get('tags') or []
    if tag not in tags:
        tags = list(tags) + [tag]
        fm['tags'] = tags
        return True
    return False


def db_update_tags(conn, frag_id, tags):
    conn.execute(
        "UPDATE fragments SET tags = ? WHERE id = ?",
        (json.dumps(tags, ensure_ascii=False), frag_id)
    )


def db_update_type_and_tags(conn, frag_id, new_type, tags):
    conn.execute(
        "UPDATE fragments SET type = ?, tags = ? WHERE id = ?",
        (new_type, json.dumps(tags, ensure_ascii=False), frag_id)
    )


# ─────────────────────────────────────────────
# GROUP 1: Add produit:twake-workplace to non-tabular twake fragments
# ─────────────────────────────────────────────

GROUP1 = [
    ("argument-twake-fr-930107ab.md",      "frag-cf3f4ed6"),
    ("argument-twake-fr-06f84529.md",      "frag-e40cb7b4"),
    ("argument-twake-fr-75bf3f4b.md",      "frag-389088b4"),   # also has twake-workplace (keep it)
    ("argument-twake-fr-16f1043c.md",      "frag-3b4b6ffb"),
    ("argument-twake-fr-9437f39e.md",      "frag-72c44a42"),
    ("argument-twake-fr-e592ac5f.md",      "frag-af77ff2c"),
    ("argument-twake-fr-350359b8.md",      "frag-bd68e08a"),
    ("argument-twake-fr-5aec5f52.md",      "frag-2ba23980"),
    ("introduction-twake-fr-498e9125.md",  "frag-a1267e91"),
    ("methodology-twake-fr-28d3f185.md",   "frag-c79f0504"),
    ("methodology-twake-fr-de5866dc.md",   "frag-3a08cc26"),
    ("methodology-twake-fr-285487ce.md",   "frag-bc7a0788"),
    ("methodology-twake-fr-a9f95c9e.md",   "frag-22f09f4c"),
    ("methodology-twake-fr-4cd68c79.md",   "frag-23e1a40e"),
    ("reference-twake-fr-9ab58b2a.md",     "frag-0faaa74b"),
    ("reference-twake-fr-ebfbd823.md",     "frag-642faad8"),
    ("reference-twake-fr-30c5f41f.md",     "frag-48755717"),
]

# ─────────────────────────────────────────────
# GROUP 3: Add référentiels to RGESN reference fragments
# ─────────────────────────────────────────────

GROUP3 = [
    ("reference-twake-fr-9bd7d31e.md",  "frag-0521b330"),
    ("reference-twake-fr-ff398f55.md",  "frag-f5fadc13"),
    ("reference-twake-fr-6bac28ae.md",  "frag-26416345"),
    ("reference-twake-fr-af55b675.md",  "frag-eeb8a326"),
    ("reference-twake-fr-b5435c7b.md",  "frag-595a976a"),
    ("reference-twake-fr-ae4cb396.md",  "frag-bbb6d8a9"),
]

# ─────────────────────────────────────────────
# GROUP 4: pricing → reference + tags for competency matrix fragments
# ─────────────────────────────────────────────

GROUP4 = [
    ("pricing-twake-fr-f237a448.md",  "reference-twake-fr-f237a448.md",  "frag-20b2b9f5"),
    ("pricing-twake-fr-d4a33770.md",  "reference-twake-fr-d4a33770.md",  "frag-0ff0dfb7"),
    ("pricing-twake-fr-32cd020e.md",  "reference-twake-fr-32cd020e.md",  "frag-511aaf94"),
    ("pricing-twake-fr-78f443a2.md",  "reference-twake-fr-78f443a2.md",  "frag-8ad37f37"),
    ("pricing-twake-fr-702aef33.md",  "reference-twake-fr-702aef33.md",  "frag-a83b087c"),
]


def find_fragment_by_id_prefix(conn, id_prefix):
    """Find full fragment ID in DB using prefix match."""
    rows = conn.execute(
        "SELECT id FROM fragments WHERE id LIKE ?",
        (id_prefix + '%',)
    ).fetchall()
    if len(rows) == 1:
        return rows[0][0]
    elif len(rows) == 0:
        return None
    else:
        # Return first match — IDs should be unique by prefix
        return rows[0][0]


def main():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    print("=" * 60)
    print("Migration 2026-06-09 — Twake vault tags")
    print("=" * 60)

    # ─── GROUP 1 ───
    print("\n[GROUP 1] Adding produit:twake-workplace to non-tabular twake fragments")
    g1_changed = 0
    for filename, id_prefix in GROUP1:
        path = os.path.join(FRAGMENTS_DIR, filename)
        if not os.path.exists(path):
            print(f"  SKIP (not found): {filename}")
            continue
        fm, body = parse_file(path)
        changed = add_tag(fm, 'produit:twake-workplace')
        if changed:
            write_file(path, fm, body)
            full_id = find_fragment_by_id_prefix(conn, id_prefix)
            if full_id:
                db_update_tags(conn, full_id, fm['tags'])
                print(f"  PATCHED: {filename} (db id: {full_id})")
            else:
                print(f"  PATCHED file only (no db match): {filename}")
            changes_summary.append(('group1', filename, id_prefix, 'added produit:twake-workplace'))
            g1_changed += 1
        else:
            print(f"  SKIP (already has tag): {filename}")
    print(f"  → {g1_changed} files patched")

    # ─── GROUP 2 ───
    print("\n[GROUP 2] Adding 'performance' to engagement tabular fragments")
    engagement_files = sorted(glob.glob(os.path.join(FRAGMENTS_DIR, 'engagement-twake-fr-*.md')))
    g2_changed = 0
    for path in engagement_files:
        fm, body = parse_file(path)
        changed = add_tag(fm, 'performance')
        if changed:
            write_file(path, fm, body)
            frag_id = fm.get('id', '')
            if frag_id:
                id_prefix = frag_id[:12]  # e.g. frag-e22216ee
                full_id = find_fragment_by_id_prefix(conn, id_prefix)
                if full_id:
                    db_update_tags(conn, full_id, fm['tags'])
            filename = os.path.basename(path)
            print(f"  PATCHED: {filename}")
            changes_summary.append(('group2', filename, frag_id, 'added performance'))
            g2_changed += 1
        else:
            filename = os.path.basename(path)
            print(f"  SKIP (already has tag): {filename}")
    print(f"  → {g2_changed} files patched")

    # ─── GROUP 3 ───
    print("\n[GROUP 3] Adding 'référentiels' to RGESN reference fragments")
    g3_changed = 0
    for filename, id_prefix in GROUP3:
        path = os.path.join(FRAGMENTS_DIR, filename)
        if not os.path.exists(path):
            print(f"  SKIP (not found): {filename}")
            continue
        fm, body = parse_file(path)
        changed = add_tag(fm, 'référentiels')
        if changed:
            write_file(path, fm, body)
            full_id = find_fragment_by_id_prefix(conn, id_prefix)
            if full_id:
                db_update_tags(conn, full_id, fm['tags'])
                print(f"  PATCHED: {filename} (db id: {full_id})")
            else:
                print(f"  PATCHED file only (no db match): {filename}")
            changes_summary.append(('group3', filename, id_prefix, 'added référentiels'))
            g3_changed += 1
        else:
            print(f"  SKIP (already has tag): {filename}")
    print(f"  → {g3_changed} files patched")

    # ─── GROUP 4 ───
    print("\n[GROUP 4] pricing → reference + add compétences/expertise/produit:twake-workplace")
    g4_changed = 0
    for old_filename, new_filename, id_prefix in GROUP4:
        old_path = os.path.join(FRAGMENTS_DIR, old_filename)
        new_path = os.path.join(FRAGMENTS_DIR, new_filename)
        if not os.path.exists(old_path):
            print(f"  SKIP (not found): {old_filename}")
            continue
        fm, body = parse_file(old_path)
        # Change type
        fm['type'] = 'reference'
        # Add tags
        add_tag(fm, 'compétences')
        add_tag(fm, 'expertise')
        add_tag(fm, 'produit:twake-workplace')
        # Write to new path
        write_file(new_path, fm, body)
        # Remove old file
        os.remove(old_path)
        # Update DB
        full_id = find_fragment_by_id_prefix(conn, id_prefix)
        if full_id:
            db_update_type_and_tags(conn, full_id, 'reference', fm['tags'])
            print(f"  RENAMED+PATCHED: {old_filename} → {new_filename} (db id: {full_id})")
        else:
            print(f"  RENAMED+PATCHED file only (no db match): {old_filename} → {new_filename}")
        changes_summary.append(('group4', old_filename, id_prefix, f'type pricing→reference, renamed→{new_filename}, added compétences/expertise/produit:twake-workplace'))
        g4_changed += 1
    print(f"  → {g4_changed} files patched")

    # ─── GROUP 5 ───
    print("\n[GROUP 5] Replacing SLA prefix — remove 'Twake Workplace' from engagement body")
    OLD_SLA_PREFIX = "Tableau des engagements de service SLA Twake Workplace — niveaux de service, GTI/GTR."
    NEW_SLA_PREFIX = "Engagement contractuel de service — GTI/GTR par criticité d'anomalie (MINEURE, MAJEURE, BLOQUANTE)."
    engagement_files = sorted(glob.glob(os.path.join(FRAGMENTS_DIR, 'engagement-twake-fr-*.md')))
    g5_changed = 0
    for path in engagement_files:
        fm, body = parse_file(path)
        if OLD_SLA_PREFIX not in body:
            print(f"  SKIP (old prefix not found): {os.path.basename(path)}")
            continue
        new_body = body.replace(OLD_SLA_PREFIX, NEW_SLA_PREFIX, 1)
        write_file(path, fm, new_body)
        frag_id = fm.get('id', '')
        if frag_id:
            new_body_stripped = new_body.strip()
            new_excerpt = new_body_stripped[:300]
            conn.execute(
                "UPDATE fragments SET body = ?, body_excerpt = ? WHERE id = ?",
                (new_body_stripped, new_excerpt, frag_id)
            )
        print(f"  PATCHED: {os.path.basename(path)}")
        changes_summary.append(('group5', os.path.basename(path), frag_id, 'updated SLA prefix'))
        g5_changed += 1
    print(f"  → {g5_changed} files patched")

    conn.commit()
    conn.close()

    print("\n" + "=" * 60)
    print(f"TOTAL CHANGES: {len(changes_summary)}")
    g_counts = {}
    for row in changes_summary:
        g_counts[row[0]] = g_counts.get(row[0], 0) + 1
    for g, c in sorted(g_counts.items()):
        print(f"  {g}: {c} changes")
    print("=" * 60)


if __name__ == '__main__':
    main()
