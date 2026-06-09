# Migration vault — Tags Twake (2026-06-09)

Contexte : alignement des tags sur les fragments Twake pour préparer le plan "Proposition LINAGORA — Twake Workplace". Objectif : que le filtre `tags: [produit:twake-workplace]` sur le plan remonte tous les fragments pertinents. Quatre groupes de changements : ajout de `produit:twake-workplace` aux fragments narratifs manquants, ajout de `performance` aux tableaux SLA/engagement, ajout de `référentiels` aux tableaux RGESN, et reclassification des matrices de compétences (`pricing` → `reference`).

---

## Plan filter à configurer en prod

Dans le plan Twake Workplace, aller dans **1. Specs** et mettre dans le champ Tags :

```
produit:twake-workplace
```

Ce filtre fait deux choses :
- Le **corpus summary** envoyé au LLM ne liste que les types qui ont au moins un fragment `produit:twake-workplace` → le LLM propose uniquement des sections couvertes par le vault Twake.
- Le **Pool A** de la recherche de fragments (boosting par tags) remonte du contenu Twake Workplace en priorité.

---

## 1. Type fixes

Ces 5 fragments sont des matrices de compétences du personnel (domaines logiciels, nombres de collaborateurs par niveau). Ils avaient été classés `pricing` lors du harvest — erreur de classification, ce sont des `reference`.

| Ancien fichier | Nouveau fichier | ID | Avant | Après |
|---|---|---|---|---|
| `pricing-twake-fr-f237a448.md` | `reference-twake-fr-f237a448.md` | `frag-20b2b9f5` | type: pricing, tags: `[source:tableau]` | type: reference, tags: `[source:tableau, compétences, expertise, produit:twake-workplace]` |
| `pricing-twake-fr-d4a33770.md` | `reference-twake-fr-d4a33770.md` | `frag-0ff0dfb7` | type: pricing, tags: `[source:tableau]` | type: reference, tags: `[source:tableau, compétences, expertise, produit:twake-workplace]` |
| `pricing-twake-fr-32cd020e.md` | `reference-twake-fr-32cd020e.md` | `frag-511aaf94` | type: pricing, tags: `[source:tableau]` | type: reference, tags: `[source:tableau, compétences, expertise, produit:twake-workplace]` |
| `pricing-twake-fr-78f443a2.md` | `reference-twake-fr-78f443a2.md` | `frag-8ad37f37` | type: pricing, tags: `[source:tableau]` | type: reference, tags: `[source:tableau, compétences, expertise, produit:twake-workplace]` |
| `pricing-twake-fr-702aef33.md` | `reference-twake-fr-702aef33.md` | `frag-a83b087c` | type: pricing, tags: `[source:tableau]` | type: reference, tags: `[source:tableau, compétences, expertise, produit:twake-workplace]` |

---

## 2. Tag additions

### 2a. Ajout de `produit:twake-workplace` — fragments narratifs Twake

Ces fragments ont `domain: twake` et décrivent Twake Workplace, mais le tag `produit:twake-workplace` était absent (ou seulement `produit:twake` sans le suffixe `-workplace`, ou `twake-workplace` sans le préfixe `produit:`).

| Fichier | ID | Tag ajouté |
|---|---|---|
| `argument-twake-fr-930107ab.md` | `frag-cf3f4ed6` | `produit:twake-workplace` |
| `argument-twake-fr-06f84529.md` | `frag-e40cb7b4` | `produit:twake-workplace` |
| `argument-twake-fr-75bf3f4b.md` | `frag-389088b4` | `produit:twake-workplace` |
| `argument-twake-fr-16f1043c.md` | `frag-3b4b6ffb` | `produit:twake-workplace` |
| `argument-twake-fr-9437f39e.md` | `frag-72c44a42` | `produit:twake-workplace` |
| `argument-twake-fr-e592ac5f.md` | `frag-af77ff2c` | `produit:twake-workplace` |
| `argument-twake-fr-350359b8.md` | `frag-bd68e08a` | `produit:twake-workplace` |
| `argument-twake-fr-5aec5f52.md` | `frag-2ba23980` | `produit:twake-workplace` |
| `introduction-twake-fr-498e9125.md` | `frag-a1267e91` | `produit:twake-workplace` |
| `methodology-twake-fr-28d3f185.md` | `frag-c79f0504` | `produit:twake-workplace` |
| `methodology-twake-fr-de5866dc.md` | `frag-3a08cc26` | `produit:twake-workplace` |
| `methodology-twake-fr-285487ce.md` | `frag-bc7a0788` | `produit:twake-workplace` |
| `methodology-twake-fr-a9f95c9e.md` | `frag-22f09f4c` | `produit:twake-workplace` |
| `methodology-twake-fr-4cd68c79.md` | `frag-23e1a40e` | `produit:twake-workplace` |
| `reference-twake-fr-9ab58b2a.md` | `frag-0faaa74b` | `produit:twake-workplace` |
| `reference-twake-fr-ebfbd823.md` | `frag-642faad8` | `produit:twake-workplace` |
| `reference-twake-fr-30c5f41f.md` | `frag-48755717` | `produit:twake-workplace` |

### 2b. Ajout de `performance` — tableaux SLA/engagement Twake

Ces 15 fragments tabulaires contiennent des indicateurs de performance (SLA, disponibilité, temps de réponse, etc.). Le tag `performance` permet de les distinguer des tableaux structurels et de les faire remonter dans les sections "Engagements de performance" d'un plan.

| Fichier | ID | Tag ajouté |
|---|---|---|
| `engagement-twake-fr-04a4a166.md` | `frag-e22216ee` | `performance` |
| `engagement-twake-fr-9d90da9f.md` | `frag-429f33e6` | `performance` |
| `engagement-twake-fr-ce6b1af2.md` | `frag-adbb82bb` | `performance` |
| `engagement-twake-fr-d6a240ea.md` | `frag-c7afa0de` | `performance` |
| `engagement-twake-fr-d86bddd7.md` | `frag-ff3bb453` | `performance` |
| `engagement-twake-fr-7759ecdd.md` | `frag-735381e3` | `performance` |
| `engagement-twake-fr-702a4728.md` | `frag-40c3caff` | `performance` |
| `engagement-twake-fr-d7d37b13.md` | `frag-b5242187` | `performance` |
| `engagement-twake-fr-e5a3a186.md` | `frag-8c8ced21` | `performance` |
| `engagement-twake-fr-05d59926.md` | `frag-cf8f5c0b` | `performance` |
| `engagement-twake-fr-8623a6cc.md` | `frag-3ce0cf4b` | `performance` |
| `engagement-twake-fr-3f5fd4d5.md` | `frag-42dcb24a` | `performance` |
| `engagement-twake-fr-68807d23.md` | `frag-82f98032` | `performance` |
| `engagement-twake-fr-eeb54563.md` | `frag-9a0a0650` | `performance` |
| `engagement-twake-fr-57584c1b.md` | `frag-8a71e3f2` | `performance` |

### 2c. Ajout de `référentiels` — tableaux RGESN

Ces 6 fragments couvrent les bonnes pratiques du Référentiel Général d'Écoconception des Services Numériques (RGESN). Ils avaient déjà le tag `rgesn` ; le tag `référentiels` les aligne avec la convention des fragments de référentiels réglementaires.

| Fichier | ID | Tag ajouté |
|---|---|---|
| `reference-twake-fr-9bd7d31e.md` | `frag-0521b330` | `référentiels` |
| `reference-twake-fr-c159ae9c.md` | `frag-f5fadc13` | `référentiels` |
| `reference-twake-fr-6bac28ae.md` | `frag-26416345` | `référentiels` |
| `reference-twake-fr-af55b675.md` | `frag-eeb8a326` | `référentiels` |
| `reference-twake-fr-b5435c7b.md` | `frag-595a976a` | `référentiels` |
| `reference-twake-fr-ae4cb396.md` | `frag-bbb6d8a9` | `référentiels` |

---

## 3. Script de migration (application sur vault existant)

Si le vault de production contient déjà les fragments (ingestion depuis git), ce script applique les modifications de tags et de type manquantes via l'API Fragmint.

```python
#!/usr/bin/env python3
"""
Migration 2026-06-09 — Tags Twake
À exécuter après ingestion du vault en production.
Requiert: pip install requests
"""
import requests

BASE = "http://localhost:3210"  # adapter à l'URL de prod
TOKEN = "frag_tok_..."          # token admin

headers = {"Authorization": f"Bearer {TOKEN}"}


def get_tags(frag_id):
    r = requests.get(f"{BASE}/v1/fragments/{frag_id}", headers=headers)
    if r.status_code != 200:
        print(f"  NOT FOUND: {frag_id}")
        return None
    return r.json().get("tags", [])


def patch_tags(frag_id, tags):
    r = requests.patch(
        f"{BASE}/v1/admin/fragments/{frag_id}",
        json={"tags": tags},
        headers=headers
    )
    print(f"  PATCH {frag_id}: {r.status_code} → tags={tags}")


def patch_type_and_tags(frag_id, new_type, tags):
    r = requests.patch(
        f"{BASE}/v1/admin/fragments/{frag_id}",
        json={"type": new_type, "tags": tags},
        headers=headers
    )
    print(f"  PATCH {frag_id}: {r.status_code} → type={new_type}, tags={tags}")


# 1. Type fixes: pricing → reference + add compétences/expertise/produit:twake-workplace
print("=== Group 4: Type pricing → reference ===")
group4 = [
    "frag-20b2b9f5-4941-400d-9894-ca01f237a448",
    "frag-0ff0dfb7-3e8e-4e2d-a808-4b2cd4a33770",
    "frag-511aaf94-2e42-4441-a8f5-cf3f32cd020e",
    "frag-8ad37f37-0f67-4ab2-8827-83c678f443a2",
    "frag-a83b087c-4274-4368-92ed-6500702aef33",
]
for frag_id in group4:
    tags = get_tags(frag_id)
    if tags is None:
        continue
    for t in ["compétences", "expertise", "produit:twake-workplace"]:
        if t not in tags:
            tags = tags + [t]
    patch_type_and_tags(frag_id, "reference", tags)

# 2. Add produit:twake-workplace to non-tabular twake fragments
print("\n=== Group 1: Add produit:twake-workplace ===")
group1 = [
    "frag-cf3f4ed6-4bc6-4513-b01b-7757930107ab",
    "frag-e40cb7b4-7340-4c41-bb51-997e06f84529",
    "frag-389088b4-51b8-4731-b7f5-cde275bf3f4b",
    "frag-3b4b6ffb-5e93-4f91-9b57-ff3716f1043c",
    "frag-72c44a42-f14b-4d07-968c-2c449437f39e",
    "frag-af77ff2c-13a4-4ca2-bb8b-15dde592ac5f",
    "frag-bd68e08a-032f-444a-a8ff-5182350359b8",
    "frag-2ba23980-a7ec-409b-8647-bd1d5aec5f52",
    "frag-a1267e91-ff7b-4263-8636-b40b498e9125",
    "frag-c79f0504-1013-43da-9a82-115828d3f185",
    "frag-3a08cc26-f352-4c27-a8e9-b5f9de5866dc",
    "frag-bc7a0788-ddaa-45ab-9a8f-59a1285487ce",
    "frag-22f09f4c-6d11-4502-8c36-466da9f95c9e",
    "frag-23e1a40e-d3c3-4fd1-86e6-bd0e4cd68c79",
    "frag-0faaa74b-fbef-4d74-874c-b08c9ab58b2a",
    "frag-642faad8-e967-41fd-bb24-c4d1ebfbd823",
    "frag-48755717-87dc-499f-a7bc-b9bb30c5f41f",
]
for frag_id in group1:
    tags = get_tags(frag_id)
    if tags is None:
        continue
    if "produit:twake-workplace" not in tags:
        tags = tags + ["produit:twake-workplace"]
        patch_tags(frag_id, tags)
    else:
        print(f"  SKIP (already has tag): {frag_id}")

# 3. Add performance to engagement tabular fragments
print("\n=== Group 2: Add performance ===")
group2 = [
    "frag-e22216ee-153a-42d0-ba7f-4de204a4a166",
    "frag-429f33e6-a4ee-4148-9023-a1de9d90da9f",
    "frag-adbb82bb-f714-4e72-a1b0-ae43ce6b1af2",
    "frag-c7afa0de-f4d9-4a36-a862-9aded6a240ea",
    "frag-ff3bb453-70d3-4b1f-aa6d-0e9fd86bddd7",
    "frag-735381e3-d8db-40e1-8484-32117759ecdd",
    "frag-40c3caff-6ca3-4c77-b9e5-3aca702a4728",
    "frag-b5242187-1cd1-4e3f-a15c-fe7fd7d37b13",
    "frag-8c8ced21-5e0e-497e-a9bc-c94fe5a3a186",
    "frag-cf8f5c0b-4c1e-4561-a23e-a3e405d59926",
    "frag-3ce0cf4b-5bff-4a6d-b6ca-59568623a6cc",
    "frag-42dcb24a-4f50-4219-bb3f-7c013f5fd4d5",
    "frag-82f98032-4c88-4e78-a1c6-c1be68807d23",
    "frag-9a0a0650-fc97-4d82-a9a4-2b11feeb54563",
    "frag-8a71e3f2-b2f7-4c3a-9e5d-12df57584c1b",
]
for frag_id in group2:
    tags = get_tags(frag_id)
    if tags is None:
        continue
    if "performance" not in tags:
        tags = tags + ["performance"]
        patch_tags(frag_id, tags)
    else:
        print(f"  SKIP (already has tag): {frag_id}")

# 4. Add référentiels to RGESN reference fragments
print("\n=== Group 3: Add référentiels ===")
group3 = [
    "frag-0521b330-681a-4f58-b3e3-61a99bd7d31e",
    "frag-f5fadc13-5ab7-4af4-b247-7dc1c159ae9c",
    "frag-26416345-c1a1-4e2f-8ca2-a7906bac28ae",
    "frag-eeb8a326-8477-4686-bc79-f448af55b675",
    "frag-595a976a-407a-4af1-98a0-2061b5435c7b",
    "frag-bbb6d8a9-6d28-4082-a0c5-f6b8ae4cb396",
]
for frag_id in group3:
    tags = get_tags(frag_id)
    if tags is None:
        continue
    if "référentiels" not in tags:
        tags = tags + ["référentiels"]
        patch_tags(frag_id, tags)
    else:
        print(f"  SKIP (already has tag): {frag_id}")

print("\nMigration terminée. Relancer un reindex Milvus si activé.")
```

---

## 3b. Préfixes descriptifs + tag `engagement` — fragments tabulaires Twake (2026-06-09 v2)

Contexte : les fragments tabulaires Twake n'apparaissaient jamais dans les sections de plan correspondantes. Diagnostic : leurs corps étaient trop courts et dépourvus de mots-clés thématiques → les vecteurs Milvus étaient insuffisamment proches des requêtes de section → ils n'entraient pas dans `vectorCandidates` (list1) → disparaissaient si le LLM juge ne les scorait pas.

**Correction** : ajout d'une ligne descriptive en tête de chaque corps de fragment tabulaire (améliore les embeddings Milvus + le scoring LLM juge). Pour le groupe SLA/engagement : ajout du tag `engagement` en plus (Pool A détecte "engagement" dans "Engagement et contact").

**⚠ Milvus reindex requis après cette migration :** `POST /v1/index/trigger`

### Groupe A — 7 fragments methodology/migration

Préfixe ajouté : `Tableau de migration Twake Workplace — réversibilité des données par module applicatif.`

| Fichier | ID | Module |
|---|---|---|
| `methodology-twake-fr-0ce6fc91.md` | `frag-35dc1473` | Agendas |
| `methodology-twake-fr-613995b4.md` | `frag-fdc76384` | Chat/Historique |
| `methodology-twake-fr-b585b949.md` | `frag-8dcedfcc` | Contacts |
| `methodology-twake-fr-d8672ef9.md` | `frag-e862e1f0` | Fichiers/GED |
| `methodology-twake-fr-a608a27e.md` | `frag-7ae6070a` | Messagerie |
| `methodology-twake-fr-8602df45.md` | `frag-6c9b0eda` | Tâches |
| `methodology-twake-fr-14371b70.md` | `frag-4927dcbf` | Workflows |

### Groupe B — 11 fragments reference/incidents+audit

Préfixe ajouté : `Tableau de sécurité et conformité Twake Workplace — gestion des incidents et audits.`

| Fichier | ID | Phase/Type |
|---|---|---|
| `reference-twake-fr-e58c907e.md` | `frag-67de92fc` | 1. Détection |
| `reference-twake-fr-cba265a9.md` | `frag-a60571cf` | 2. Qualification |
| `reference-twake-fr-6e15fe.md` | `frag-91b9cf25` | 3. Notification |
| `reference-twake-fr-05d189e7.md` | `frag-5abdbe75` | 4. Comité urgence |
| `reference-twake-fr-92dff900.md` | `frag-ecbad3b1` | 5. Remédiation |
| `reference-twake-fr-17404944.md` | `frag-9878ae2c` | 6. Post-mortem |
| `reference-twake-fr-31bb572e.md` | `frag-8b153740` | Audit ANSSI / externe |
| `reference-twake-fr-ff398f55.md` | `frag-1584909e` | Audit de code |
| `reference-twake-fr-51f55980.md` | `frag-b14218da` | Revue des accès |
| `reference-twake-fr-f6895f4d.md` | `frag-884bd910` | Scan de vulnérabilités |
| `reference-twake-fr-113ccd18.md` | `frag-d28e5576` | Tests d'intrusion |

### Groupe C — 15 fragments engagement/SLA

Préfixe ajouté : `Tableau des engagements de service SLA Twake Workplace — niveaux de service, GTI/GTR.`
Tag ajouté : `engagement` (Pool A détecte "engagement" dans titre de section "Engagement et contact").

| Fichier | ID | Indicateur |
|---|---|---|
| `engagement-twake-fr-702a4728.md` | `frag-40c3caff` | Capacité visioconférence |
| `engagement-twake-fr-04a4a166.md` | `frag-e22216ee` | Disponibilité plateforme |
| `engagement-twake-fr-d6a240ea.md` | `frag-c7afa0de` | Latence messagerie instantanée |
| `engagement-twake-fr-d86bddd7.md` | `frag-ff3bb453` | Qualité audio/vidéo (MOS) |
| `engagement-twake-fr-d7d37b13.md` | `frag-b5242187` | Scalabilité |
| `engagement-twake-fr-7759ecdd.md` | `frag-735381e3` | Synchronisation messagerie |
| `engagement-twake-fr-ce6b1af2.md` | `frag-adbb82bb` | Temps de réponse API |
| `engagement-twake-fr-9d90da9f.md` | `frag-429f33e6` | Temps de réponse pages |
| `engagement-twake-fr-e5a3a186.md` | `frag-8c8ced21` | 216 min indisponibilité |
| `engagement-twake-fr-3f5fd4d5.md` | `frag-42dcb24a` | GTI BLOQUANTE |
| `engagement-twake-fr-57584c1b.md` | `frag-8a71e3f2` | GTR BLOQUANTE |
| `engagement-twake-fr-8623a6cc.md` | `frag-3ce0cf4b` | GTI MAJEURE |
| `engagement-twake-fr-eeb54563.md` | `frag-9a0a0650` | GTR MAJEURE |
| `engagement-twake-fr-05d59926.md` | `frag-cf8f5c0b` | GTI MINEURE |
| `engagement-twake-fr-68807d23.md` | `frag-82f98032` | GTR MINEURE |

**Action prod (API) :**
```python
# Ajouter préfixes + tag engagement via API (après section 3 du script ci-dessous)
MIGRATION_IDS = ["frag-35dc1473-...", ...]
SECURITY_IDS  = ["frag-67de92fc-...", ...]
SLA_IDS       = ["frag-40c3caff-...", ...]

MIGRATION_PREFIX = "Tableau de migration Twake Workplace — réversibilité des données par module applicatif.\n\n"
SECURITY_PREFIX  = "Tableau de sécurité et conformité Twake Workplace — gestion des incidents et audits.\n\n"
SLA_PREFIX       = "Tableau des engagements de service SLA Twake Workplace — niveaux de service, GTI/GTR.\n\n"

for groups, prefix, add_engagement in [
    (MIGRATION_IDS, MIGRATION_PREFIX, False),
    (SECURITY_IDS, SECURITY_PREFIX, False),
    (SLA_IDS, SLA_PREFIX, True),
]:
    for fid in groups:
        frag = requests.get(f"{BASE}/v1/fragments/{fid}", headers=headers).json()
        body = frag.get("body", "")
        if not body.startswith("Tableau"):
            patch = {"body": prefix + body}
            if add_engagement:
                tags = frag.get("tags", [])
                if "engagement" not in tags:
                    patch["tags"] = tags + ["engagement"]
            r = requests.patch(f"{BASE}/v1/admin/fragments/{fid}", json=patch, headers=headers)
            print(f"  PATCH {fid}: {r.status_code}")

# Déclencher le reindex Milvus
requests.post(f"{BASE}/v1/index/trigger", headers=headers)
print("Reindex déclenché.")
```

---

## 4. Règles de tagging

| Tag | Signification | Quand l'utiliser |
|---|---|---|
| `produit:twake-workplace` | Fragment relatif à Twake Workplace | Tous les fragments `domain: twake` qui décrivent la plateforme (arguments, intro, méthodologie, référence) |
| `performance` | Fragment contenant des indicateurs de performance (SLA, disponibilité, temps de réponse) | Tableaux `type: engagement` avec métriques chiffrées — pas les textes narratifs |
| `référentiels` | Fragment issu d'un référentiel réglementaire ou normatif | RGESN, RGS, RGPD, NIS2, SecNumCloud — tableaux de conformité |
| `compétences` | Fragment relatif aux compétences du personnel | Matrices expertise collaborateurs — `type: reference`, pas `pricing` |
| `expertise` | Complément de `compétences` pour les matrices d'expertise | Idem — toujours ajouté avec `compétences` |
| `rgesn` | Fragment spécifique au référentiel RGESN | Sous-ensemble de `référentiels` — toujours ajouté en même temps que `référentiels` pour les fragments RGESN |

**Ne pas taguer `produit:twake-workplace` :** fragments génériques LINAGORA corporate, fragments d'autres domaines (openrag, james, linto) même s'ils mentionnent Twake au passage.
