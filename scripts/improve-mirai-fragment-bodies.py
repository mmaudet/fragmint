#!/usr/bin/env python3
"""
improve-mirai-fragment-bodies.py — Améliore les corps et métadonnées de fragments MIRAI
pour renforcer le signal sémantique vectoriel (title + body sont le seul texte embarqué).

Actions :
  - Ajoute titre H1 + intro explicite aux fragments dont le body manque de signal
  - Corrige le domain de fragments mal classifiés (ex: 'other' → 'MIRAI')
  - Supprime les fragments dont le corps est un artefact (lien TOC, etc.)

Usage:
    python scripts/improve-mirai-fragment-bodies.py [--db PATH] [--vault PATH] [--dry-run]
"""

import argparse
import os
import re
import sqlite3
import sys

# ─── Fragments à améliorer (body enrichi) ─────────────────────────────────────
# Seul title + body est embedé (search-service.ts:136).
# Les tags ne sont PAS dans le vecteur — uniquement le body compte.

IMPROVEMENTS = [
    {
        "id": "frag-e623a04a-1c54-4f83-b6a6-26841926f17e",
        "file": "use-case-other-fr-1926f17e.md",
        "reason": (
            "Body démarre par des bullets sans titre H1 → regex d'embedding extrait rien → "
            "signal faible pour 'cas d'utilisation assistant documentaire'. "
            "Ajout d'un titre H1 + intro MIRAI explicite."
        ),
        "new_body": (
            "# Cas d'utilisation de l'assistant MIRAI dans LibreOffice\n\n"
            "L'assistant documentaire MIRAI, intégré nativement dans LibreOffice "
            "(Writer, Calc, Impress), propose les fonctionnalités suivantes aux agents "
            "du Ministère de l'Intérieur :\n\n"
            "- Fonctionnalités : génération assistée, relecture, normalisation de style, "
            "traduction, résumé de document.\n"
            "  - Intégration via UNO API (LibreOffice SDK).\n"
            "  - Compatibilité : Writer, Calc, Impress.\n"
            "  - Système de cache et d'appel aux modèles MIRAI (LLM ou SLM) "
            "selon politique de confidentialité."
        ),
        "new_title": "Cas d'utilisation de l'assistant MIRAI dans LibreOffice",
    },
]

# ─── Fragments à recatégoriser (domain mal classifié) ────────────────────────
# Raison : Phase 0 agentic filtre par domain dans le TOC. Un fragment en domain 'other'
# n'entre pas dans le pool d'un plan MIRAI même si son contenu est directement pertinent.

DOMAIN_CHANGES = [
    {
        "id": "frag-e623a04a-1c54-4f83-b6a6-26841926f17e",
        "file": "use-case-other-fr-1926f17e.md",
        "old_domain": "other",
        "new_domain": "MIRAI",
        "reason": "Cas d'usage LibreOffice MIRAI classé 'other' → invisible en Phase 0 des plans MIRAI",
    },
]

# ─── Fragments à supprimer (corps = artefact sans contenu) ────────────────────

TO_DELETE = [
    {
        "id": "frag-db97dc49-1c24-46be-b2b8-884badf6cce2",
        "file": "engagement-linto-en-adf6cce2.md",
        "reason": "Corps = lien TOC '[4.2 Hosting services](#hosting-services)' — aucun contenu réel",
    },
]


def extract_frontmatter_and_body(content: str) -> tuple[str, str]:
    """Sépare le frontmatter YAML du body markdown."""
    match = re.match(r"^(---\n.*?\n---\n)(.*)", content, re.DOTALL)
    if match:
        return match.group(1), match.group(2).strip()
    return "", content.strip()


def main() -> int:
    parser = argparse.ArgumentParser(description="Improve MIRAI fragment bodies")
    parser.add_argument(
        "--db",
        default=os.path.join(os.path.dirname(__file__), "..", "example-vault", ".fragmint.db"),
    )
    parser.add_argument(
        "--vault",
        default=os.path.join(os.path.dirname(__file__), "..", "example-vault", "fragments"),
    )
    parser.add_argument("--dry-run", action="store_true")
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
    print(f"improve-mirai-fragment-bodies{'  (dry-run)' if dry else ''}")
    print("=" * 60)

    # ── Suppressions ──────────────────────────────────────────────────────────
    print(f"\n🗑  Suppression de {len(TO_DELETE)} fragment(s) artefact(s) :")
    for item in TO_DELETE:
        fid = item["id"]
        fpath = os.path.join(vault_path, item["file"])

        row = conn.execute("SELECT id FROM fragments WHERE id = ?", (fid,)).fetchone()
        if not row:
            print(f"   ⚠️  {fid[:12]}… introuvable en DB (déjà supprimé ?)")
            continue

        print(f"   {prefix}DELETE {fid[:12]}… — {item['reason']}")
        if not dry:
            conn.execute("DELETE FROM fragments WHERE id = ?", (fid,))

        if os.path.exists(fpath):
            print(f"   {prefix}rm {item['file']}")
            if not dry:
                os.remove(fpath)
        else:
            print(f"   ⚠️  Fichier introuvable : {item['file']}")
            errors += 1

    # ── Corrections domain ───────────────────────────────────────────────────
    print(f"\n🏷  Correction de domain ({len(DOMAIN_CHANGES)} fragment(s)) :")
    for item in DOMAIN_CHANGES:
        fid = item["id"]
        fpath = os.path.join(vault_path, item["file"])

        row = conn.execute("SELECT id, domain FROM fragments WHERE id = ?", (fid,)).fetchone()
        if not row:
            print(f"   ⚠️  {fid[:12]}… introuvable en DB")
            errors += 1
            continue

        print(f"   {prefix}UPDATE {fid[:12]}… : domain {item['old_domain']} → {item['new_domain']} — {item['reason']}")

        if not os.path.exists(fpath):
            print(f"   ⚠️  Fichier introuvable : {item['file']}")
            errors += 1
            continue

        if not dry:
            with open(fpath, "r", encoding="utf-8") as f:
                content = f.read()
            new_content = re.sub(
                r"^domain: .+$", f"domain: {item['new_domain']}", content, flags=re.MULTILINE
            )
            with open(fpath, "w", encoding="utf-8") as f:
                f.write(new_content)
            conn.execute(
                "UPDATE fragments SET domain = ? WHERE id = ?",
                (item["new_domain"], fid),
            )

    # ── Améliorations body ────────────────────────────────────────────────────
    print(f"\n✏️  Amélioration de {len(IMPROVEMENTS)} fragment(s) :")
    for item in IMPROVEMENTS:
        fid = item["id"]
        fpath = os.path.join(vault_path, item["file"])

        row = conn.execute(
            "SELECT id, title FROM fragments WHERE id = ?", (fid,)
        ).fetchone()
        if not row:
            print(f"   ⚠️  {fid[:12]}… introuvable en DB")
            errors += 1
            continue

        print(f"   {prefix}UPDATE {fid[:12]}… — {item['reason']}")

        if not os.path.exists(fpath):
            print(f"   ⚠️  Fichier introuvable : {item['file']}")
            errors += 1
            continue

        with open(fpath, "r", encoding="utf-8") as f:
            content = f.read()

        frontmatter, old_body = extract_frontmatter_and_body(content)
        new_content = frontmatter + item["new_body"] + "\n"

        if dry:
            print(f"   --- body actuel (50 chars) : {old_body[:50]!r}…")
            print(f"   +++ nouveau body (50 chars) : {item['new_body'][:50]!r}…")
        else:
            with open(fpath, "w", encoding="utf-8") as f:
                f.write(new_content)
            conn.execute(
                "UPDATE fragments SET title = ? WHERE id = ?",
                (item["new_title"], fid),
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
            print("→ Redémarre le serveur + reindex Milvus pour propager les changements d'embedding.")

    return 0 if not errors else 1


if __name__ == "__main__":
    sys.exit(main())
