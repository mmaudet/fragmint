# Reference de l'API REST

L'API Fragmint est exposee sur le port 3210 (par defaut). Tous les endpoints sauf `/v1/auth/login` necessitent un JWT valide.

---

## Format des reponses

Toutes les reponses suivent une enveloppe uniforme :

```json
{
  "data": { ... },
  "meta": { "count": 42 },
  "error": null
}
```

| Champ   | Type          | Description                                  |
|---------|---------------|----------------------------------------------|
| `data`  | object/array  | Donnees de la reponse (null en cas d'erreur)  |
| `meta`  | object/null   | Metadonnees (count, pagination, etc.)         |
| `error` | string/null   | Message d'erreur (null en cas de succes)      |

### Codes d'erreur HTTP

| Code | Signification                    |
|------|----------------------------------|
| 200  | Succes                           |
| 201  | Creation reussie                 |
| 202  | Accepte (traitement asynchrone)  |
| 400  | Requete invalide                 |
| 401  | Non authentifie                  |
| 403  | Acces interdit (role insuffisant)|
| 404  | Ressource introuvable            |
| 429  | Trop de requetes (rate limit)    |
| 500  | Erreur serveur                   |

---

## Authentification

### POST /v1/auth/login

Authentifie un utilisateur et retourne un JWT.

**Rate limit** : 5 requetes par minute.

**Corps de la requete** :

```json
{
  "username": "mmaudet",
  "password": "fragmint-dev"
}
```

**Reponse** :

```json
{
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "user": {
      "id": "usr-abc123",
      "login": "mmaudet",
      "display_name": "Michel-Marie Maudet",
      "role": "admin"
    }
  },
  "meta": null,
  "error": null
}
```

### Utilisation du token

Inclure le JWT dans l'en-tete `Authorization` :

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

Les tokens API (generes via `/v1/tokens`) sont egalement acceptes au meme format Bearer.

### Roles

| Role         | Droits                                              |
|--------------|-----------------------------------------------------|
| reader       | Lecture des fragments, templates, recherche          |
| contributor  | reader + creation et modification de fragments       |
| expert       | contributor + approbation, templates, moissonnage    |
| admin        | expert + gestion utilisateurs, tokens, audit, index  |

---

## Fragments

### GET /v1/fragments

Liste les fragments avec filtres optionnels.

**Role minimum** : reader

**Parametres query** :

| Parametre | Type   | Description                          |
|-----------|--------|--------------------------------------|
| type      | string | Filtrer par type (argument, clause...) |
| domain    | string | Filtrer par domaine                  |
| lang      | string | Filtrer par langue (fr, en)          |
| quality   | string | Filtrer par qualite                  |
| limit     | number | Nombre maximum de resultats          |

**Exemple** :

```bash
curl "http://localhost:3210/v1/fragments?domain=commercial&lang=fr&limit=10" \
  -H "Authorization: Bearer $TOKEN"
```

### GET /v1/fragments/:id

Retourne un fragment complet par son identifiant.

**Role minimum** : reader

### POST /v1/fragments

Cree un nouveau fragment.

**Role minimum** : contributor

**Corps** :

```json
{
  "type": "argument",
  "domain": "commercial",
  "lang": "fr",
  "title": "Presentation",
  "body": "Texte du fragment...",
  "tags": ["souverainete", "open-source"],
  "parent_id": null,
  "translation_of": null
}
```

### PUT /v1/fragments/:id

Met a jour un fragment existant.

**Role minimum** : contributor

**Corps** (champs optionnels) :

```json
{
  "title": "Nouveau titre",
  "body": "Nouveau contenu",
  "tags": ["tag1", "tag2"],
  "quality": "reviewed"
}
```

### POST /v1/fragments/search

Recherche semantique dans les fragments.

**Role minimum** : reader

**Corps** :

```json
{
  "query": "solutions de collaboration souveraine",
  "filters": {
    "domain": "commercial",
    "lang": "fr",
    "quality": "approved"
  },
  "limit": 10
}
```

**Reponse** : liste de fragments avec un score de pertinence.

### POST /v1/fragments/inventory

Inventaire thematique des fragments disponibles.

**Role minimum** : reader

**Corps** :

```json
{
  "topic": "commercial",
  "lang": "fr"
}
```

### POST /v1/fragments/:id/review

Passe un fragment en statut `reviewed`.

**Role minimum** : contributor

### POST /v1/fragments/:id/approve

Passe un fragment en statut `approved`.

**Role minimum** : expert

### POST /v1/fragments/:id/deprecate

Passe un fragment en statut `deprecated`.

**Role minimum** : admin

### GET /v1/fragments/:id/lineage

Retourne l'arbre de derivation d'un fragment (parent, enfants, traductions).

**Role minimum** : reader

### GET /v1/fragments/:id/history

Retourne l'historique Git d'un fragment (liste des commits).

**Role minimum** : reader

### GET /v1/fragments/:id/diff/:c1/:c2

Retourne le diff entre deux commits pour un fragment donne.

**Role minimum** : reader

| Parametre | Description       |
|-----------|-------------------|
| c1        | Hash du commit 1  |
| c2        | Hash du commit 2  |

### GET /v1/fragments/:id/version/:commit

Retourne le contenu d'un fragment a un commit donne.

**Role minimum** : reader

### POST /v1/fragments/:id/restore/:commit

Restaure un fragment a l'etat d'un commit precedent.

**Role minimum** : admin

---

## Templates

### GET /v1/templates

Liste les templates disponibles.

**Role minimum** : reader

**Parametres query** :

| Parametre     | Type   | Description                    |
|---------------|--------|--------------------------------|
| output_format | string | Filtrer par format (docx)      |
| limit         | number | Nombre maximum de resultats    |
| offset        | number | Decalage pour la pagination    |

### GET /v1/templates/:id

Retourne un template par son identifiant.

**Role minimum** : reader

### POST /v1/templates

Cree un nouveau template (upload multipart).

**Role minimum** : expert

**Fichiers attendus** :

- Un fichier `.docx` (le template)
- Un fichier `.yaml` ou `.yml` (la definition)

```bash
curl -X POST http://localhost:3210/v1/templates \
  -H "Authorization: Bearer $TOKEN" \
  -F "template=@devis-standard.docx" \
  -F "config=@devis-standard.fragmint.yaml"
```

### PUT /v1/templates/:id

Met a jour un template existant (upload multipart).

**Role minimum** : expert

Au moins un fichier (`.docx` ou `.yaml`) doit etre fourni.

### DELETE /v1/templates/:id

Supprime un template.

**Role minimum** : admin

### POST /v1/templates/:id/compose

Compose un document a partir d'un template.

**Role minimum** : reader

**Corps** :

```json
{
  "metadata": {
    "client": "Acme Corp",
    "date": "2026-03-15",
    "total_ht": 10700
  },
  "fragment_ids": {
    "introduction": "frag-abc123",
    "produits": ["frag-def456", "frag-ghi789"]
  }
}
```

**Reponse** :

```json
{
  "data": {
    "filename": "devis-standard-1710500000.docx",
    "download_url": "/v1/outputs/devis-standard-1710500000.docx"
  },
  "meta": null,
  "error": null
}
```

### GET /v1/outputs/:filename

Telecharge un fichier genere par la composition.

**Role minimum** : reader

Retourne le fichier DOCX avec les en-tetes `Content-Type` et `Content-Disposition` appropries.

---

## Moissonnage (Harvest)

### POST /v1/harvest

Soumet un ou plusieurs fichiers DOCX pour extraction de fragments.

**Role minimum** : expert

**Upload multipart** :

- Un ou plusieurs fichiers `.docx`
- Un champ `options` (JSON optionnel) : `{"min_confidence": 0.5}`

```bash
curl -X POST http://localhost:3210/v1/harvest \
  -H "Authorization: Bearer $TOKEN" \
  -F "files=@document1.docx" \
  -F "files=@document2.docx" \
  -F 'options={"min_confidence": 0.7}'
```

**Reponse** (HTTP 202) :

```json
{
  "data": {
    "job_id": "harvest-abc123",
    "status": "processing",
    "files": ["document1.docx", "document2.docx"]
  },
  "meta": null,
  "error": null
}
```

### GET /v1/harvest/:jobId

Retourne le statut et les candidats d'un job de moissonnage.

**Role minimum** : reader

**Reponse** : le job avec ses candidats, chacun ayant un statut (`pending`, `accepted`, `rejected`, etc.) et un score de confiance.

### POST /v1/harvest/:jobId/validate

Valide les candidats d'un job de moissonnage.

**Role minimum** : expert

**Corps** :

```json
{
  "accepted": ["candidate-id-1"],
  "modified": [
    {
      "id": "candidate-id-2",
      "title": "Titre corrige",
      "body": "Contenu modifie"
    }
  ],
  "merged": [
    {
      "ids": ["candidate-id-3", "candidate-id-4"],
      "title": "Titre fusionne",
      "body": "Contenu fusionne"
    }
  ],
  "rejected": ["candidate-id-5"]
}
```

---

## Administration

### GET /v1/users

Liste les utilisateurs.

**Role minimum** : admin

### POST /v1/users

Cree un nouvel utilisateur.

**Role minimum** : admin

**Corps** :

```json
{
  "login": "jdupont",
  "password": "motdepasse-securise",
  "display_name": "Jean Dupont",
  "role": "contributor"
}
```

### GET /v1/tokens

Liste les tokens API.

**Role minimum** : admin

### POST /v1/tokens

Cree un nouveau token API.

**Role minimum** : admin

**Corps** :

```json
{
  "name": "mcp-claude",
  "role": "reader"
}
```

**Reponse** : contient le token en clair (affiche une seule fois).

### DELETE /v1/tokens/:id

Revoque un token API.

**Role minimum** : admin

### GET /v1/audit

Consulte le journal d'audit.

**Role minimum** : admin

**Parametres query** :

| Parametre | Type   | Description          |
|-----------|--------|----------------------|
| from      | string | Date de debut (ISO)  |
| to        | string | Date de fin (ISO)    |

### POST /v1/index/trigger

Declenche une reindexation complete des fragments.

**Role minimum** : admin

### GET /v1/index/status

Retourne le statut de l'index.

**Role minimum** : admin
