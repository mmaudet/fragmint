# Integration MCP (Model Context Protocol)

Fragmint expose un serveur MCP qui permet a Claude Code et Claude Desktop d'interagir directement avec la bibliotheque de fragments.

---

## Outils disponibles

| Outil               | Description                                                  |
|---------------------|--------------------------------------------------------------|
| fragment_inventory  | Diagnostiquer la couverture sur un sujet donne               |
| fragment_search     | Recherche semantique avec filtres (type, domaine, langue)    |
| fragment_get        | Obtenir un fragment complet avec son historique               |
| fragment_create     | Creer un nouveau fragment (statut draft)                     |
| fragment_update     | Mettre a jour le contenu ou les metadonnees d'un fragment    |
| fragment_lineage    | Obtenir l'arbre de derivation et les traductions             |
| document_compose    | Composer un document a partir d'un template et de fragments  |
| fragment_harvest    | Lancer le moissonnage de fragments depuis un fichier DOCX    |

---

## Configuration pour Claude Code

Ajouter dans le fichier `.claude/settings.json` a la racine du projet :

```json
{
  "mcpServers": {
    "fragmint": {
      "command": "npx",
      "args": ["tsx", "packages/mcp/src/index.ts"],
      "env": {
        "FRAGMINT_URL": "http://localhost:3210",
        "FRAGMINT_TOKEN": "votre-token-ici"
      }
    }
  }
}
```

---

## Configuration pour Claude Desktop

Ajouter dans le fichier de configuration Claude Desktop :

- **macOS** : `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows** : `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux** : `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "fragmint": {
      "command": "npx",
      "args": ["tsx", "/chemin/absolu/vers/fragmint/packages/mcp/src/index.ts"],
      "env": {
        "FRAGMINT_URL": "http://localhost:3210",
        "FRAGMINT_TOKEN": "votre-token-ici"
      }
    }
  }
}
```

> Pour Claude Desktop, utiliser le **chemin absolu** vers le fichier `index.ts`.

---

## Generation d'un token

Le serveur MCP necessite un token API valide. Voici comment en obtenir un :

### 1. Demarrer le serveur Fragmint

```bash
npx tsx packages/server/src/index.ts
```

### 2. S'authentifier (mode dev)

```bash
TOKEN=$(curl -s -X POST http://localhost:3210/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"mmaudet","password":"fragmint-dev"}' \
  | jq -r '.data.token')
```

### 3. Creer un token API dedie

```bash
curl -s -X POST http://localhost:3210/v1/tokens \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"mcp-claude","role":"contributor"}'
```

La reponse contient le token en clair (affiche une seule fois). Copier la valeur du champ `token` et la placer dans la configuration MCP.

### 4. Alternative : utiliser le JWT directement

Le JWT obtenu a l'etape 2 est egalement utilisable comme `FRAGMINT_TOKEN`. Attention : il expire apres 8 heures par defaut. Un token API n'expire pas tant qu'il n'est pas revoque.

---

## Variables d'environnement

| Variable         | Description                        | Defaut                  |
|------------------|------------------------------------|-------------------------|
| FRAGMINT_URL     | URL du serveur Fragmint            | http://localhost:3210   |
| FRAGMINT_TOKEN   | Token API ou JWT (obligatoire)     | -                       |

---

## Exemples d'utilisation

Une fois le serveur MCP configure, Claude peut utiliser les outils directement dans la conversation.

### Rechercher des fragments

> "Cherche des fragments sur la souverainete numerique en francais."

Claude utilisera `fragment_search` avec la requete semantique et retournera les fragments les plus pertinents.

### Creer un fragment

> "Cree un nouveau fragment de type argument dans le domaine commercial en francais avec le titre 'Avantages du logiciel libre' et le texte suivant : ..."

Claude utilisera `fragment_create` pour ajouter le fragment a la bibliotheque.

### Composer un document

> "Compose un devis pour le client Acme Corp en utilisant le template devis-standard."

Claude utilisera `document_compose` avec les metadonnees et les fragments selectionnes.

### Diagnostiquer la couverture

> "Quel est l'etat de la couverture de fragments sur le sujet 'cybersecurite' ?"

Claude utilisera `fragment_inventory` pour analyser les fragments disponibles et identifier les lacunes.

### Moissonner un document

> "Extrait les fragments reutilisables de ce document."

Claude utilisera `fragment_harvest` pour lancer le pipeline d'extraction.
