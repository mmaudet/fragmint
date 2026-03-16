# Fragmint

**Bibliotheque de fragments de contenu versionnee pour la production documentaire souveraine assistee par IA.**

[![Licence AGPL-3.0](https://img.shields.io/badge/licence-AGPL--3.0-blue.svg)](LICENSE)
[![Node.js 20+](https://img.shields.io/badge/node.js-20%2B-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue.svg)](https://www.typescriptlang.org/)

---

## Presentation

Les entreprises et administrations produisent quotidiennement des documents complexes -- devis, propositions commerciales, contrats, rapports -- en assemblant manuellement des blocs de texte disperses dans des fichiers Word, des e-mails et des bases de connaissances heterogenes. Ce processus est lent, source d'erreurs et incompatible avec les exigences de souverainete numerique.

**Fragmint** resout ce probleme en proposant :

- Une **bibliotheque de fragments** (introductions, argumentaires, clauses, tarifs) versionnee dans Git, organisee en **collections** (partitions privees/partagees, multi-tenant)
- Une **recherche semantique** via embeddings vectoriels (Milvus + nomic-embed-text-v2-moe)
- Un **moteur de composition multi-format** qui assemble les fragments dans des templates DOCX, XLSX, Marp (slides Markdown) et reveal.js (slides HTML)
- Un **moissonneur (Harvester)** qui extrait automatiquement des fragments depuis des documents existants via Pandoc + Ollama LLM
- Un **serveur MCP** pour l'integration directe avec Claude Code et Claude Desktop
- Un fonctionnement **air-gap compatible** -- tout tourne en local, sans dependance cloud

Fragmint est developpe par [LINAGORA](https://linagora.com/) sous licence AGPL-3.0.

---

## Fonctionnalites

### Fragments

- CRUD complet avec versionnement Git automatique
- Cycle de qualite : `draft` -> `reviewed` -> `approved` -> `deprecated`
- Lignee (parent, traductions) et historique complet
- Tags structures (cle:valeur) pour les donnees tabulaires

### Collections

- Multi-tenant : partitions `common` (partagee) et `team`/`project` (privees)
- Isolation des fragments par collection avec controle d'acces (admin, editor, reader)
- Composition cross-collection (contenu generique + contenu specifique)

### Recherche

- Recherche semantique via Milvus + embeddings nomic-embed-text-v2-moe
- Fallback SQLite full-text quand Milvus n'est pas disponible
- Filtres par type, domaine, langue, qualite
- Inventaire thematique avec analyse de couverture

### Templates et composition

- **Moteur de rendu multi-format** : DOCX (docx-templates), XLSX (ExcelJS), Marp (slides Markdown), reveal.js (slides HTML)
- Syntaxe docx-templates (`+++INS ...+++`, `+++FOR ...+++`, `+++IF ...+++`)
- Syntaxe XLSX avec `${field}` et `${table:array.field}`
- Directive `+++HTML path+++` pour la conversion Markdown vers HTML (reveal.js)
- Auto-calcul des totaux (devis) : `total` par ligne, `total_ht`, `tva`, `total_ttc`
- Composition automatique avec resolution des fragments par domaine/langue/qualite

### Moissonneur (Harvester)

- Upload de fichiers DOCX -> extraction via Pandoc
- Segmentation et classification par LLM (Ollama)
- Detection de doublons par similarite semantique
- Interface de validation humaine (accepter, modifier, fusionner, rejeter)

### Interface web

- React 19 + shadcn/ui + Tailwind CSS
- Vues : Bibliotheque, Inventaire, Compositeur, Validation, Ingestion
- Internationalisation FR/EN, mode sombre
- Authentification JWT

### MCP (Model Context Protocol)

- 9 outils pour Claude Code et Claude Desktop
- Gestion complete des fragments, collections et composition depuis l'assistant IA

### CLI

- Commandes pour la gestion des fragments, collections, templates, composition et moissonnage
- Configuration via `~/.fragmintrc.yaml` ou variables d'environnement

---

## Architecture

```
fragmint/
|-- packages/
|   |-- server/     API REST Fastify 5 + SQLite + Drizzle ORM
|   |-- web/        Frontend React 19 + shadcn/ui + Vite
|   |-- mcp/        Serveur MCP (stdio) pour Claude
|   |-- cli/        CLI (commander.js)
|   |-- obsidian/   Plugin Obsidian (prevu)
|
|-- example-vault/  Vault de demo (fragments + templates)
|-- docker/         Configuration Docker
|-- docs/           Documentation
|-- e2e/            Tests end-to-end + demo LinCloud
|-- scripts/        Scripts utilitaires
```

```
                  +-------------------+
                  |   Claude Code /   |
                  |   Claude Desktop  |
                  +--------+----------+
                           | MCP (stdio)
                  +--------v----------+
                  |  @fragmint/mcp    |
                  |  9 outils MCP     |
                  +--------+----------+
                           | HTTP
+-------------+   +--------v----------+   +-----------+
| @fragmint/  |   |  @fragmint/server |   |  Ollama   |
|    web      +-->|  Fastify 5 REST   +-->|  LLM +    |
| React 19    |   |  31+ endpoints    |   |  Embeddings|
+-------------+   +--------+----------+   +-----------+
                           |
              +------------+------------+
              |            |            |
        +-----v----+ +----v-----+ +----v-----+
        |  SQLite   | |  Git     | |  Milvus  |
        |  Drizzle  | |  Vault   | | (option) |
        +----------+ +----------+ +----------+
```

---

## Demarrage rapide

### Prerequis

- **Node.js** >= 20 (recommande : 24.x)
- **pnpm** (active via corepack : `corepack enable`)
- **Pandoc** (pour le moissonnage DOCX)
- **Ollama** (optionnel, pour la recherche semantique et le moissonnage LLM)
- **Milvus** (optionnel, pour la recherche vectorielle -- SQLite fait office de fallback)

### Installation

```bash
git clone https://github.com/mmaudet/fragmint.git
cd fragmint
pnpm install
pnpm --filter @fragmint/web build
```

### Demarrer le serveur

```bash
npx tsx packages/server/src/index.ts
```

Le serveur demarre sur http://localhost:3210. L'interface web est accessible sur http://localhost:3210/ui/.

Identifiants par defaut (mode developpement) : `mmaudet` / `fragmint-dev`

> **Note :** L'etape `pnpm --filter @fragmint/web build` est indispensable avant le premier demarrage. Sans elle, l'interface web retourne une erreur 404.

### Identifiants par defaut (mode dev)

| Login    | Mot de passe   | Role  |
|----------|----------------|-------|
| mmaudet  | fragmint-dev   | admin |

> En production, definir `NODE_ENV=production` et `FRAGMINT_JWT_SECRET` avec une valeur aleatoire securisee.

### Tester rapidement avec la demo LinCloud

```bash
# Lancer le serveur puis, dans un autre terminal :
bash e2e/demo/run-demo.sh
```

Ce script cree 10 fragments, uploade 4 templates (DOCX, XLSX, Marp, reveal.js) et compose les 4 documents. Les fichiers generes sont dans `e2e/demo/output/`.

Voir le guide complet : [docs/getting-started.md](docs/getting-started.md)

---

## Docker

```bash
docker compose up -d
```

Cela demarre 3 services :

| Service   | Port  | Description                          |
|-----------|-------|--------------------------------------|
| fragmint  | 3210  | Serveur API + frontend               |
| milvus    | 19530 | Base vectorielle (recherche semantique) |
| ollama    | 11434 | LLM local (moissonnage + embeddings) |

Pour pre-charger les modeles Ollama :

```bash
docker compose exec ollama ollama pull nomic-embed-text-v2-moe
docker compose exec ollama ollama pull mistral-nemo:12b
```

Voir le guide complet : [docs/docker.md](docs/docker.md)

---

## MCP

Fragmint expose 9 outils via le protocole MCP pour Claude Code et Claude Desktop :

| Outil               | Description                              |
|---------------------|------------------------------------------|
| fragment_inventory  | Diagnostiquer la couverture d'un sujet   |
| fragment_search     | Recherche semantique avec filtres        |
| fragment_get        | Obtenir un fragment complet              |
| fragment_create     | Creer un nouveau fragment                |
| fragment_update     | Mettre a jour un fragment                |
| fragment_lineage    | Arbre de derivation et traductions       |
| document_compose    | Composer un document depuis un template  |
| fragment_harvest    | Moissonner des fragments depuis un DOCX  |
| collection_list     | Lister les collections accessibles       |

Configuration dans `.claude/settings.json` :

```json
{
  "mcpServers": {
    "fragmint": {
      "command": "npx",
      "args": ["tsx", "packages/mcp/src/index.ts"],
      "env": {
        "FRAGMINT_URL": "http://localhost:3210",
        "FRAGMINT_TOKEN": "votre-token"
      }
    }
  }
}
```

Voir le guide complet : [docs/mcp.md](docs/mcp.md)

---

## CLI

```bash
# Demarrer le serveur
fragmint serve

# Gestion des fragments
fragmint fragments list
fragmint fragments get <id>
fragmint fragments create --type argument --domain commercial --lang fr

# Collections
fragmint collections list
fragmint collections create projet-x --name "Projet X" --type project

# Templates et composition
fragmint templates list
fragmint compose <template-id> --context '{"client":"Acme"}'

# Moissonnage
fragmint harvest document.docx

# Administration
fragmint admin users list
fragmint admin tokens create --name "mcp" --role reader
```

---

## API

L'API REST est accessible sur le port 3210 (par defaut) avec authentification JWT.

```bash
# Authentification
curl -X POST http://localhost:3210/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"mmaudet","password":"fragmint-dev"}'

# Lister les fragments
curl http://localhost:3210/v1/fragments \
  -H "Authorization: Bearer <token>"
```

Reference complete : [docs/api.md](docs/api.md)

---

## Documentation

| Document | Description |
|----------|-------------|
| [Guide d'onboarding](docs/guide-demo-onboarding.md) | Guide complet avec la demo LinCloud — creation de fragments, templates multi-format, composition |
| [Guide d'utilisation](docs/guide-utilisation.md) | Scenarios par persona (admin, redacteur, expert, agent IA) |
| [Reference API](docs/api.md) | Tous les endpoints REST (fragments, templates, harvest, collections) |
| [Architecture](docs/architecture.md) | Structure monorepo, services, schema DB, flux de donnees |
| [MCP](docs/mcp.md) | Integration Claude Code / Claude Desktop (9 tools) |
| [Docker](docs/docker.md) | Deploiement contenerise (fragmint + milvus + ollama) |
| [Syntaxe templates](docs/template-syntax.md) | Reference rapide des syntaxes par format |
| [Demarrage rapide](docs/getting-started.md) | Installation et premier document |
| [Demo E2E](e2e/demo/README.md) | Script de demonstration LinCloud Souverain |

---

## Tests

```bash
# Tous les tests unitaires (~200 tests, server + web + mcp)
pnpm test

# Tests en mode watch
pnpm test:watch

# Tests E2E (Playwright)
pnpm --filter @fragmint/web e2e

# Verification TypeScript
pnpm lint
```

---

## Feuille de route

| Phase | Description                                    | Statut      |
|-------|------------------------------------------------|-------------|
| 0     | Bootstrap monorepo + API CRUD fragments        | Termine     |
| 1     | Qualite, versionnement Git, audit              | Termine     |
| 2     | Recherche semantique (Milvus + embeddings)     | Termine     |
| 3     | Moteur de composition DOCX                     | Termine     |
| 4     | Interface web React                            | Termine     |
| 5     | Moissonneur (Harvester)                        | Termine     |
| 6     | Serveur MCP                                    | Termine     |
| 7     | CLI, Docker, tests E2E                         | Termine     |
| —     | Collections (multi-tenant)                     | Termine     |
| —     | Moteur de rendu multi-format (XLSX, Marp, reveal.js) | Termine |
| 8     | Plugin Obsidian                                | Reporte     |
| 9     | GraphRAG                                       | Post-MVP    |
| 10    | Community summaries                            | Post-MVP    |

---

## Licence

[AGPL-3.0-only](LICENSE)

Copyright (c) 2024-2026 LINAGORA
