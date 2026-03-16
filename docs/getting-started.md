# Guide de demarrage rapide

Ce guide vous accompagne de l'installation a la composition de votre premier document.

---

## 1. Prerequis

| Outil      | Version | Obligatoire | Usage                                  |
|------------|---------|-------------|----------------------------------------|
| Node.js    | >= 20   | Oui         | Runtime serveur et build frontend      |
| pnpm       | >= 9    | Oui         | Gestionnaire de paquets (workspaces)   |
| Git        | >= 2.30 | Oui         | Versionnement des fragments            |
| Pandoc     | >= 3.0  | Non*        | Extraction de texte DOCX (moissonneur) |
| Ollama     | >= 0.3  | Non*        | Embeddings et LLM (moissonnage)        |
| Milvus     | >= 2.4  | Non         | Recherche vectorielle (fallback SQLite) |

> (*) Pandoc et Ollama sont necessaires uniquement pour le moissonneur.

### Installer pnpm

```bash
corepack enable
corepack prepare pnpm@latest --activate
```

### Installer Pandoc (macOS)

```bash
brew install pandoc
```

### Installer Ollama (optionnel)

```bash
# macOS
brew install ollama

# Demarrer le service
ollama serve

# Telecharger les modeles
ollama pull nomic-embed-text-v2-moe
ollama pull mistral-nemo:12b
```

---

## 2. Installation

```bash
git clone https://github.com/mmaudet/fragmint.git
cd fragmint
pnpm install
```

### Construire le frontend

```bash
pnpm --filter @fragmint/web build
```

---

## 3. Demarrer le serveur

```bash
npx tsx packages/server/src/index.ts
```

Le serveur demarre sur http://localhost:3210 en mode developpement.

En mode dev, un utilisateur admin est cree automatiquement :

| Login   | Mot de passe | Role  |
|---------|--------------|-------|
| mmaudet | fragmint-dev | admin |

### Variables d'environnement utiles

```bash
# Changer le port
FRAGMINT_PORT=8080

# Pointer vers un vault existant
FRAGMINT_STORE_PATH=/chemin/vers/vault

# Activer Milvus
FRAGMINT_MILVUS_ENABLED=true
FRAGMINT_MILVUS_ADDRESS=localhost:19530

# Configurer Ollama
FRAGMINT_EMBEDDING_ENDPOINT=http://localhost:11434/v1
FRAGMINT_LLM_ENDPOINT=http://localhost:11434/v1
FRAGMINT_LLM_MODEL=mistral-nemo:12b
```

---

## 4. Premiere connexion

1. Ouvrir http://localhost:3210/ui/ dans un navigateur
2. Se connecter avec `mmaudet` / `fragmint-dev`
3. L'interface affiche la bibliotheque de fragments

Alternativement, via l'API :

```bash
# Obtenir un JWT
TOKEN=$(curl -s -X POST http://localhost:3210/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"mmaudet","password":"fragmint-dev"}' \
  | jq -r '.data.token')

echo $TOKEN
```

---

## 5. Creer votre premier fragment

### Via l'interface web

1. Cliquer sur **Nouveau fragment** dans la bibliotheque
2. Remplir les champs :
   - **Type** : `argument` (ou `introduction`, `clause`, `pricing`, etc.)
   - **Domaine** : `commercial`
   - **Langue** : `fr`
   - **Titre** : "Presentation LINAGORA"
   - **Corps** : le texte du fragment
3. Enregistrer

### Via l'API

```bash
curl -X POST http://localhost:3210/v1/fragments \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "argument",
    "domain": "commercial",
    "lang": "fr",
    "title": "Presentation LINAGORA",
    "body": "LINAGORA est un editeur de logiciels libres fonde en 2000, specialise dans les solutions de collaboration souveraine."
  }'
```

### Via un fichier Markdown dans le vault

Creer un fichier `example-vault/fragments/commercial/presentation.md` :

```markdown
---
type: argument
domain: commercial
lang: fr
title: Presentation LINAGORA
quality: draft
tags:
  - entreprise
  - souverainete
---

LINAGORA est un editeur de logiciels libres fonde en 2000, specialise dans les solutions de collaboration souveraine.
```

Le serveur indexe automatiquement les fichiers au demarrage.

---

## 6. Composer votre premier document

### Preparer un template

Un template se compose de deux fichiers :

1. Un fichier `.docx` avec des balises `+++INS ...+++`
2. Un fichier `.fragmint.yaml` qui definit les slots

Voir [docs/template-syntax.md](template-syntax.md) pour la syntaxe complete.

### Uploader le template

```bash
curl -X POST http://localhost:3210/v1/templates \
  -H "Authorization: Bearer $TOKEN" \
  -F "template=@mon-template.docx" \
  -F "config=@mon-template.fragmint.yaml"
```

### Composer un document

```bash
# Lancer la composition
curl -X POST http://localhost:3210/v1/templates/<template-id>/compose \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "metadata": {
      "client": "Acme Corp",
      "date": "2026-03-15"
    },
    "fragment_ids": {
      "introduction": "frag-abc123"
    }
  }'

# Telecharger le document genere
curl -o document.docx http://localhost:3210/v1/outputs/<filename> \
  -H "Authorization: Bearer $TOKEN"
```

### Via l'interface web

1. Aller dans la vue **Compositeur**
2. Selectionner un template
3. Remplir les metadonnees et choisir les fragments
4. Cliquer sur **Composer**
5. Telecharger le document genere

---

## 7. Utiliser le moissonneur

Le moissonneur extrait automatiquement des fragments depuis des documents DOCX existants.

### Prerequis

- Pandoc installe
- Ollama en cours d'execution avec le modele `mistral-nemo:12b`

### Via l'interface web

1. Aller dans la vue **Ingestion**
2. Glisser-deposer un ou plusieurs fichiers `.docx`
3. Attendre le traitement (extraction -> segmentation LLM -> detection de doublons)
4. Passer en vue **Validation** pour examiner les candidats
5. Accepter, modifier, fusionner ou rejeter chaque candidat

### Via l'API

```bash
# Soumettre un document
curl -X POST http://localhost:3210/v1/harvest \
  -H "Authorization: Bearer $TOKEN" \
  -F "files=@document.docx"

# Consulter le statut
curl http://localhost:3210/v1/harvest/<job-id> \
  -H "Authorization: Bearer $TOKEN"

# Valider les candidats
curl -X POST http://localhost:3210/v1/harvest/<job-id>/validate \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "accepted": ["candidate-id-1", "candidate-id-2"],
    "rejected": ["candidate-id-3"]
  }'
```

---

## Etapes suivantes

- [Reference de l'API](api.md)
- [Syntaxe des templates](template-syntax.md)
- [Integration MCP](mcp.md)
- [Deploiement Docker](docker.md)
- [Architecture](architecture.md)
