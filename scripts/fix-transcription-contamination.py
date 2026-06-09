#!/usr/bin/env python3
"""
fix-transcription-contamination.py — Corrige la contamination cross-domain des fragments
Twake Visio dans les plans MIRAI due au bare tag "transcription" trop générique.

Actions :
  1. Supprime le bare tag "transcription" de TV-arg-002 et TV-arg-003 (visio).
     Le bare tag "linto" reste — spécifique, ne se déclenche pas sur une section MIRAI
     qui mentionne juste "transcription automatique" sans parler de LinTO.

  2. Crée un fragment use-case MIRAI (MIR-uc-001) sur la transcription automatique
     avec LinTO. Ce fragment aura le tag "transcription" et domain MIRAI, ce qui lui
     permettra de scorer plus haut que les fragments visio pour les sections MIRAI
     mentionnant "transcription automatique".

Contexte technique (computePoolA) :
  - kw = tag.split(':')[1] si namespaced, sinon tag lui-même
  - "feature:transcription" → kw = "transcription" → détecte QUAND MÊME sur "transcription"
  - Seule solution : supprimer le bare tag "transcription" des fragments visio

Usage:
    python scripts/fix-transcription-contamination.py [--db PATH] [--vault PATH] [--dry-run]
"""

import argparse
import json
import os
import re
import sqlite3
import sys
import uuid as uuidlib
from datetime import datetime, timezone

# ─── Tags à retirer (bare tag trop générique → fausse détection cross-domain) ─

TAG_REMOVALS = [
    {
        "id": "frag-37e26687-5f57-4056-85a8-c43b2949d93e",
        "file": "argument-twake-visio-fr-2949d93e.md",
        "readable_id": "TV-arg-003",
        "tags_to_remove": ["transcription"],
        "reason": (
            "bare tag 'transcription' → Pool A l'injecte dans toute section MIRAI "
            "mentionnant 'transcription automatique'. Le bare tag 'linto' reste (kw='linto', "
            "spécifique), 'produit:twake-visio' reste."
        ),
    },
    {
        "id": "frag-d74e2bfd-6992-4e84-8ae3-da5b0dac568d",
        "file": "argument-twake-visio-fr-0dac568d.md",
        "readable_id": "TV-arg-002",
        "tags_to_remove": ["transcription"],
        "reason": (
            "bare tag 'transcription' → même problème. Le bare tag 'linto' reste."
        ),
    },
]

# ─── Fragment MIRAI à créer (use-case transcription) ─────────────────────────
# Ce fragment permettra au LLM judge de scorer un vrai use-case MIRAI pour les
# sections mentionnant "transcription automatique", délogeant les fragments visio.

NEW_FRAGMENT = {
    "readable_id": "MIR-uc-001",
    "type": "use-case",
    "domain": "MIRAI",
    "lang": "fr",
    "quality": "approved",
    "tags": [
        "transcription",
        "assistant",
        "documentaire",
        "MIRAI",
        "linto",
        "intégration",
        "bureautique",
        "souverain",
        "tech:linto",
        "produit:mirai",
    ],
    "title": "Transcription automatique de réunions et documents avec l'assistant MIRAI",
    "body": (
        "# Transcription automatique de réunions et documents avec l'assistant MIRAI\n\n"
        "L'assistant MIRAI intègre LinTO, la technologie de transcription automatique "
        "souveraine développée par LINAGORA, pour proposer aux agents du Ministère de "
        "l'Intérieur les cas d'usage suivants :\n\n"
        "- **Compte-rendu automatique de réunion** : transcription temps réel via LinTO, "
        "structuration automatique en points d'action et décisions par le LLM MIRAI.\n"
        "- **Dictée et saisie vocale dans LibreOffice** : dictée directement dans "
        "Writer/Calc/Impress via l'interface UNO, avec corrections contextuelles.\n"
        "- **Transcription de documents audio/vidéo** : conversion de fichiers audio "
        "(MP3, WAV) ou vidéo (MP4) en texte structuré, exploitable dans la base "
        "documentaire MIRAI.\n"
        "- **Sous-titrage multilingue** : génération automatique de sous-titres pour "
        "formations et webinaires internes.\n\n"
        "Tous les traitements s'effectuent en local sur les infrastructures du Ministère, "
        "garantissant la confidentialité des données sensibles conformément aux exigences "
        "RGS et RGPD."
    ),
    "origin": "manual",
    "origin_source": "scripts/fix-transcription-contamination.py",
    "author": "fragmint",
}


def remove_tags_from_frontmatter(content: str, tags_to_remove: list[str]) -> str:
    """Supprime des tags du bloc tags: du frontmatter YAML."""
    for tag in tags_to_remove:
        # Matches both quoted and unquoted forms: "  - transcription" or "  - 'transcription'"
        content = re.sub(
            rf"^  - ['\"]?{re.escape(tag)}['\"]?\n",
            "",
            content,
            flags=re.MULTILINE,
        )
    return content


def build_frontmatter(frag_id: str, item: dict, now: str) -> str:
    tags_yaml = "\n".join(f"  - '{t}'" if ":" in t else f"  - {t}" for t in item["tags"])
    return (
        "---\n"
        f"id: {frag_id}\n"
        f"type: {item['type']}\n"
        f"domain: {item['domain']}\n"
        f"tags:\n{tags_yaml}\n"
        f"lang: {item['lang']}\n"
        "translation_of: null\n"
        f"quality: {item['quality']}\n"
        f"author: {item['author']}\n"
        f"reviewed_by: {item['author']}\n"
        f"approved_by: {item['author']}\n"
        f"created_at: '{now}'\n"
        f"updated_at: '{now}'\n"
        "valid_from: null\n"
        "valid_until: null\n"
        "parent_id: null\n"
        "generation: 0\n"
        "uses: 0\n"
        "last_used: null\n"
        f"origin: {item['origin']}\n"
        f"origin_source: {item['origin_source']}\n"
        "origin_page: null\n"
        "access:\n"
        "  read:\n"
        "    - '*'\n"
        "  write:\n"
        "    - contributor\n"
        "    - admin\n"
        "  approve:\n"
        "    - expert\n"
        "    - admin\n"
        "---\n"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Fix transcription tag contamination")
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
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    print("=" * 60)
    print(f"fix-transcription-contamination{'  (dry-run)' if dry else ''}")
    print("=" * 60)

    # ── Retrait du bare tag "transcription" des fragments visio ──────────────
    print(f"\n🏷  Suppression du bare tag 'transcription' ({len(TAG_REMOVALS)} fragments) :")
    for item in TAG_REMOVALS:
        fid = item["id"]
        fpath = os.path.join(vault_path, item["file"])

        row = conn.execute("SELECT id, tags FROM fragments WHERE id = ?", (fid,)).fetchone()
        if not row:
            print(f"   ⚠️  {fid[:12]}… introuvable en DB")
            errors += 1
            continue

        current_tags: list = json.loads(row[1]) if row[1] else []
        to_remove = [t for t in item["tags_to_remove"] if t in current_tags]

        if not to_remove:
            print(f"   ✓  {item['readable_id']} ({fid[:12]}…) : tags déjà absents")
            continue

        new_tags = [t for t in current_tags if t not in to_remove]
        print(f"   {prefix}UPDATE {item['readable_id']} ({fid[:12]}…) : -{to_remove}")
        print(f"        Raison : {item['reason'][:80]}…")

        if not os.path.exists(fpath):
            print(f"   ⚠️  Fichier introuvable : {item['file']}")
            errors += 1
            continue

        if not dry:
            with open(fpath, "r", encoding="utf-8") as f:
                content = f.read()
            new_content = remove_tags_from_frontmatter(content, to_remove)
            with open(fpath, "w", encoding="utf-8") as f:
                f.write(new_content)
            conn.execute(
                "UPDATE fragments SET tags = ? WHERE id = ?",
                (json.dumps(new_tags, ensure_ascii=False), fid),
            )

    # ── Création du fragment use-case MIRAI transcription ─────────────────────
    print(f"\n✨ Création du fragment use-case MIRAI (MIR-uc-001) :")
    item = NEW_FRAGMENT

    existing = conn.execute(
        "SELECT id FROM fragments WHERE readable_id = ?", (item["readable_id"],)
    ).fetchone()
    if existing:
        print(f"   ✓  {item['readable_id']} existe déjà ({existing[0][:12]}…), rien à faire.")
    else:
        frag_id = f"frag-{uuidlib.uuid4()}"
        last8 = frag_id.replace("frag-", "").replace("-", "")[-8:]
        filename = f"{item['type']}-{item['domain'].lower()}-{item['lang']}-{last8}.md"
        fpath = os.path.join(vault_path, filename)

        frontmatter = build_frontmatter(frag_id, item, now)
        file_content = frontmatter + item["body"] + "\n"

        title = item["title"]
        body_excerpt = item["body"][:300]
        tags_json = json.dumps(item["tags"], ensure_ascii=False)

        print(f"   {prefix}CREATE {frag_id[:12]}… → {filename}")
        print(f"        Title : {title}")
        print(f"        Tags  : {item['tags'][:5]}…")

        if not dry:
            with open(fpath, "w", encoding="utf-8") as f:
                f.write(file_content)
            file_path = f"fragments/{filename}"
            conn.execute(
                """INSERT INTO fragments
                   (id, readable_id, type, domain, tags, lang, quality, title,
                    body_excerpt, body, origin, origin_source, created_at, updated_at,
                    uses, author, file_path)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)""",
                (
                    frag_id, item["readable_id"], item["type"], item["domain"],
                    tags_json, item["lang"], item["quality"], title,
                    body_excerpt, item["body"], item["origin"], item["origin_source"],
                    now, now, item["author"], file_path,
                ),
            )
            print(f"        → vault: {filename}")
            print(f"        → DB: INSERT OK")

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

    return 0 if not errors else 1


if __name__ == "__main__":
    sys.exit(main())
