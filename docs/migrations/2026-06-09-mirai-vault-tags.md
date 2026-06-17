# Migration vault — Tags MIRAI (2026-06-09)

Contexte : séance de debug du plan "Proposition LINAGORA pour le déploiement de l'Assistant MIRAI au Ministère de l'Intérieur". Objectif : que les sections générées soient cohérentes avec les fragments disponibles, en utilisant le filtre `tags: [client:mirai, openrag]` sur le plan.

---

## Plan filter à configurer en prod

Dans le plan MIRAI, aller dans **1. Specs** et mettre dans le champ Tags :

```
client:mirai, openrag
```

Ce filtre fait deux choses :
- Le **corpus summary** envoyé au LLM ne liste que les types qui ont au moins un fragment `client:mirai` ou `openrag` → le LLM ne propose pas de section "Services d'hébergement" s'il n'y a pas de fragments hébergement MIRAI.
- Le **Pool A** de la recherche de fragments (boosting par tags) remonte du contenu MIRAI **et** OpenRAG.

---

## 1. Fragment supprimé

| Fichier | ID | Raison |
|---|---|---|
| `fragments/methodology-linagora-fr-34799fc4.md` | `frag-c4b2d439-9b63-4b01-8960-91b834799fc4` | Fragment trop court (2 lignes) : "Cette procédure est détaillée dans le PAQS (§4.2.2.4 et §5.3)." — aucune valeur informative |

**Action prod :**
```bash
rm fragments/methodology-linagora-fr-34799fc4.md
```

---

## 2. Modifications de tags sur fragments existants

### 2a. Fragments conclusion — tags simplifiés (prévention contamination cross-sections)

Ces fragments avaient des tags thématiques (souveraineté, performance, etc.) qui les faisaient remonter dans des sections non-conclusion via le Pool A. Les tags ont été réduits à `[conclusion]` uniquement, puis `client:mirai` ajouté aux deux premiers.

| Fichier | ID | Avant | Après |
|---|---|---|---|
| `conclusion-linagora-fr-467a7abe.md` | `frag-13fc968f-8464-4c55-9d9f-24a0467a7abe` | `souveraineté, service, performance, souverain, audit, rgpd, sso, trust, client:mirai, linagora, accompagnement` | `conclusion, client:mirai` |
| `conclusion-linagora-fr-89ef351a.md` | `frag-87903ef8-a091-487b-b1b1-8fa489ef351a` | `souveraineté, service, client:canut, réponse` | `conclusion` |
| `conclusion-mirai-fr-ee9c1542.md` | `frag-ebcbdcfa-f309-4fce-a50c-cadaee9c1542` | `souveraineté, transformation-digitale, excellence-technologique, client:mirai, linagora, réponse, conclusion` | `conclusion, client:mirai` |

### 2b. Fragments MIRAI doc — ajout `client:mirai`

Ces fragments sont issus de `PR_MINISTERE_INTERIEUR_ACCOMPAGNEMENT_MIRAI_31079.docx` mais n'avaient pas le tag `client:mirai`.

| Fichier | ID | Tag ajouté |
|---|---|---|
| `argument-linagora-fr-dc81946c.md` | `frag-ae087b82-5dd4-453d-8773-ededdc81946c` | `client:mirai` |
| `argument-linagora-ia-fr-75a2e1e5.md` | `frag-f935fef0-808b-4548-bc52-b6c375a2e1e5` | `client:mirai` |
| `methodology-linagora-ia-fr-04dfdb75.md` | `frag-0b86d744-51ad-4320-a11d-8d0f04dfdb75` | `client:mirai` |
| `methodology-linagora-ia-fr-93363ccc.md` | `frag-8e464820-f051-4ebb-851d-5ca293363ccc` | `client:mirai` |

### 2c. Fragments OpenRAG — ajout tag `openrag`

OpenRAG est un produit LINAGORA, pas un client. Ces fragments ont `domain: openrag` mais n'avaient pas le tag `openrag` dans leur liste de tags. Le tag `openrag` (et non `client:mirai`) leur permet de remonter via le filtre `openrag` du plan.

| Fichier | ID | Tag ajouté |
|---|---|---|
| `introduction-openrag-fr-6ad617b3.md` | `frag-371bb9f5-f621-426c-91aa-934a6ad617b3` | `openrag` |
| `argument-openrag-fr-51e80812.md` | `frag-9fba1524-7754-4d95-8d3d-182b51e80812` | `openrag` |
| `argument-openrag-fr-eb11e8ba.md` | `frag-69c8b657-d0a0-4a3a-b198-5aedeb11e8ba` | `openrag` |
| `argument-openrag-fr-cbb2aa80.md` | `frag-c42085ef-74ea-424d-a760-2499cbb2aa80` | `openrag` |
| `faq-linagora-fr-23456789.md` | `frag-c3d4e5f6-a7b8-4c9d-0e1f-2a3b23456789` | avait déjà `openrag` ✓ |

---

## 3. Nouveaux fragments (non présents dans vault initial)

Ces fragments ont été créés manuellement ou par harvest. Ils doivent être présents dans le vault de production. Vérifier leur existence avant l'ingestion.

### 3a. Fragments FAQ — à créer si absents

| Fichier | ID | Tags |
|---|---|---|
| `faq-linagora-fr-23456789.md` | `frag-c3d4e5f6-a7b8-4c9d-0e1f-2a3b23456789` | `intégration, api, openrag, déploiement, interopérabilité` |
| `faq-linagora-fr-abcdef01.md` | `frag-b2c3d4e5-f6a7-4b8c-9d0e-f1a2abcdef01` | `souveraineté, rgpd, données, hébergement, open-source, client:secteur-public` |
| `faq-linagora-fr-fedcba98.md` | _(voir fichier)_ | `déploiement, on-premise, formation, accompagnement, maintenance` |

### 3b. Fragments référentiels réglementaires — à créer si absents

Ces fragments couvrent les certifications applicables aux projets publics français (RGS, RGPD, SecNumCloud, NIS2). Tag `client:secteur-public` pour qu'ils remontent dans tout plan secteur public sans être marqués MIRAI-spécifiques.

| Fichier | ID | Tags |
|---|---|---|
| `reference-linagora-fr-e3f4a5b6.md` | `frag-d2e3f4a5-b6c7-4d8e-9f0a-1b2ce3f4a5b6` | `rgs, nis2, pgssi, sécurité, conformité, client:secteur-public` |
| `reference-linagora-fr-d1e2f3a4.md` | `frag-c0d1e2f3-a4b5-4c6d-7e8f-9a0bd1e2f3a4` | `rgpd, conformité, données-personnelles, cnil, privacy, souveraineté, client:secteur-public` |
| `reference-linagora-fr-c9d0e1f2.md` | `frag-b8c9d0e1-f2a3-4b4c-5d6e-7f8ac9d0e1f2` | `secnumcloud, anssi, qualification, cloud, souveraineté, hébergement, client:secteur-public` |

### 3c. Fragments engagement performance/MCO — à créer si absents

| Fichier | ID | Tags |
|---|---|---|
| `engagement-linagora-fr-f5a6b7c8.md` | `frag-e4f5a6b7-c8d9-4e0f-1a2b-3c4df5a6b7c8` | `performance, kpi, indicateurs, pilotage, qualité, gouvernance` |
| `engagement-linagora-fr-b1c2d3e4.md` | `frag-a0b1c2d3-e4f5-4a6b-7c8d-9e0fb1c2d3e4` | `mco, sla, support, maintenance, disponibilité, client:secteur-public` |

### 3d. Fragments testimonial — à créer si absents

| Fichier | ID | Tags |
|---|---|---|
| `testimonial-linagora-fr-e5f67890.md` | _(voir fichier)_ | `souveraineté, open-source, client:secteur-public, ia, productivité` |
| `testimonial-linagora-fr-12345678.md` | _(voir fichier)_ | `open-source, client:administration-publique, accompagnement, migration, souveraineté` |
| `testimonial-linagora-fr-a1b2c3d4.md` | `frag-3f8a1c2e-b547-4d91-8e3a-7f6da1b2c3d4` | `souveraineté, open-source, client:cnb, messagerie, cloud` — testimonial Conseil National des Barreaux (70 000 avocats, Twake Mail) |

---

## 4. Script de migration (application sur vault existant)

Si le vault de production contient déjà les fragments (ingestion depuis git), ce script applique les modifications de tags manquantes via l'API Fragmint.

```python
#!/usr/bin/env python3
"""
Migration 2026-06-09 — Tags MIRAI
À exécuter après ingestion du vault en production.
Requiert: pip install requests
"""
import requests

BASE = "http://localhost:3210"  # adapter à l'URL de prod
TOKEN = "frag_tok_..."          # token admin

headers = {"Authorization": f"Bearer {TOKEN}"}

# 1. Fragment à supprimer
r = requests.delete(f"{BASE}/v1/admin/fragments/frag-c4b2d439-9b63-4b01-8960-91b834799fc4", headers=headers)
print(f"DELETE methodology-linagora-fr-34799fc4: {r.status_code}")

# 2. Modifications de tags
tag_patches = {
    # Conclusions — tags simplifiés
    "frag-13fc968f-8464-4c55-9d9f-24a0467a7abe": ["conclusion", "client:mirai"],
    "frag-87903ef8-a091-487b-b1b1-8fa489ef351a": ["conclusion"],
    "frag-ebcbdcfa-f309-4fce-a50c-cadaee9c1542": ["conclusion", "client:mirai"],
    # Fragments MIRAI doc
    "frag-ae087b82-5dd4-453d-8773-ededdc81946c": None,  # add client:mirai
    "frag-f935fef0-808b-4548-bc52-b6c375a2e1e5": None,
    "frag-0b86d744-51ad-4320-a11d-8d0f04dfdb75": None,
    "frag-8e464820-f051-4ebb-851d-5ca293363ccc": None,
    # OpenRAG — tag openrag (pas client:mirai, OpenRAG est un produit)
    "frag-371bb9f5-f621-426c-91aa-934a6ad617b3": "openrag",
    "frag-9fba1524-7754-4d95-8d3d-182b51e80812": "openrag",
    "frag-69c8b657-d0a0-4a3a-b198-5aedeb11e8ba": "openrag",
    "frag-c42085ef-74ea-424d-a760-2499cbb2aa80": "openrag",
}

ADD_CLIENT_MIRAI = {
    "frag-ae087b82-5dd4-453d-8773-ededdc81946c",
    "frag-f935fef0-808b-4548-bc52-b6c375a2e1e5",
    "frag-0b86d744-51ad-4320-a11d-8d0f04dfdb75",
    "frag-8e464820-f051-4ebb-851d-5ca293363ccc",
}

ADD_OPENRAG = {
    "frag-371bb9f5-f621-426c-91aa-934a6ad617b3",
    "frag-9fba1524-7754-4d95-8d3d-182b51e80812",
    "frag-69c8b657-d0a0-4a3a-b198-5aedeb11e8ba",
    "frag-c42085ef-74ea-424d-a760-2499cbb2aa80",
}

for frag_id, add_tag in tag_patches.items():
    r = requests.get(f"{BASE}/v1/fragments/{frag_id}", headers=headers)
    if r.status_code != 200:
        print(f"  NOT FOUND: {frag_id}")
        continue
    frag = r.json()
    if isinstance(add_tag, list):
        tags = add_tag  # full replacement (conclusions)
    else:
        tags = frag.get("tags", [])
        if add_tag not in tags:
            tags = tags + [add_tag]
    r2 = requests.patch(
        f"{BASE}/v1/admin/fragments/{frag_id}",
        json={"tags": tags},
        headers=headers
    )
    print(f"  PATCH {frag_id}: {r2.status_code} → tags={tags}")

print("Migration terminée. Relancer un reindex Milvus si activé.")
```

---

## 5. Règles de tagging (pour futurs fragments)

| Tag | Signification | Quand l'utiliser |
|---|---|---|
| `client:mirai` | Fragment issu du doc MIRAI | Fragments `PR_MINISTERE_INTERIEUR_ACCOMPAGNEMENT_MIRAI_31079.docx` uniquement |
| `openrag` | Fragment sur le produit OpenRAG | Tous les fragments `domain: openrag` + FAQ/intro OpenRAG |
| `client:secteur-public` | Référentiels réglementaires FR applicables à tout projet public | RGS, RGPD, NIS2, SecNumCloud, ANSSI — générique, pas MIRAI-spécifique |
| `client:canut` | Fragment issu de la réponse IRA (CANUT) | Uniquement `03 - fragments sélectionnés à la main pour IRA.docx` |
| `client:ira` | Idem | Idem |

**Ne pas taguer `client:mirai` :** fragments génériques LINAGORA corporate (20 ans d'histoire, boilerplate souveraineté) issus d'un autre contexte.
