#!/usr/bin/env python3
"""
audit-domain-labels.py — Vérifie que tous les domaines présents dans la DB
ont une entrée dans SUBJECT_LABEL et SUBJECT_PREFIX (index-service.ts).

Usage:
    python scripts/audit-domain-labels.py [--db PATH]

Par défaut, utilise example-vault/.fragmint.db.
En production, passer le chemin réel : --db /data/vault/.fragmint.db
"""

import argparse
import os
import sqlite3
import sys

# ─── Mapping miroir de index-service.ts ──────────────────────────────────────
# Mettre à jour en même temps que SUBJECT_LABEL / SUBJECT_PREFIX dans le TS.

SUBJECT_PREFIX: dict[str, str] = {
    # Twake product family
    "twake": "TWA",
    "twake-workplace": "TWA",
    "twake-mail": "TM",
    "twake-drive": "TD",
    "twake-chat": "TC",
    "twake-calendar": "TCAL",
    "twake-visio": "TV",
    # LINAGORA family
    "linagora": "LIN",
    "linagora-corp": "LIN",
    "linagora-general": "LIN",
    "linagora-ia": "LIN",
    # Other products
    "linshare": "LS",
    "lincloud": "LC",
    "linto": "LT",
    "openrag": "OR",
    "apache-james": "AJ",
    "MIRAI": "MIR",
    "james": "JAM",
    "other": "OTH",
}

SUBJECT_LABEL: dict[str, str] = {
    # Twake product family
    "twake": "Twake",
    "twake-workplace": "Twake Workplace",
    "twake-mail": "Twake Mail",
    "twake-drive": "Twake Drive",
    "twake-chat": "Twake Chat",
    "twake-calendar": "Twake Calendar",
    "twake-visio": "Twake Visio",
    # LINAGORA family
    "linagora": "LINAGORA",
    "linagora-corp": "LINAGORA Corp",
    "linagora-general": "LINAGORA Général",
    "linagora-ia": "LINAGORA IA",
    # Other products
    "linshare": "LinShare",
    "lincloud": "LinCloud",
    "linto": "LinTO",
    "openrag": "OpenRAG",
    "apache-james": "Apache James",
    "MIRAI": "MIRAI",
    "james": "James (email)",
    "other": "Autres",
}


def fallback_prefix(domain: str) -> str:
    return domain[:3].upper()


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit domain labels vs index-service.ts")
    parser.add_argument(
        "--db",
        default=os.path.join(os.path.dirname(__file__), "..", "example-vault", ".fragmint.db"),
        help="Path to fragmint.db",
    )
    args = parser.parse_args()

    db_path = os.path.abspath(args.db)
    if not os.path.exists(db_path):
        print(f"ERROR: DB not found at {db_path}", file=sys.stderr)
        return 1

    conn = sqlite3.connect(db_path)
    rows = conn.execute(
        """
        SELECT domain, COUNT(*) as n
        FROM fragments
        WHERE quality NOT IN ('deprecated', 'draft')
        GROUP BY domain
        ORDER BY domain
        """
    ).fetchall()
    conn.close()

    if not rows:
        print("No approved/reviewed fragments found.")
        return 0

    missing_label: list[tuple[str, int]] = []
    missing_prefix: list[tuple[str, int]] = []
    ok: list[tuple[str, int, str, str]] = []

    for domain, count in rows:
        label = SUBJECT_LABEL.get(domain)
        prefix = SUBJECT_PREFIX.get(domain)
        if label is None:
            missing_label.append((domain, count))
        if prefix is None:
            missing_prefix.append((domain, count))
        if label is not None and prefix is not None:
            ok.append((domain, count, label, prefix))

    print("=" * 60)
    print("Fragmint — Audit des labels de domaine")
    print(f"DB : {db_path}")
    print("=" * 60)

    if ok:
        print(f"\n✅ Domaines avec label + prefix ({len(ok)}):")
        for domain, count, label, prefix in ok:
            print(f"   {domain:<22} {prefix:<6} {label}  ({count} frg)")

    if missing_label:
        print(f"\n⚠️  Domaines SANS label dans SUBJECT_LABEL ({len(missing_label)}):")
        print("   → Ces domaines s'affichent comme slug brut dans le TOC agentic (Phase 0).")
        for domain, count in missing_label:
            fb = fallback_prefix(domain)
            print(f"   {domain:<22} prefix_fallback={fb}  ({count} frg)")
        print()
        print("   Fix : ajouter dans index-service.ts SUBJECT_LABEL :")
        for domain, count in missing_label:
            print(f"     '{domain}': '??',  // {count} frg")
        print("   Et mettre à jour SUBJECT_PREFIX + ce script en conséquence.")

    if missing_prefix:
        print(f"\n⚠️  Domaines SANS prefix dans SUBJECT_PREFIX ({len(missing_prefix)}):")
        print("   → Nouveaux fragments utiliseront domain[:3].upper() comme fallback.")
        for domain, count in missing_prefix:
            fb = fallback_prefix(domain)
            print(f"   {domain:<22} fallback={fb}  ({count} frg)")

    print()
    has_issues = bool(missing_label or missing_prefix)
    if has_issues:
        print(f"RÉSULTAT : {len(missing_label)} domaine(s) sans label, {len(missing_prefix)} sans prefix.")
        print("Mettez à jour index-service.ts ET ce script pour les faire correspondre.")
    else:
        print("RÉSULTAT : Tous les domaines sont couverts. ✅")

    return 1 if has_issues else 0


if __name__ == "__main__":
    sys.exit(main())
