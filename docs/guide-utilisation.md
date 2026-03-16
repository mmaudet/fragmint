# Guide d'utilisation de Fragmint

> **Voir aussi :** Le [guide d'onboarding de la démo](guide-demo-onboarding.md) propose un cas d'usage concret (LinCloud Souverain) avec la création de templates dans tous les formats.

## 1. Introduction

Fragmint est un systeme de gestion de fragments de contenu destine aux equipes qui redigent des propositions commerciales, des appels d'offres et des documents structurees. Chaque fragment (argument, clause, temoignage, FAQ, etc.) est versionne, classe par domaine et langue, et soumis a un workflow de qualite (draft, reviewed, approved). Fragmint permet de rechercher, composer et reutiliser ces fragments pour produire des documents professionnels coherents et a jour.

### Les 3 interfaces

Fragmint propose trois modes d'interaction complementaires :

- **Frontend web** : interface graphique accessible sur `http://localhost:3210/ui/`. Permet de naviguer dans la bibliotheque, creer des fragments, composer des documents et gerer les validations.
- **CLI** (`fragmint`) : outil en ligne de commande pour toutes les operations (fragments, templates, composition, ingestion, administration). Ideal pour l'automatisation et les scripts.
- **MCP** (Model Context Protocol) : interface utilisee par les agents IA comme Claude. Expose 6 outils (`fragment_create`, `fragment_search`, `fragment_get`, `fragment_update`, `fragment_inventory`, `fragment_lineage`) que l'IA appelle directement.

### Le concept de Collections

Les collections organisent et isolent les fragments. Chaque fragment appartient a une collection. La collection `common` est partagee par toute l'equipe. Des collections de type `team` ou `project` permettent de cloisonner le contenu par equipe ou par projet client. L'acces aux collections est gere par des roles (admin, editor, reader).

---

## 2. Personas

Ce guide suit quatre personas tout au long des scenarios :

| Persona | Role | Description |
|---------|------|-------------|
| **Marie** | Admin systeme | Installe et configure Fragmint, gere les utilisateurs et les collections |
| **Jean** | Redacteur commercial | Cree, recherche et compose des propositions a partir de fragments |
| **Sophie** | Experte contenu | Valide et approuve les fragments pour garantir leur qualite |
| **Claude** | Agent IA (via MCP) | Assiste les utilisateurs en recherchant, creant et diagnostiquant les fragments |

---

## 3. Scenario 1 : Installation et configuration (Marie, admin)

Marie est responsable de l'infrastructure. Elle deploie Fragmint pour son equipe.

### Via Docker (recommande)

La methode la plus simple utilise Docker Compose. Le fichier `docker-compose.yml` lance trois services : Fragmint, Milvus (recherche vectorielle) et Ollama (modele d'embedding et LLM).

```bash
# Cloner le depot
git clone https://github.com/linagora/fragmint.git
cd fragmint

# Lancer tous les services
docker compose up -d
```

Fragmint est accessible sur `http://localhost:3210`. L'interface web est servie sur `http://localhost:3210/ui/`.

### Via installation locale (developpement)

Pour un environnement de developpement, Marie peut lancer le serveur directement avec Node.js 24 :

```bash
# Installer les dependances
pnpm install

# Lancer le serveur en mode developpement
npx tsx packages/server/src/index.ts
```

Le serveur demarre sur le port 3210 par defaut. Marie peut aussi utiliser la commande CLI :

```bash
fragmint serve
```

### Configuration initiale

#### Creer les utilisateurs

Marie se connecte avec le compte admin par defaut, puis cree les comptes pour Jean et Sophie :

```bash
# Verifier les utilisateurs existants
fragmint admin users list

# Les utilisateurs sont crees via l'API ou le frontend d'administration
```

#### Verifier la collection commune

La collection `common` est creee automatiquement au premier demarrage. Marie verifie qu'elle existe :

```bash
fragmint collections list
# [common] Common (team) — 1 members
```

#### Creer une collection projet

Marie cree une collection dediee a un projet client :

```bash
fragmint collections create projet-client-x --name "Projet Client X" --type project
# Collection created: projet-client-x
```

Elle ajoute Jean comme editeur de cette collection :

```bash
fragmint collections add-member projet-client-x <jean-id> --role editor
# Member <jean-id> added to projet-client-x with role editor.
```

---

## 4. Scenario 2 : Creer et organiser des fragments (Jean, redacteur)

Jean redige du contenu commercial. Il cree des fragments reutilisables dans la bibliotheque.

### Via le frontend web

1. Se connecter sur `http://localhost:3210/ui/`
2. Aller dans **Bibliotheque** depuis la sidebar
3. Cliquer sur le bouton **"+ Nouveau"**
4. Remplir le formulaire :
   - **Type** : `argument`
   - **Domaine** : `souverainete`
   - **Langue** : `fr`
   - **Contenu** (Markdown) :
     ```markdown
     # Souverainete numerique

     Le cloud souverain garantit que vos donnees restent sur le territoire
     national, conformement aux reglementations europeennes (RGPD, NIS2).
     Nos solutions sont hebergees dans des datacenters certifies SecNumCloud.
     ```
   - **Tags** : `cloud`, `rgpd`, `securite`
5. Cliquer **Enregistrer** : le fragment est cree en qualite **draft**

### Via la CLI

```bash
fragmint fragment add \
  --type argument \
  --domain souverainete \
  --lang fr \
  --body "# Souverainete numerique\n\nLe cloud souverain garantit que vos donnees restent sur le territoire national, conformement aux reglementations europeennes (RGPD, NIS2). Nos solutions sont hebergees dans des datacenters certifies SecNumCloud." \
  --tags "cloud,rgpd,securite" \
  --collection common
# Fragment created: frag-a1b2c3d4
```

Pour verifier :

```bash
fragmint fragment get frag-a1b2c3d4 --collection common
# ID:      frag-a1b2c3d4
# Type:    argument
# Domain:  souverainete
# Lang:    fr
# Quality: draft
# Author:  jean
# ---
# # Souverainete numerique
# ...
```

### Via MCP (Claude)

Quand Jean demande a Claude de creer un fragment, l'agent appelle :

```
fragment_create({
  type: "argument",
  domain: "souverainete",
  lang: "fr",
  body: "# Souverainete numerique\n\nLe cloud souverain garantit...",
  tags: ["cloud", "rgpd", "securite"],
  collection_slug: "common"
})
```

Le fragment est cree en qualite `draft`. Claude ne peut pas l'approuver directement : seul un humain (Sophie) peut le faire.

---

## 5. Scenario 3 : Rechercher des fragments (Jean)

Jean prepare une proposition commerciale et cherche du contenu existant sur le cloud souverain.

### Via le frontend web

1. Utiliser la **barre de recherche** en haut de la Bibliotheque
2. Taper : `cloud souverain`
3. Affiner avec les **filtres** :
   - Type : `argument`
   - Langue : `fr`
   - Qualite minimum : `approved` (pour n'avoir que du contenu valide)
4. Les resultats sont classes par pertinence semantique (score)

### Via la CLI

```bash
fragmint fragment search "cloud souverain" --collection common --type argument --lang fr
# [frag-a1b2c3d4] argument / souverainete (fr) — approved
# [frag-e5f6g7h8] argument / cloud (fr) — reviewed
```

Pour obtenir le detail en JSON :

```bash
fragmint fragment search "cloud souverain" --collection common --json
```

### Via MCP (Claude)

```
fragment_search({
  query: "cloud souverain",
  type: "argument",
  lang: "fr",
  quality_min: "approved",
  collection_slugs: ["common"]
})
```

Claude recoit les resultats avec des scores de pertinence et peut les presenter a Jean.

---

## 6. Scenario 4 : Valider et approuver (Sophie, experte)

Sophie est responsable de la qualite des fragments. Elle valide le contenu avant qu'il soit utilise dans les documents officiels.

### Workflow de qualite

Le cycle de vie d'un fragment suit trois etapes :

1. **draft** : le fragment vient d'etre cree, il peut etre modifie librement
2. **reviewed** : le fragment a ete relu, il est candidat a l'approbation
3. **approved** : le fragment est valide par une experte, il peut etre utilise en composition

### Via le frontend web

1. Aller dans la page **Validation** depuis la sidebar
2. La liste affiche les fragments en statut `reviewed` en attente de validation
3. Cliquer sur un fragment pour ouvrir le detail
4. Lire le contenu, verifier la coherence et l'exactitude
5. Deux actions possibles :
   - **Approuver** : le fragment passe en qualite `approved`
   - **Demander une modification** : le fragment reste en `reviewed` avec un commentaire

### Via la CLI

Sophie peut aussi approuver un fragment depuis la ligne de commande :

```bash
fragmint fragment approve frag-a1b2c3d4 --collection common
# Fragment frag-a1b2c3d4 approved.
```

Pour deprecier un fragment obsolete :

```bash
fragmint fragment deprecate frag-old-xyz --collection common
# Fragment frag-old-xyz deprecated.
```

### Via MCP (Claude)

L'agent IA peut passer un fragment en `reviewed` pour signaler qu'il est pret a etre valide :

```
fragment_update({
  id: "frag-a1b2c3d4",
  quality: "reviewed",
  collection_slug: "common"
})
```

Note : Claude ne peut pas approuver un fragment (`approved`). L'approbation est reservee aux humains.

---

## 7. Scenario 5 : Composer un document (Jean)

Jean doit produire une proposition commerciale pour la Gendarmerie nationale. Il utilise le compositeur.

### Via le frontend web

1. Aller dans la page **Compositeur**
2. Selectionner le template **"Proposition commerciale"** dans la liste
3. Remplir le contexte du document :
   - **Langue** : `fr`
   - **Produit** : `twake`
   - **Client** : `Gendarmerie`
4. Le compositeur resout automatiquement les slots du template :
   - Slots **verts** : un fragment `approved` correspond
   - Slots **rouges** : aucun fragment adequat trouve (lacune)
5. Jean peut surcharger un slot en selectionnant un fragment different
6. Cliquer **"Composer"** pour generer le document
7. Telecharger le fichier `.docx` produit

### Via la CLI

```bash
fragmint compose tpl-proposition-commerciale-001 \
  --context '{"lang":"fr","product":"twake","client":"Gendarmerie"}' \
  --collection common \
  --output ./proposition-gendarmerie.docx
# Document generated: /api/v1/collections/common/documents/doc-xyz
# Resolved: 12 fragments
# Render time: 340ms
# Saved to: ./proposition-gendarmerie.docx
```

### Via MCP (Claude)

Claude peut diagnostiquer la couverture avant de composer :

```
fragment_inventory({
  topic: "twake",
  lang: "fr",
  collection_slug: "common"
})
```

Puis declencher la composition si la couverture est suffisante. La composition via MCP n'est pas encore disponible dans la version actuelle.

---

## 8. Scenario 6 : Ingerer des documents existants (Jean)

Jean a d'anciennes propositions en `.docx`. Il veut en extraire les fragments reutilisables.

### Via le frontend web

1. Aller dans la page **Ingestion**
2. Glisser-deposer un fichier `.docx` dans la zone de depot
3. Regler le **seuil de confiance** (par defaut 65%)
   - Plus haut : moins de candidats mais plus fiables
   - Plus bas : plus de candidats mais avec du bruit
4. Cliquer **"Analyser"**
5. L'IA decoupe le document en candidats-fragments :
   - Chaque candidat a un type detecte, un domaine, un score de confiance
   - Les doublons potentiels sont signales
6. Revoir chaque candidat :
   - **Accepter** : le candidat devient un fragment
   - **Rejeter** : le candidat est ecarte
   - Modifier le type ou le domaine si necessaire
7. Cliquer **"Commiter"** : les candidats acceptes sont crees en qualite `draft`

### Via la CLI

```bash
fragmint harvest proposition-2024.docx --min-confidence 0.65 --collection common
# Uploading proposition-2024.docx...
# Job created: job-abc123
# ........
#
# Results: 18 candidates
#   Valid: 14
#   Duplicates: 2
#   Low confidence: 2
#
# Candidates:
#   [92%] argument/souverainete — Souverainete des donnees
#   [87%] clause/rgpd — Clause RGPD standard
#   [78%] pricing/twake — Grille tarifaire Twake
#   [45%] faq/support — FAQ support [LOW CONFIDENCE]
#   ...
```

### Via MCP (Claude)

L'ingestion via MCP n'est pas encore disponible dans la version actuelle. Jean doit utiliser le frontend ou la CLI.

---

## 9. Scenario 7 : Travailler avec les Collections (Marie + Jean)

Les collections permettent de cloisonner les fragments par equipe ou par projet.

### Marie cree une collection projet

```bash
# Creer la collection
fragmint collections create projet-anfsi --name "Projet ANFSI" --type team
# Collection created: projet-anfsi

# Ajouter Jean comme editeur
fragmint collections add-member projet-anfsi <jean-id> --role editor
# Member <jean-id> added to projet-anfsi with role editor.

# Verifier les membres
fragmint collections members projet-anfsi
# [<jean-id>] Jean Dupont — editor
```

### Jean travaille dans sa collection

#### Frontend

Dans la sidebar, Jean utilise le **selecteur de collection** pour basculer de `common` vers **"Projet ANFSI"**. Tous les ecrans (Bibliotheque, Recherche, Compositeur) filtrent automatiquement sur la collection selectionnee.

#### CLI

Toutes les commandes CLI acceptent l'option `--collection` :

```bash
# Rechercher dans la collection projet
fragmint fragment search "securite" --collection projet-anfsi

# Creer un fragment dans la collection projet
fragmint fragment add \
  --type clause \
  --domain securite \
  --lang fr \
  --body "# Clause de securite ANFSI\n\nLes acces sont controles par authentification multi-facteur..." \
  --collection projet-anfsi
```

#### MCP

L'agent precise la collection dans chaque appel :

```
fragment_search({
  query: "securite",
  collection_slugs: ["projet-anfsi"]
})
```

### Isolation verifiee

Les fragments de `projet-anfsi` ne sont **pas visibles** depuis la collection `common`. L'isolation est garantie au niveau de l'API.

Si Marie retire Jean de la collection, son acces est immediatement revoque :

```bash
fragmint collections remove-member projet-anfsi <jean-id>
# Member <jean-id> removed from projet-anfsi.
```

Jean ne pourra plus acceder aux fragments de cette collection, ni via le frontend, ni via la CLI, ni via MCP.

### Composition cross-collection

Un template dans `common` peut resoudre des fragments provenant de `projet-anfsi`, a condition que l'utilisateur ait acces aux deux collections. Cela permet de combiner du contenu generique (common) avec du contenu specifique au projet.

---

## 10. Scenario 8 : Inventaire et couverture (Sophie)

Sophie veut avoir une vue d'ensemble de la bibliotheque pour identifier les lacunes.

### Via le frontend web

La page **Inventaire** affiche :

- **Metriques globales** : nombre total de fragments, repartition par qualite (draft, reviewed, approved)
- **Couverture par domaine** : barres de progression FR/EN pour chaque domaine
- **Lacunes detectees** : combinaisons type/domaine/langue manquantes

Sophie identifie par exemple qu'il manque des fragments de type `temoignage` dans le domaine `twake` en anglais.

### Via la CLI

```bash
# Inventaire global
fragmint fragment inventory --collection common

# Inventaire par sujet
fragmint fragment inventory --topic souverainete --collection common

# Lacunes detectees
fragmint fragment gaps --collection common
# Coverage gaps:
#   - temoignage / twake (en)
#   - faq / openrag (fr)
#   - pricing / linshare (en)
```

### Via MCP (Claude)

```
fragment_inventory({
  topic: "souverainete",
  collection_slug: "common"
})
```

Claude recoit les metriques et peut formuler des recommandations : "Il manque 3 temoignages clients en anglais sur le domaine twake. Voulez-vous que j'en cree des brouillons ?"

---

## 11. Configuration avancee

### Variables d'environnement

| Variable | Description | Valeur par defaut |
|----------|-------------|-------------------|
| `FRAGMINT_PORT` | Port du serveur | `3210` |
| `FRAGMINT_STORE_PATH` | Chemin du vault de stockage | `./example-vault` |
| `FRAGMINT_JWT_SECRET` | Secret pour les tokens JWT | aleatoire |
| `FRAGMINT_JWT_TTL` | Duree de vie des tokens JWT | `8h` |
| `FRAGMINT_LOG_LEVEL` | Niveau de log (`debug`, `info`, `warn`, `error`) | `info` |
| `FRAGMINT_TRUST_PROXY` | Activer le mode proxy inverse | `false` |
| `FRAGMINT_CORS_ORIGIN` | Origines CORS autorisees (separees par des virgules) | `http://localhost:3210` |
| `FRAGMINT_MILVUS_ENABLED` | Activer la recherche vectorielle Milvus | `false` |
| `FRAGMINT_MILVUS_ADDRESS` | Adresse du serveur Milvus | `localhost:19530` |
| `FRAGMINT_MILVUS_COLLECTION` | Nom de la collection Milvus | `fragmint_fragments` |
| `FRAGMINT_EMBEDDING_ENDPOINT` | URL du service d'embedding (Ollama) | `http://localhost:11434/v1` |
| `FRAGMINT_EMBEDDING_MODEL` | Modele d'embedding | `nomic-embed-text-v2-moe` |
| `FRAGMINT_EMBEDDING_DIMENSIONS` | Dimensions des vecteurs | `768` |
| `FRAGMINT_EMBEDDING_BATCH_SIZE` | Taille des lots d'embedding | `32` |
| `FRAGMINT_EMBEDDING_MAX_TOKENS` | Nombre max de tokens par embedding | `480` |
| `FRAGMINT_EMBEDDING_PREFIX_DOCUMENT` | Prefixe pour les documents | `search_document: ` |
| `FRAGMINT_EMBEDDING_PREFIX_QUERY` | Prefixe pour les requetes | `search_query: ` |
| `FRAGMINT_EMBEDDING_PREFIX_CLUSTER` | Prefixe pour le clustering | `clustering: ` |
| `FRAGMINT_LLM_ENDPOINT` | URL du LLM (Ollama) | `http://localhost:11434/v1` |
| `FRAGMINT_LLM_MODEL` | Modele LLM pour l'ingestion et l'analyse | `mistral-nemo:12b` |
| `FRAGMINT_LLM_TEMPERATURE` | Temperature du LLM | `0.2` |
| `FRAGMINT_LLM_TIMEOUT` | Timeout du LLM en millisecondes | `60000` |
| `FRAGMINT_COLLECTIONS_PATH` | Chemin racine des collections | derive de `FRAGMINT_STORE_PATH` |

### Configuration CLI

La CLI se configure via des options en ligne de commande, des variables d'environnement ou un fichier `~/.fragmintrc.yaml` :

```yaml
# ~/.fragmintrc.yaml
url: http://localhost:3210
token: votre-token-api
```

Priorite de resolution : options CLI > variables d'environnement > fichier `.fragmintrc.yaml`.

Pour obtenir un token API :

```bash
fragmint admin token create "cli-jean" --role contributor
# Token created: tok-abc123
# Secret (save this, it will not be shown again): frag_xxxxxxxxxxxx
```

### Mode air-gap (deconnecte)

Pour deployer Fragmint dans un environnement sans acces internet :

```bash
# 1. Sur une machine connectee : sauvegarder les images Docker
docker save fragmint milvusdb/milvus:v2.4.0 ollama/ollama:latest | gzip > fragmint-images.tar.gz

# 2. Transferer fragmint-images.tar.gz sur la machine cible

# 3. Sur la machine cible : charger les images
docker load < fragmint-images.tar.gz

# 4. Pre-charger les modeles Ollama
docker compose exec ollama ollama pull nomic-embed-text-v2-moe
docker compose exec ollama ollama pull mistral-nemo:12b

# 5. Lancer Fragmint
docker compose up -d
```

### i18n et mode sombre

- **Langue de l'interface** : toggle FR/EN dans la sidebar du frontend
- **Mode sombre** : toggle jour/nuit dans la sidebar du frontend

---

## 12. Reference rapide

### Tableau recapitulatif des actions

| Action | Frontend | CLI | MCP |
|--------|----------|-----|-----|
| Creer un fragment | Bibliotheque > + Nouveau | `fragmint fragment add --type ... --domain ... --lang ... --body "..."` | `fragment_create({type, domain, lang, body})` |
| Rechercher | Barre de recherche + filtres | `fragmint fragment search "requete" --collection ...` | `fragment_search({query, collection_slugs})` |
| Consulter un fragment | Cliquer sur un fragment | `fragmint fragment get <id>` | `fragment_get({id})` |
| Modifier un fragment | Editeur dans le detail | (via API) | `fragment_update({id, body, ...})` |
| Approuver | Page Validation > Approuver | `fragmint fragment approve <id>` | (non disponible) |
| Deprecier | Page Validation > Deprecier | `fragmint fragment deprecate <id>` | (non disponible) |
| Composer un document | Compositeur > template > Composer | `fragmint compose <template-id> --context '...' --output fichier.docx` | (non disponible) |
| Ingerer un document | Ingestion > glisser .docx | `fragmint harvest fichier.docx --min-confidence 0.65` | (non disponible) |
| Inventaire | Page Inventaire | `fragmint fragment inventory --topic ...` | `fragment_inventory({topic})` |
| Lacunes | Page Inventaire (section lacunes) | `fragmint fragment gaps` | `fragment_inventory({topic})` |
| Lignee d'un fragment | Detail > onglet Lignee | (via API) | `fragment_lineage({id})` |
| Lister les collections | Selecteur sidebar | `fragmint collections list` | (non disponible) |
| Creer une collection | Admin | `fragmint collections create <slug> --name "..." --type team` | (non disponible) |
| Ajouter un membre | Admin | `fragmint collections add-member <slug> <user-id> --role editor` | (non disponible) |
| Lister les templates | Compositeur | `fragmint templates list` | (non disponible) |
| Creer un token API | Admin | `fragmint admin token create "nom" --role contributor` | (non disponible) |
| Consulter les logs d'audit | Admin | `fragmint admin audit --from 2025-01-01` | (non disponible) |

### Types de fragments

`introduction`, `argument`, `pricing`, `clause`, `faq`, `conclusion`, `bio`, `temoignage`

### Roles des collections

| Role | Lire | Creer | Modifier | Approuver | Admin |
|------|------|-------|----------|-----------|-------|
| `reader` | oui | non | non | non | non |
| `editor` | oui | oui | oui | non | non |
| `admin` | oui | oui | oui | oui | oui |

### Roles des tokens API

`reader`, `contributor`, `expert`, `admin`
