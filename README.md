# Fragmint

**Bibliotheque de fragments de contenu versionnee pour la production documentaire souveraine assistee par IA.**

[![Licence AGPL-3.0](https://img.shields.io/badge/licence-AGPL--3.0-blue.svg)](LICENSE)
[![Node.js 20+](https://img.shields.io/badge/node.js-20%2B-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue.svg)](https://www.typescriptlang.org/)

---

## Presentation

Les entreprises et administrations produisent quotidiennement des documents complexes -- devis, propositions commerciales, contrats, rapports -- en assemblant manuellement des blocs de texte disperses dans des fichiers Word, des e-mails et des bases de connaissances heterogenes. Ce processus est lent, source d'erreurs et incompatible avec les exigences de souverainete numerique.

**Fragmint** resout ce probleme en proposant :

- Une **bibliotheque de fragments** (introductions, argumentaires, clauses, tarifs) versionnee dans Git
- Une **recherche semantique** via embeddings vectoriels (Milvus + nomic-embed-text-v2-moe)
- Un **moteur de composition** qui assemble les fragments dans des templates DOCX
- Un **moissonneur (Harvester)** qui extrait automatiquement des fragments depuis des documents existants via LLM
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

### Recherche

- Recherche semantique via Milvus + embeddings nomic-embed-text-v2-moe
- Fallback SQLite full-text quand Milvus n'est pas disponible
- Filtres par type, domaine, langue, qualite
- Inventaire thematique avec analyse de couverture

### Templates et composition

- Templates DOCX avec slots de fragments et metadonnees
- Syntaxe docx-templates (`+++INS ...+++`, `+++FOR ...+++`, `+++IF ...+++`)
- Composition automatique avec resolution des fragments par domaine/langue/qualite
- Telechargement du document genere

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

- 8 outils pour Claude Code et Claude Desktop
- Gestion complete des fragments et composition depuis l'assistant IA

### CLI

- Commandes pour la gestion des fragments, templates, composition et moissonnage
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
                  |  8 outils MCP     |
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
git clone https://github.com/linagora/fragmint.git
cd fragmint
pnpm install
```

### Demarrer le serveur

```bash
npx tsx packages/server/src/index.ts
```

Le serveur demarre sur http://localhost:3210.

### Ouvrir l'interface web

Construire le frontend, puis acceder a l'interface :

```bash
pnpm --filter @fragmint/web build
```

Ouvrir http://localhost:3210/ui/ dans un navigateur.

### Identifiants par defaut (mode dev)

| Login    | Mot de passe   | Role  |
|----------|----------------|-------|
| mmaudet  | fragmint-dev   | admin |

> En production, definir `NODE_ENV=production` et `FRAGMINT_JWT_SECRET` avec une valeur aleatoire securisee.

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

Fragmint expose 8 outils via le protocole MCP pour Claude Code et Claude Desktop :

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
| [docs/getting-started.md](docs/getting-started.md) | Guide de demarrage rapide |
| [docs/api.md](docs/api.md) | Reference de l'API REST |
| [docs/mcp.md](docs/mcp.md) | Integration MCP (Claude Code / Desktop) |
| [docs/docker.md](docs/docker.md) | Deploiement Docker |
| [docs/architecture.md](docs/architecture.md) | Architecture technique |
| [docs/template-syntax.md](docs/template-syntax.md) | Syntaxe des templates DOCX |

---

## Tests

```bash
# Tous les tests unitaires (server + web + mcp)
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
| 8     | Plugin Obsidian                                | Prevu       |
| 9     | Formats XLSX/PPTX, workflows de validation     | Prevu       |

---

## Licence

[AGPL-3.0-only](LICENSE)

Copyright (c) 2024-2026 LINAGORA
