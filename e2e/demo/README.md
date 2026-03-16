# Démonstration Fragmint — LinCloud Souverain

## Présentation

Cette démonstration illustre les capacités de **Fragmint** à travers un scénario complet de génération de documents commerciaux pour une offre cloud souveraine fictive, « LinCloud Souverain ».

Le scénario met en oeuvre :
- **10 fragments** de contenu structuré (introduction, arguments techniques, tarification, références, conclusion)
- **4 templates** dans des formats différents (Marp, reveal.js, DOCX, XLSX)
- **La composition automatique** qui assemble fragments + templates + données métier en documents finaux

## Prérequis

- **Serveur Fragmint** lancé en mode dev (`pnpm dev` depuis la racine du projet)
- **Node.js** 24.x ou supérieur
- **curl** et **python3** disponibles dans le PATH
- Utilisateur admin par défaut : `mmaudet` / `fragmint-dev`

## Exécution rapide

```bash
# Depuis la racine du projet
bash e2e/demo/run-demo.sh

# Contre un serveur distant
bash e2e/demo/run-demo.sh http://mon-serveur:3210

# Conserver les données après exécution (pas de nettoyage)
bash e2e/demo/run-demo.sh --keep
```

## Le scénario

Le script `run-demo.sh` exécute les étapes suivantes :

| Étape | Description |
|-------|-------------|
| 1. Connexion | Authentification en tant qu'administrateur |
| 2. Collection | Création d'une collection dédiée `demo-lincloud` |
| 3. Fragments | Chargement des 10 fragments depuis `fragments/*.json` |
| 4. Templates | Génération des templates DOCX/XLSX (Node.js) + fichiers statiques Marp/reveal.js |
| 5. Upload | Envoi des 4 templates avec leurs définitions YAML |
| 6. Composition | Appel à l'API `/v1/templates/:id/compose` pour chaque format |
| 7. Nettoyage | Suppression des templates et de la collection (sauf `--keep`) |

## Les fragments

Les 10 fragments décrivent une offre cloud souveraine complète :

| Fichier | Type | Description |
|---------|------|-------------|
| `01-introduction.json` | introduction | Présentation générale de LinCloud Souverain |
| `02-architecture.json` | argument | Architecture microservices Kubernetes |
| `03-security.json` | argument | Sécurité, chiffrement, conformité SecNumCloud |
| `04-interoperability.json` | argument | APIs S3/OpenStack, portabilité multi-cloud |
| `05-availability.json` | argument | Haute disponibilité, SLA 99,99%, PRA |
| `06-sovereignty.json` | argument | Souveraineté des données, immunité Cloud Act |
| `07-support.json` | argument | Support 24/7, accompagnement migration |
| `08-pricing.json` | pricing | Grille tarifaire (compute, stockage, support) |
| `09-references.json` | argument | Références clients, certifications |
| `10-conclusion.json` | conclusion | Synthèse et engagement LINAGORA |

Chaque fichier JSON contient les champs : `type`, `domain`, `lang`, `body`, `tags`, `quality`.

## Les templates

### Marp (`templates/marp/`)

Template de présentation utilisant [Marp](https://marp.app/), un outil qui convertit du Markdown en slides HTML. Le fichier `lincloud-slides.md` contient la syntaxe Marp avec les directives Fragmint (`+++INS ...+++`, `+++FOR ... IN ...+++`).

### reveal.js (`templates/reveal/`)

Template de présentation HTML utilisant [reveal.js](https://revealjs.com/). Le fichier `lincloud-reveal.html` contient les sections `<section>` avec les directives Fragmint pour l'injection de contenu.

### DOCX (`templates/docx/`)

Proposition commerciale au format Word. Le fichier `.docx` est généré programmatiquement par le script via la bibliothèque `docx` (Node.js). Il contient un document structuré avec titre, sections, et un tableau de tarification avec les directives Fragmint.

### XLSX (`templates/xlsx/`)

Devis au format Excel. Le fichier `.xlsx` est généré programmatiquement via `exceljs` (Node.js). Il contient un tableur avec en-tête, lignes de détail (via `${table:...}`) et totaux.

## Les sorties

Après exécution, le répertoire `output/` contient :

| Fichier | Format | Description |
|---------|--------|-------------|
| `lincloud-presentation-marp.html` | HTML (Marp) | Diaporama avec slides paginées |
| `lincloud-presentation-reveal.html` | HTML (reveal.js) | Présentation interactive reveal.js |
| `lincloud-proposition.docx` | DOCX | Document Word de proposition commerciale |
| `lincloud-devis.xlsx` | XLSX | Tableur Excel avec le devis détaillé |

Les 4 fichiers sont générés à partir des **mêmes fragments** et des **mêmes données métier**, démontrant la capacité de Fragmint à produire plusieurs formats à partir d'une source unique.

## Adapter la démo

### Modifier les fragments

Éditez les fichiers JSON dans `fragments/`. Respectez la structure :

```json
{
  "type": "argument",
  "domain": "mon-domaine",
  "lang": "fr",
  "body": "Le contenu du fragment...",
  "tags": ["tag1", "tag2"],
  "quality": "approved"
}
```

### Modifier les templates

- **Marp/reveal.js** : éditez directement les fichiers `.md` et `.html`
- **DOCX/XLSX** : modifiez le code Node.js dans `run-demo.sh` (sections 4a et 4b)
- **Définitions YAML** : ajustez les fichiers `.yaml` pour modifier les slots de fragments attendus

### Ajouter un format

1. Créez un nouveau template (fichier source + définition YAML)
2. Ajoutez un appel `upload_template` et `compose_and_download` dans `run-demo.sh`

## Intégration CI

Le script peut être utilisé en intégration continue pour valider le pipeline de bout en bout :

```bash
# Dans un pipeline CI/CD
bash e2e/demo/run-demo.sh http://fragmint-staging:3210

# Vérifier le code de sortie
# 0 = tous les tests passés
# 1 = au moins un test échoué
```

Le script vérifie automatiquement que le serveur est accessible avant de démarrer et retourne un code de sortie non nul en cas d'échec.

## Structure des fichiers

```
e2e/demo/
├── README.md                — Ce fichier
├── run-demo.sh              — Script principal d'exécution
├── fragments/               — 10 fragments JSON LinCloud Souverain
│   ├── 01-introduction.json
│   ├── 02-architecture.json
│   ├── 03-security.json
│   ├── 04-interoperability.json
│   ├── 05-availability.json
│   ├── 06-sovereignty.json
│   ├── 07-support.json
│   ├── 08-pricing.json
│   ├── 09-references.json
│   └── 10-conclusion.json
├── templates/               — 4 définitions de templates
│   ├── marp/
│   │   ├── lincloud-slides.md
│   │   └── lincloud-slides.yaml
│   ├── reveal/
│   │   ├── lincloud-reveal.html
│   │   └── lincloud-reveal.yaml
│   ├── docx/
│   │   └── lincloud-proposition.yaml
│   └── xlsx/
│       └── lincloud-devis.yaml
└── output/                  — Fichiers générés (créé par run-demo.sh)
```
