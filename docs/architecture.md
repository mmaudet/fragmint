# Architecture technique

---

## Structure du monorepo

```
fragmint/
|-- packages/
|   |-- server/         API REST (Fastify 5, TypeScript)
|   |-- web/            Frontend (React 19, Vite, shadcn/ui)
|   |-- mcp/            Serveur MCP pour Claude
|   |-- cli/            Interface en ligne de commande
|   |-- obsidian/       Plugin Obsidian (prevu)
|
|-- example-vault/      Vault de demonstration
|   |-- fragments/      Fichiers Markdown des fragments
|   |-- templates/      Templates DOCX + YAML
|
|-- docker/             Configuration Docker
|-- docs/               Documentation
|-- scripts/            Scripts utilitaires
|-- vitest.workspace.ts Configuration des tests
|-- pnpm-workspace.yaml Definition des workspaces pnpm
```

---

## Responsabilites des packages

### @fragmint/server

Le coeur de l'application. Expose une API REST sur le port 3210.

| Composant              | Fichier(s)                          | Responsabilite                                |
|------------------------|-------------------------------------|-----------------------------------------------|
| Point d'entree         | `src/index.ts`                      | Creation du serveur, injection des dependances |
| Configuration          | `src/config.ts`                     | Chargement env + fichier YAML                 |
| Routes auth            | `src/routes/auth-routes.ts`         | POST /v1/auth/login                           |
| Routes fragments       | `src/routes/fragment-routes.ts`     | CRUD, search, inventory, lineage, history     |
| Routes templates       | `src/routes/template-routes.ts`     | CRUD templates, composition, download         |
| Routes harvest         | `src/routes/harvest-routes.ts`      | Upload DOCX, statut, validation               |
| Routes admin           | `src/routes/admin-routes.ts`        | Utilisateurs, tokens, audit, index            |
| FragmentService        | `src/services/fragment-service.ts`  | Logique metier fragments                      |
| TemplateService        | `src/services/template-service.ts`  | Logique metier templates                      |
| ComposerService        | `src/services/composer-service.ts`  | Moteur de composition DOCX                    |
| HarvesterService       | `src/services/harvester-service.ts` | Pipeline de moissonnage                       |
| LlmClient              | `src/services/llm-client.ts`        | Client API LLM (Ollama)                       |
| UserService            | `src/services/user-service.ts`      | Gestion des utilisateurs                      |
| TokenService           | `src/services/token-service.ts`     | Gestion des tokens API                        |
| AuditService           | `src/services/audit-service.ts`     | Journal d'audit                               |
| RenderEngine           | `src/services/render-engine.ts`     | Wrapper de rendu unifie (DOCX, stubs XLSX/PPTX) |
| SearchService          | `src/search/`                       | Recherche semantique (Milvus + fallback SQLite) |
| EmbeddingClient        | `src/search/`                       | Client d'embeddings (Ollama)                  |
| GitRepository          | `src/git/git-repository.ts`         | Operations Git (commit, history, diff, restore) |
| Schema DB              | `src/db/schema.ts`                  | Tables SQLite (Drizzle ORM)                   |
| Auth middleware         | `src/auth/middleware.ts`            | Verification JWT + roles                      |

### @fragmint/web

Frontend SPA servi par le serveur Fastify sur `/ui/`.

| Composant        | Repertoire              | Description                              |
|------------------|-------------------------|------------------------------------------|
| Pages            | `src/pages/`            | fragments, inventory, compose, harvest, validation, login |
| Composants UI    | `src/components/`       | shadcn/ui + composants metier            |
| Client API       | `src/api/`              | Appels HTTP vers le serveur              |
| Mocks            | `src/mocks/`            | MSW (Mock Service Worker) pour les tests |
| Layouts          | `src/layouts/`          | Layout principal avec navigation         |
| i18n             | `src/lib/`              | Internationalisation FR/EN               |

Technologies : React 19, React Router 7, TanStack Query, Vite, Tailwind CSS, shadcn/ui.

### @fragmint/mcp

Serveur MCP communiquant via stdio avec Claude Code et Claude Desktop.

| Composant        | Fichier                 | Description                              |
|------------------|-------------------------|------------------------------------------|
| Point d'entree   | `src/index.ts`         | Serveur MCP + transport stdio            |
| Client API       | `src/client.ts`        | Client HTTP vers le serveur Fragmint     |
| Outils           | `src/tools/`           | 8 outils MCP (inventory, search, get, create, update, lineage, compose, harvest) |

### @fragmint/cli

Interface en ligne de commande construite avec commander.js.

| Composant        | Fichier                        | Description                    |
|------------------|--------------------------------|--------------------------------|
| Point d'entree   | `src/index.ts`                | Registre des commandes         |
| Commandes        | `src/commands/serve.ts`       | Demarrer le serveur            |
|                  | `src/commands/fragments.ts`    | Gestion des fragments          |
|                  | `src/commands/templates.ts`    | Gestion des templates          |
|                  | `src/commands/compose.ts`      | Composition de documents       |
|                  | `src/commands/harvest.ts`      | Moissonnage                    |
|                  | `src/commands/admin.ts`        | Administration                 |

---

## Schema de la base de donnees

La base SQLite est geree par Drizzle ORM. Schema defini dans `packages/server/src/db/schema.ts`.

### Table `fragments`

| Colonne            | Type    | Description                              |
|--------------------|---------|------------------------------------------|
| id                 | TEXT PK | Identifiant unique                       |
| type               | TEXT    | Type (argument, clause, introduction...) |
| domain             | TEXT    | Domaine metier (commercial, juridique...)  |
| lang               | TEXT    | Langue (fr, en)                          |
| quality            | TEXT    | Qualite (draft, reviewed, approved, deprecated) |
| author             | TEXT    | Auteur de la creation                    |
| title              | TEXT    | Titre du fragment                        |
| body_excerpt       | TEXT    | Extrait du corps (pour les listes)       |
| created_at         | TEXT    | Date de creation (ISO)                   |
| updated_at         | TEXT    | Date de derniere modification            |
| uses               | INTEGER | Nombre d'utilisations en composition     |
| parent_id          | TEXT    | ID du fragment parent (derivation)       |
| translation_of     | TEXT    | ID du fragment traduit                   |
| tags               | TEXT    | Tags JSON (tableau de strings)           |
| file_path          | TEXT    | Chemin relatif dans le vault             |
| git_hash           | TEXT    | Hash du dernier commit Git               |
| origin             | TEXT    | Origine (manual, harvested)              |
| origin_source      | TEXT    | Fichier source (si moissonne)            |
| origin_page        | INTEGER | Page d'origine (si moissonne)            |
| harvest_confidence | REAL    | Score de confiance du moissonnage        |

### Table `templates`

| Colonne        | Type    | Description                    |
|----------------|---------|--------------------------------|
| id             | TEXT PK | Identifiant unique             |
| name           | TEXT    | Nom du template                |
| description    | TEXT    | Description                    |
| output_format  | TEXT    | Format de sortie (docx)        |
| version        | TEXT    | Version semantique             |
| template_path  | TEXT    | Chemin vers le fichier DOCX    |
| yaml_path      | TEXT    | Chemin vers le fichier YAML    |
| author         | TEXT    | Auteur                         |
| created_at     | TEXT    | Date de creation               |
| updated_at     | TEXT    | Date de modification           |
| git_hash       | TEXT    | Hash du commit Git             |

### Table `harvest_jobs`

| Colonne       | Type    | Description                         |
|---------------|---------|-------------------------------------|
| id            | TEXT PK | Identifiant du job                  |
| status        | TEXT    | Statut (processing, completed, failed) |
| files         | TEXT    | Noms des fichiers (JSON)            |
| pipeline      | TEXT    | Pipeline utilise                    |
| min_confidence| REAL    | Seuil de confiance minimum          |
| stats         | TEXT    | Statistiques (JSON)                 |
| error         | TEXT    | Message d'erreur                    |
| created_by    | TEXT    | Utilisateur ayant lance le job      |
| created_at    | TEXT    | Date de creation                    |
| updated_at    | TEXT    | Date de mise a jour                 |

### Table `harvest_candidates`

| Colonne         | Type    | Description                         |
|-----------------|---------|-------------------------------------|
| id              | TEXT PK | Identifiant du candidat             |
| job_id          | TEXT    | Reference au job parent             |
| title           | TEXT    | Titre propose                       |
| body            | TEXT    | Contenu extrait                     |
| type            | TEXT    | Type propose                        |
| domain          | TEXT    | Domaine propose                     |
| lang            | TEXT    | Langue detectee                     |
| tags            | TEXT    | Tags proposes (JSON)                |
| confidence      | REAL    | Score de confiance (0-1)            |
| origin_source   | TEXT    | Fichier source                      |
| origin_page     | INTEGER | Page d'origine                      |
| duplicate_of    | TEXT    | ID du fragment similaire existant   |
| duplicate_score | REAL    | Score de similarite                 |
| status          | TEXT    | Statut (pending, accepted, rejected) |
| fragment_id     | TEXT    | ID du fragment cree (si accepte)    |

### Table `users`

| Colonne        | Type    | Description              |
|----------------|---------|--------------------------|
| id             | TEXT PK | Identifiant unique       |
| login          | TEXT    | Login unique             |
| display_name   | TEXT    | Nom affichable           |
| role           | TEXT    | Role (reader, contributor, expert, admin) |
| password_hash  | TEXT    | Hash du mot de passe     |
| created_at     | TEXT    | Date de creation         |
| last_login     | TEXT    | Derniere connexion       |
| active         | INTEGER | Compte actif (0/1)       |

### Table `api_tokens`

| Colonne      | Type    | Description              |
|--------------|---------|--------------------------|
| id           | TEXT PK | Identifiant unique       |
| name         | TEXT    | Nom du token             |
| token_hash   | TEXT    | Hash du token            |
| token_lookup | TEXT    | Prefixe de recherche     |
| role         | TEXT    | Role associe             |
| owner        | TEXT    | Proprietaire             |
| created_at   | TEXT    | Date de creation         |
| last_used    | TEXT    | Derniere utilisation     |
| active       | INTEGER | Token actif (0/1)        |

### Table `audit_log`

| Colonne      | Type        | Description                  |
|--------------|-------------|------------------------------|
| id           | INTEGER PK  | Auto-increment               |
| timestamp    | TEXT        | Date de l'evenement (ISO)    |
| user_id      | TEXT        | Utilisateur ayant agi        |
| role         | TEXT        | Role de l'utilisateur        |
| action       | TEXT        | Action effectuee             |
| fragment_id  | TEXT        | Fragment concerne            |
| diff_summary | TEXT        | Resume du changement         |
| ip_source    | TEXT        | Adresse IP source            |

---

## Flux de donnees

### Cycle de vie d'un fragment

```
Creation (API/CLI/MCP/Harvest)
    |
    v
  draft -----> reviewed -----> approved -----> deprecated
    ^              |               |
    |              v               v
    +--- modification         utilisation
         (nouvelle version     en composition
          Git commitee)
```

Chaque modification genere un commit Git dans le vault. L'historique complet est consultable via l'API.

### Flux de composition

```
Requete de composition
    |
    v
1. Charger le template (DOCX + YAML)
    |
    v
2. Resoudre les slots de fragments
   (par ID explicite ou par filtres domaine/langue/qualite)
    |
    v
3. Assembler l'objet JSON (fragments + metadata)
    |
    v
4. Injecter dans le template DOCX (docx-templates)
    |
    v
5. Generer le fichier de sortie
    |
    v
6. Retourner l'URL de telechargement
```

### Pipeline de moissonnage

```
Upload DOCX
    |
    v
1. Extraction du texte (Pandoc : DOCX -> texte)
    |
    v
2. Segmentation par LLM (Ollama)
   - Decoupage en fragments candidats
   - Classification (type, domaine, langue)
   - Attribution d'un score de confiance
    |
    v
3. Detection de doublons
   - Calcul d'embeddings pour chaque candidat
   - Recherche de fragments similaires existants
   - Marquage des doublons potentiels
    |
    v
4. Stockage des candidats (statut: pending)
    |
    v
5. Validation humaine
   - Accepter : creation du fragment
   - Modifier : ajustement avant creation
   - Fusionner : combiner avec un existant
   - Rejeter : suppression du candidat
```

### Recherche semantique

```
Requete utilisateur
    |
    v
Prefixe "search_query: " + requete
    |
    v
Calcul de l'embedding (Ollama / nomic-embed-text-v2-moe)
    |
    +--> Milvus disponible ?
    |        |
    |     Oui: recherche vectorielle dans Milvus
    |        |
    |     Non: fallback SQLite
    |        (comparaison cosinus en memoire)
    |
    v
Filtrage par type/domaine/langue/qualite
    |
    v
Resultats tries par pertinence
```

---

## Decisions techniques

| Decision                         | Justification                                                      |
|----------------------------------|--------------------------------------------------------------------|
| **SQLite + Drizzle ORM**         | Zero configuration, embarquable, fichier unique, compatible air-gap |
| **Git pour le versionnement**    | Historique complet, diff natif, export trivial, standard universel  |
| **Milvus optionnel**             | Performance sur de gros volumes, mais SQLite suffit pour commencer  |
| **nomic-embed-text-v2-moe**      | Modele MoE performant, supporte les prefixes de tache, tourne en local |
| **Ollama**                       | LLM local, souverain, pas de dependance cloud                      |
| **docx-templates**               | Moteur DOCX mature, syntaxe simple, MIT, pas de dependance Java    |
| **Fastify 5**                    | Performant, typage TypeScript natif, plugins riches                 |
| **React 19 + shadcn/ui**         | Composants accessibles, personnalisables, pas de lock-in framework |
| **pnpm workspaces**              | Monorepo leger, resolution stricte, rapide                         |
| **MCP (Model Context Protocol)** | Standard Anthropic pour l'integration avec les assistants IA       |
| **Markdown + frontmatter**       | Format de stockage universel, lisible, editable manuellement       |
| **AGPL-3.0**                     | Garantit la souverainete logicielle et le partage des ameliorations |
