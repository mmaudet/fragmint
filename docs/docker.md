# Deploiement Docker

Fragmint fournit une configuration Docker Compose avec cinq services : le serveur Fragmint, Milvus (recherche vectorielle) avec ses dependances etcd et minio, et Ollama (LLM local).

---

## Demarrage rapide

```bash
docker compose up -d
```

L'application est accessible sur http://localhost:3210/ui/.

---

## Services

| Service   | Image                     | Port  | Description                              |
|-----------|---------------------------|-------|------------------------------------------|
| fragmint  | Build local (Dockerfile)  | 3210  | Serveur API + frontend                   |
| milvus    | milvusdb/milvus:v2.4.0    | 19530 | Base de donnees vectorielle              |
| etcd      | quay.io/coreos/etcd:v3.5.18 | 2379 | Stockage metadonnees Milvus            |
| minio     | minio/minio               | 9001  | Stockage objets Milvus                   |
| ollama    | ollama/ollama:latest      | 11434 | LLM local (embeddings + moissonnage)     |

> **Note** : etcd et minio sont des dependances internes de Milvus. Ils sont demarres automatiquement avec Milvus et n'ont pas besoin d'etre configures manuellement.

---

## docker-compose.yml

Le fichier `docker-compose.yml` a la racine du projet contient la configuration complete. Milvus v2.4 necessite etcd (metadonnees) et minio (stockage objets) comme dependances. Des health checks sont configures pour garantir l'ordre de demarrage correct.

Voir le fichier [docker-compose.yml](../docker-compose.yml) pour la configuration complete.

---

## Variables d'environnement

### Serveur Fragmint

| Variable                          | Description                              | Defaut                    |
|-----------------------------------|------------------------------------------|---------------------------|
| `NODE_ENV`                        | Environnement (development/production)   | development               |
| `FRAGMINT_PORT`                   | Port d'ecoute                            | 3210                      |
| `FRAGMINT_STORE_PATH`            | Chemin vers le vault de fragments         | ./example-vault           |
| `FRAGMINT_JWT_SECRET`            | Secret pour la signature JWT              | aleatoire (dev)           |
| `FRAGMINT_JWT_TTL`               | Duree de vie des JWT                      | 8h                        |
| `FRAGMINT_LOG_LEVEL`             | Niveau de log (debug/info/warn/error)     | info                      |
| `FRAGMINT_TRUST_PROXY`           | Faire confiance au proxy inverse          | false                     |
| `FRAGMINT_CORS_ORIGIN`           | Origines CORS autorisees (virgule)        | localhost:3210,5173       |

### Recherche (Milvus + Embeddings)

| Variable                            | Description                           | Defaut                       |
|-------------------------------------|---------------------------------------|------------------------------|
| `FRAGMINT_MILVUS_ENABLED`          | Activer Milvus                         | false                        |
| `FRAGMINT_MILVUS_ADDRESS`          | Adresse Milvus                         | localhost:19530              |
| `FRAGMINT_MILVUS_COLLECTION`       | Nom de la collection Milvus            | fragmint_fragments           |
| `FRAGMINT_EMBEDDING_ENDPOINT`      | URL du service d'embeddings (Ollama)   | http://localhost:11434/v1    |
| `FRAGMINT_EMBEDDING_MODEL`         | Modele d'embeddings                    | nomic-embed-text-v2-moe     |
| `FRAGMINT_EMBEDDING_DIMENSIONS`    | Dimensions des vecteurs                | 768                          |
| `FRAGMINT_EMBEDDING_BATCH_SIZE`    | Taille des lots d'embedding            | 32                           |
| `FRAGMINT_EMBEDDING_MAX_TOKENS`    | Tokens max par chunk                   | 480                          |
| `FRAGMINT_EMBEDDING_PREFIX_DOCUMENT` | Prefixe pour les documents           | search_document:             |
| `FRAGMINT_EMBEDDING_PREFIX_QUERY`  | Prefixe pour les requetes              | search_query:                |
| `FRAGMINT_EMBEDDING_PREFIX_CLUSTER`| Prefixe pour le clustering             | clustering:                  |

### LLM (Moissonnage)

| Variable                      | Description                    | Defaut                       |
|-------------------------------|--------------------------------|------------------------------|
| `FRAGMINT_LLM_ENDPOINT`      | URL de l'API LLM (Ollama)     | http://localhost:11434/v1    |
| `FRAGMINT_LLM_MODEL`         | Modele LLM                     | mistral-nemo:12b             |
| `FRAGMINT_LLM_TEMPERATURE`   | Temperature de generation      | 0.2                          |
| `FRAGMINT_LLM_TIMEOUT`       | Timeout en millisecondes       | 60000                        |

---

## Pre-charger les modeles Ollama

Apres le demarrage, telecharger les modeles necessaires :

```bash
# Modele d'embeddings (recherche semantique)
docker compose exec ollama ollama pull nomic-embed-text-v2-moe

# Modele LLM (moissonnage)
docker compose exec ollama ollama pull mistral-nemo:12b
```

### Verifier les modeles disponibles

```bash
docker compose exec ollama ollama list
```

---

## Activer la recherche vectorielle

Milvus est active par defaut dans le docker-compose.yml (`FRAGMINT_MILVUS_ENABLED: "true"`). Pour le verifier, consultez l'endpoint `/v1/index/status` :

```bash
curl -s http://localhost:3210/v1/index/status \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

Reponse attendue :

```json
{
  "data": {
    "status": "ok",
    "mode": "milvus",
    "milvus": true,
    "embedding": true
  }
}
```

Pour un deploiement sans Docker (mode leger, SQLite fallback) :

```bash
npx tsx packages/server/src/index.ts
```

---

## Persistance des donnees

| Volume        | Contenu                         |
|---------------|---------------------------------|
| ./example-vault (bind mount) | Fragments et templates (vault Git) |
| milvus-data   | Index vectoriels Milvus         |
| etcd-data     | Metadonnees Milvus              |
| minio-data    | Stockage objets Milvus          |
| ollama-data   | Modeles Ollama telecharges      |

La base SQLite est stockee dans le vault (`/data/vault/.fragmint.db`).

### Sauvegarde

```bash
# Sauvegarder le vault (fragments + templates + DB)
cp -r example-vault/ backup-vault/

# Sauvegarder les volumes Docker
docker compose down
docker run --rm -v milvus-data:/data -v $(pwd):/backup alpine \
  tar czf /backup/milvus-backup.tar.gz -C /data .
```

---

## Deploiement air-gap

Pour un deploiement sans acces internet :

### 1. Exporter les images Docker

Sur une machine connectee :

```bash
# Construire l'image Fragmint
docker compose build

# Sauvegarder les images
docker save fragmint-fragmint:latest | gzip > fragmint.tar.gz
docker save milvusdb/milvus:v2.4.0 | gzip > milvus.tar.gz
docker save quay.io/coreos/etcd:v3.5.18 | gzip > etcd.tar.gz
docker save minio/minio:RELEASE.2023-03-20T20-16-18Z | gzip > minio.tar.gz
docker save ollama/ollama:latest | gzip > ollama.tar.gz
```

### 2. Exporter les modeles Ollama

```bash
# Copier le volume Ollama
docker run --rm -v ollama-data:/data -v $(pwd):/backup alpine \
  tar czf /backup/ollama-models.tar.gz -C /data .
```

### 3. Importer sur la machine cible

```bash
# Charger les images
docker load < fragmint.tar.gz
docker load < milvus.tar.gz
docker load < etcd.tar.gz
docker load < minio.tar.gz
docker load < ollama.tar.gz

# Restaurer les modeles Ollama
docker volume create ollama-data
docker run --rm -v ollama-data:/data -v $(pwd):/backup alpine \
  tar xzf /backup/ollama-models.tar.gz -C /data

# Demarrer
docker compose up -d
```

---

## Production

Pour un deploiement en production :

```bash
NODE_ENV=production \
JWT_SECRET=$(openssl rand -hex 32) \
FRAGMINT_MILVUS_ENABLED=true \
docker compose up -d
```

Recommandations :

- Definir `JWT_SECRET` avec une valeur aleatoire securisee
- Monter un volume persistant pour le vault au lieu du bind mount `./example-vault`
- Configurer un proxy inverse (nginx, Caddy) avec TLS
- Limiter l'acces au port 19530 (Milvus) au reseau interne
