# Fragmint — Feature Collections (partitions privées/partagées)

**Date:** 2026-03-15
**Status:** Design approved
**Durée estimée:** 4-5 jours
**Dépendances:** aucune — extension pure du schéma et des routes existantes

## Scope

Transformer Fragmint d'un outil mono-tenant en plateforme multi-équipes avec isolation des données par collections. Chaque collection a son propre repo Git, sa partition Milvus, et ses membres avec des rôles hiérarchiques.

### In scope

- 3 types de collections : system (`common`), team, personal
- Modèle de rôles par collection (reader → contributor → expert → manager → owner)
- JWT léger + lookup DB pour l'autorisation par collection
- Routes API préfixées `/v1/collections/:slug/fragments`
- Rétrocompatibilité `/v1/fragments` → redirige vers `common`
- Composition cross-collection (recherche dans toutes les collections accessibles)
- Templates appartenant aux collections avec résolution cross-collection
- MCP collection-aware (collection_list, recherche/création multi-collection)
- Frontend : sélecteur de collection dans la sidebar
- Migration automatique au démarrage (vault existant → collection `common`)
- Tokens externes scopés par collection

### Out of scope

- Interface admin de gestion des collections (CLI + API suffisent pour le MVP)
- Synchronisation inter-instances (single-instance)
- Chiffrement par collection (backlog)

## Existant à ne pas casser

- Un seul repo Git → `FRAGMINT_REPO_PATH` (migré vers `common`)
- Une seule partition Milvus → `fragmint_fragments` (migrée vers `col_common`)
- JWT avec rôle plat : `{ sub, role }` → **conservé tel quel**
- Tous les endpoints `/v1/fragments/*`, `/v1/templates/*` → redirigent vers `common`
- Variable d'env `FRAGMINT_REPO_PATH` → supportée avec warning deprecated

## Modèle de données

### Trois types de collections

| Type | Slug pattern | Comportement |
|------|-------------|-------------|
| `system` | `common` | Auto-assignée à tous les membres. `read_only` configurable. |
| `team` | libre | Accès explicite par utilisateur. Tokens externes possibles. |
| `personal` | `personal-{login}` | Créée automatiquement au login. Owner seul. |

### Un repo Git par collection

```
FRAGMINT_COLLECTIONS_PATH=/data/collections/
  ├── common/              ← migration de l'ancien FRAGMINT_REPO_PATH
  ├── anfsi/
  ├── sfeir/
  └── personal-mmaudet/
```

### Tables SQLite

```sql
CREATE TABLE collections (
  id             TEXT PRIMARY KEY,
  slug           TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  type           TEXT NOT NULL,              -- 'system' | 'team' | 'personal'
  read_only      INTEGER DEFAULT 0,
  auto_assign    INTEGER DEFAULT 0,          -- true pour 'common'
  git_path       TEXT NOT NULL,
  milvus_partition TEXT NOT NULL,            -- 'col_common', 'col_anfsi'...
  owner_id       TEXT,
  description    TEXT,
  tags           TEXT,                        -- JSON array
  created_at     TEXT NOT NULL,
  created_by     TEXT NOT NULL
);

CREATE TABLE collection_memberships (
  id             TEXT PRIMARY KEY,
  collection_id  TEXT NOT NULL REFERENCES collections(id),
  user_id        TEXT REFERENCES users(id),  -- null si token externe
  token_id       TEXT REFERENCES api_tokens(id), -- null si user interne
  role           TEXT NOT NULL,               -- 'reader'|'contributor'|'expert'|'manager'|'owner'
  granted_by     TEXT NOT NULL,
  granted_at     TEXT NOT NULL,
  expires_at     TEXT                         -- null = permanent
);
```

Ajout à `api_tokens` :
```sql
ALTER TABLE api_tokens ADD COLUMN collection_slug TEXT;
```

### Convention de nommage des partitions Milvus

```typescript
function toMilvusPartition(slug: string): string {
  return 'col_' + slug.replace(/-/g, '_');
}
```

Ce helper est la **seule** façon de calculer un nom de partition dans tout le codebase.

## Modèle de rôles par collection

### Hiérarchie

```
reader < contributor < expert < manager < owner
```

| Rôle | Fragments | Membres | Collection |
|------|-----------|---------|-----------|
| `reader` | Lire | — | — |
| `contributor` | + Créer draft, modifier ses propres drafts | — | — |
| `expert` | + Modifier tous, approuver | Voir la liste | — |
| `manager` | + Déprécier | Inviter (≤ expert), retirer, token externe | — |
| `owner` | Tout | Inviter (≤ manager), transférer ownership | Renommer, read_only, supprimer si vide |

### Rôle système global

| Rôle | Droits |
|------|--------|
| `user` | Créer collections `team` (devient `owner` auto) |
| `admin` | Tout : collections `system`, suppression forcée, toutes les collections |

### Règle d'invitation

Un membre ne peut inviter qu'à un rôle **strictement inférieur** au sien.

## Authentification : JWT léger + lookup DB

### JWT inchangé

```typescript
{ sub: 'mmaudet', role: 'admin' }  // pas de collections dans le token
```

### Middleware par requête

À chaque requête sur `/v1/collections/:slug/*` :

```typescript
async function requireCollectionRole(minRole: Role) {
  return async (req, reply) => {
    const { slug } = req.params;

    // Lookup DB — ~0.1ms SQLite
    const membership = await db.select()
      .from(collectionMemberships)
      .where(and(
        eq(collectionMemberships.user_id, req.user.id),
        eq(collectionMemberships.collection_id, /* from slug */),
      ))
      .limit(1);

    if (!membership || !roleAtLeast(membership.role, minRole)) {
      return reply.status(403).send({ data: null, meta: null, error: 'Collection access denied' });
    }

    req.collectionRole = membership.role;
    req.collection = await collectionService.getBySlug(slug);
  };
}
```

### Tokens externes

API token avec `collection_slug` → accès limité à une seule collection avec le rôle défini. Le middleware vérifie `token.collection_slug === req.params.slug`.

### Rétrocompatibilité

- Anciens tokens sans `collection_slug` → accès à `common` avec le rôle global
- Anciens endpoints `/v1/fragments/*` → redirigent vers `/v1/collections/common/fragments/*`

## Composition cross-collection

### Résolution hybride

Par défaut, le ComposerService cherche dans **toutes les collections accessibles** à l'utilisateur :

```sql
SELECT collection_slug FROM collection_memberships WHERE user_id = ?
```

Cette liste est passée au SearchService qui requête Milvus avec :
```typescript
partition_names = accessibleSlugs.map(toMilvusPartition)
```

### Restriction par template

Le `.fragmint.yaml` peut restreindre la recherche :

```yaml
# Globalement pour tout le template
collections: ["common", "anfsi"]

# Ou par slot
fragments:
  - key: introduction
    type: introduction
    collections: ["common"]         # cherche uniquement dans common
  - key: pricing
    type: pricing
    collection: "anfsi"             # force une seule collection
```

**Règles de résolution (par ordre de priorité) :**
1. Slot a `collection:` → une seule collection (erreur 403 si pas d'accès)
2. Slot a `collections:` → liste restreinte (intersectée avec les accès user)
3. Template a `collections:` → s'applique aux slots sans restriction propre
4. Aucune restriction → toutes les collections accessibles

### Templates cross-collection

Un template dans la collection `anfsi` peut résoudre des fragments depuis `common`. Les templates ne sont pas isolés dans leur collection pour la résolution de fragments.

## API Endpoints

### Endpoints collections

| Méthode | Route | Rôle min | Description |
|---------|-------|----------|-------------|
| GET | `/v1/collections` | reader (global) | Lister ses collections accessibles |
| POST | `/v1/collections` | user (global) | Créer une collection team (admin pour system) |
| GET | `/v1/collections/:slug` | reader (collection) | Détail d'une collection |
| PUT | `/v1/collections/:slug` | owner (collection) | Modifier nom, description, read_only |
| DELETE | `/v1/collections/:slug` | owner (collection) | Supprimer si vide (admin pour forcer) |
| POST | `/v1/collections/:slug/members` | manager (collection) | Ajouter un membre |
| DELETE | `/v1/collections/:slug/members/:userId` | manager (collection) | Retirer un membre |
| POST | `/v1/collections/:slug/tokens` | manager (collection) | Créer token externe |

### Endpoints fragments préfixés

Tous les endpoints fragments existants deviennent :
```
/v1/collections/:slug/fragments/*
```

Les anciens endpoints `/v1/fragments/*` redirigent vers `/v1/collections/common/fragments/*`.

Même chose pour les templates :
```
/v1/collections/:slug/templates/*
```

Et le harvest :
```
/v1/collections/:slug/harvest/*
```

## Migration automatique au démarrage

Dans `createServer()`, avant l'initialisation des services :

```
1. Si FRAGMINT_COLLECTIONS_PATH non défini :
   - Si FRAGMINT_REPO_PATH défini → COLLECTIONS_PATH = dirname(REPO_PATH)
   - Sinon → défaut /data/collections ou ./example-vault/..

2. Si table collections est vide (premier lancement) :
   - Créer collection 'common' (type=system, auto_assign=true)
   - git_path = repo existant (REPO_PATH ou example-vault)
   - Assigner tous les users existants (admins→expert, autres→reader)
   - Créer collections personnelles pour chaque user existant
   - Renommer partition Milvus 'fragmint_fragments' → 'col_common' (si Milvus dispo)
   - Log: "Migration: created 'common' collection from existing vault"

3. Si FRAGMINT_REPO_PATH utilisé → log warning deprecated
```

## MCP collection-aware

### Nouvel outil `collection_list`

Premier appel que l'agent doit faire. Retourne les collections accessibles avec leur sémantique.

```typescript
{
  name: 'collection_list',
  description: 'Liste les collections accessibles. Appeler en premier pour savoir où chercher ou créer.',
  inputSchema: { properties: {} }
}
// Retourne: slug, name, type, role, read_only, description, tags, stats
```

### Outils existants étendus

**`fragment_search`** — ajout paramètre `collection_slugs` (string[] | "all", défaut "all") :
```typescript
// Côté Milvus : partition_names = collection_slugs.map(toMilvusPartition)
```

**`fragment_inventory`** — ajout paramètre `collection_slugs` avec `recommendations` par collection.

**`fragment_create`** — ajout paramètre `collection_slug` :
- Si absent et quality=draft → collection personnelle automatique
- Si absent et quality≠draft → erreur COLLECTION_REQUIRED

**`fragment_harvest`** — ajout paramètre `collection_slug` (défaut: personal).

**`document_compose`** — ajout paramètre `collection_slug` pour le template. La résolution cross-collection se fait automatiquement.

## Frontend

### Sélecteur de collection

Dropdown dans la sidebar, au-dessus de la navigation. Chargé au login via `GET /v1/collections`. La collection active est stockée en state (Context React).

Toutes les requêtes API sont préfixées avec la collection active :
```typescript
const { activeCollection } = useCollection();
// GET /v1/collections/${activeCollection}/fragments
```

Badge `read-only` si la collection est en lecture seule → boutons création/modification grisés.

### Hook `useCollection`

```typescript
interface CollectionContextValue {
  activeCollection: string;           // slug
  collections: CollectionWithRole[];  // loaded at login
  setActiveCollection: (slug: string) => void;
}
```

## Services

### CollectionService

`packages/server/src/services/collection-service.ts`

```typescript
class CollectionService {
  create(params, actor): Promise<Collection>
  listForUser(userId): Promise<CollectionWithRole[]>
  getBySlug(slug): Promise<Collection | null>
  addMember(collectionId, userId, role, grantedBy): Promise<void>
  removeMember(collectionId, userId): Promise<void>
  createExternalToken(collectionId, role, name, expiresAt?): Promise<ApiToken>
  checkAccess(userId, tokenId, collectionSlug, minRole): Promise<boolean>
  ensurePersonalCollection(user): Promise<Collection>
  assignSystemCollections(userId): Promise<void>
  delete(collectionId, force): Promise<void>
}
```

### Modifications aux services existants

**FragmentService** — Toutes les méthodes reçoivent un `collection: Collection` en premier paramètre au lieu de lire `storePath`. Le `git_path` vient de `collection.git_path`.

**SearchService** — Les méthodes `search` et `indexFragment` reçoivent une liste de `partition_names` au lieu du défaut global.

**ComposerService** — `compose()` reçoit les collections accessibles et applique les règles de résolution hybride.

**HarvesterService** — `harvest()` reçoit la collection cible où stocker les candidats.

## Testing

| Test | Description |
|------|-------------|
| CollectionService unit | CRUD, addMember, checkAccess, ensurePersonal, assignSystem |
| Auth middleware | Lookup DB, rôle insuffisant → 403, token externe scoped |
| Routes collections | GET/POST collections, add/remove members |
| Routes fragments préfixées | CRUD via `/v1/collections/common/fragments` |
| Rétrocompatibilité | `/v1/fragments` → redirige vers `common` |
| Migration | Premier démarrage crée `common` avec les données existantes |
| Composition cross-collection | Template résout des fragments de plusieurs collections |
| MCP collection_list | Retourne les collections accessibles |

**Cible :** ~20-25 nouveaux tests.

## Tâches (ordre d'implémentation)

```
COL-T01 (schema + config + migration)
    ↓
COL-T02 (CollectionService)  ←→  COL-T03 (auth middleware)   ← parallèle
    ↓
COL-T04 (routes préfixées + rétrocompat)
    ↓
COL-T05 (SearchService multi-partition)  ←→  COL-T06 (ComposerService cross-collection)  ← parallèle
    ↓
COL-T07 (MCP collection-aware)  ←→  COL-T08 (frontend sélecteur)  ← parallèle
    ↓
Tests d'acceptation
```

## Anti-patterns à éviter

- Ne jamais lire `process.env.FRAGMINT_REPO_PATH` dans du nouveau code → `collection.git_path`
- Ne jamais hardcoder `'fragmint_fragments'` → `collection.milvus_partition`
- Ne jamais passer `partition_names=[]` à Milvus → toujours spécifier explicitement
- Ne jamais oublier le préfixe Nomic : `search_document:` / `search_query:`
- Le fallback SQLite doit toujours filtrer par `collection_slug`
- La collection `personal-{login}` est créée au login, pas à l'avance
- La suppression d'une collection fait `drop_partition()` + supprime le repo Git + purge SQLite — dans cet ordre, avec rollback si échec
