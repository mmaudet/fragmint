#!/usr/bin/env python3
"""
fix-twake-visio-fragments.py — Nettoie les fragments twake-visio mal chunkés
et corrige leurs readable_ids (préfixe TWA → TV).

Actions :
  - Supprime 3 fragments artefacts (titres vides / headers markdown isolés)
  - Met à jour les readable_ids des 3 bons fragments (TWA-arg-xxx → TV-arg-xxx)

Usage:
    python scripts/fix-twake-visio-fragments.py [--db PATH] [--vault PATH] [--dry-run]
"""

import argparse
import json
import os
import re
import sqlite3
import sys

# ─── Fragments à supprimer (artefacts de chunking) ────────────────────────────

TO_DELETE = [
    {
        "id": "frag-f514e370-d8d8-42dc-bbab-7bad1e0798e6",
        "file": "argument-twake-visio-fr-1e0798e6.md",
        "reason": "header markdown seul : '- **Principales fonctionnalités :**'",
    },
    {
        "id": "frag-5218423e-cc28-438a-a449-890626036440",
        "file": "argument-twake-visio-fr-26036440.md",
        "reason": "artefact de chunking : titre 'ues'",
    },
    {
        "id": "frag-b9267c1f-ad66-4072-a3da-b7bc6eb8bcb2",
        "file": "argument-twake-visio-fr-6eb8bcb2.md",
        "reason": "header markdown seul : '- **Atouts disctinctifs**  :'",
    },
]

# ─── Fragments à conserver avec readable_id corrigé ───────────────────────────
# Ancien préfixe : TWA (fallback domain[:3] avant que twake-visio soit dans SUBJECT_PREFIX)
# Nouveau préfixe : TV (ajouté dans index-service.ts)

TO_FIX = [
    {
        "id": "frag-dd3a5085-ddcc-44f3-961f-a3bf038e4c50",
        "old_readable_id": "TWA-arg-009",
        "new_readable_id": "TV-arg-001",
    },
    {
        "id": "frag-d74e2bfd-6992-4e84-8ae3-da5b0dac568d",
        "old_readable_id": "TWA-arg-014",
        "new_readable_id": "TV-arg-002",
    },
    {
        "id": "frag-37e26687-5f57-4056-85a8-c43b2949d93e",
        "old_readable_id": "TWA-arg-017",
        "new_readable_id": "TV-arg-003",
    },
]


# ─── Tags à ajouter (namespaced → priorité Pool A avant les bare tags) ────────
# produit:twake-visio garantit que ces fragments entrent dans le pool namespaced
# (récupéré en priorité, slots dédiés) plutôt que de se battre dans l'OR query bare.
# TV-arg-002 n'avait pas non plus le bare tag "visio" → ajouté aussi.

TAG_ADDITIONS = [
    {
        "id": "frag-dd3a5085-ddcc-44f3-961f-a3bf038e4c50",
        "file": "argument-twake-visio-fr-038e4c50.md",
        "tags_to_add": ["produit:twake-visio"],
    },
    {
        "id": "frag-d74e2bfd-6992-4e84-8ae3-da5b0dac568d",
        "file": "argument-twake-visio-fr-0dac568d.md",
        "tags_to_add": ["produit:twake-visio", "visio"],
    },
    {
        "id": "frag-37e26687-5f57-4056-85a8-c43b2949d93e",
        "file": "argument-twake-visio-fr-2949d93e.md",
        "tags_to_add": ["produit:twake-visio"],
    },
]


def add_tags_to_frontmatter(content: str, new_tags: list[str]) -> str:
    """Insère les tags manquants dans le bloc tags: du frontmatter YAML."""
    def replacer(match: re.Match) -> str:
        block = match.group(0)
        for tag in new_tags:
            quoted = f"'{tag}'"
            if quoted not in block and tag not in block:
                block = block.rstrip("\n") + f"\n  - {quoted}\n"
        return block

    return re.sub(r"^tags:\n(?:  - .*\n)+", replacer, content, flags=re.MULTILINE)


def main() -> int:
    parser = argparse.ArgumentParser(description="Fix twake-visio fragments")
    parser.add_argument(
        "--db",
        default=os.path.join(os.path.dirname(__file__), "..", "example-vault", ".fragmint.db"),
        help="Path to fragmint.db",
    )
    parser.add_argument(
        "--vault",
        default=os.path.join(os.path.dirname(__file__), "..", "example-vault", "fragments"),
        help="Path to vault fragments directory",
    )
    parser.add_argument("--dry-run", action="store_true", help="Affiche les actions sans les exécuter")
    args = parser.parse_args()

    db_path = os.path.abspath(args.db)
    vault_path = os.path.abspath(args.vault)

    if not os.path.exists(db_path):
        print(f"ERROR: DB not found at {db_path}", file=sys.stderr)
        return 1

    dry = args.dry_run
    prefix = "[DRY-RUN] " if dry else ""

    conn = sqlite3.connect(db_path)
    errors = 0

    print("=" * 60)
    print(f"fix-twake-visio-fragments{'  (dry-run)' if dry else ''}")
    print("=" * 60)

    # ── Suppressions ──────────────────────────────────────────────────────────
    print(f"\n🗑  Suppression de {len(TO_DELETE)} fragments artefacts :")
    for item in TO_DELETE:
        frag_id = item["id"]
        fpath = os.path.join(vault_path, item["file"])

        row = conn.execute("SELECT id, title FROM fragments WHERE id = ?", (frag_id,)).fetchone()
        if not row:
            print(f"   ⚠️  {frag_id[:12]}… introuvable en DB (déjà supprimé ?)")
            continue

        print(f"   {prefix}DELETE {frag_id[:12]}… — {item['reason']}")
        if not dry:
            conn.execute("DELETE FROM fragments WHERE id = ?", (frag_id,))

        if os.path.exists(fpath):
            print(f"   {prefix}rm {item['file']}")
            if not dry:
                os.remove(fpath)
        else:
            print(f"   ⚠️  Fichier introuvable : {item['file']}")
            errors += 1

    # ── Corrections readable_id ───────────────────────────────────────────────
    print(f"\n✏️  Correction des readable_ids ({len(TO_FIX)} fragments) :")
    for item in TO_FIX:
        frag_id = item["id"]
        row = conn.execute(
            "SELECT id, readable_id FROM fragments WHERE id = ?", (frag_id,)
        ).fetchone()
        if not row:
            print(f"   ⚠️  {frag_id[:12]}… introuvable en DB")
            errors += 1
            continue

        current_id = row[1]
        if current_id != item["old_readable_id"]:
            print(f"   ⚠️  {frag_id[:12]}… readable_id inattendu : {current_id!r} (attendu {item['old_readable_id']!r})")

        print(f"   {prefix}UPDATE {frag_id[:12]}… : {item['old_readable_id']} → {item['new_readable_id']}")
        if not dry:
            conn.execute(
                "UPDATE fragments SET readable_id = ? WHERE id = ?",
                (item["new_readable_id"], frag_id),
            )

    # ── Ajouts de tags ────────────────────────────────────────────────────────
    print(f"\n🏷  Ajout de tags namespaced ({len(TAG_ADDITIONS)} fragment(s)) :")
    for item in TAG_ADDITIONS:
        frag_id = item["id"]
        fpath = os.path.join(vault_path, item["file"])

        row = conn.execute(
            "SELECT id, tags FROM fragments WHERE id = ?", (frag_id,)
        ).fetchone()
        if not row:
            print(f"   ⚠️  {frag_id[:12]}… introuvable en DB")
            errors += 1
            continue

        current_tags: list = json.loads(row[1]) if row[1] else []
        to_add = [t for t in item["tags_to_add"] if t not in current_tags]

        if not to_add:
            print(f"   ✓  {frag_id[:12]}… tags déjà présents, rien à faire")
            continue

        new_tags = current_tags + to_add
        print(f"   {prefix}UPDATE {frag_id[:12]}… : +{to_add}")

        if not os.path.exists(fpath):
            print(f"   ⚠️  Fichier introuvable : {item['file']}")
            errors += 1
            continue

        if not dry:
            with open(fpath, "r", encoding="utf-8") as f:
                content = f.read()
            new_content = add_tags_to_frontmatter(content, to_add)
            with open(fpath, "w", encoding="utf-8") as f:
                f.write(new_content)
            conn.execute(
                "UPDATE fragments SET tags = ? WHERE id = ?",
                (json.dumps(new_tags, ensure_ascii=False), frag_id),
            )

    if not dry:
        conn.commit()
    conn.close()

    print()
    if errors:
        print(f"RÉSULTAT : terminé avec {errors} avertissement(s).")
    else:
        status = "Dry-run OK — aucune modification." if dry else "Terminé. ✅"
        print(f"RÉSULTAT : {status}")
        if not dry:
            print("→ Redémarre le serveur pour invalider le cache d'index.")
            print("→ Si Milvus est actif, lance un reindex pour propager les suppressions.")

    return 0 if not errors else 1


if __name__ == "__main__":
    sys.exit(main())
