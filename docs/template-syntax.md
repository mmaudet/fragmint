# Guide de syntaxe des templates Fragmint

## 1. Vue d'ensemble

Un template Fragmint est composé de deux fichiers :

- **Un fichier `.docx`** : le modele de document, contenant la mise en forme et des balises d'insertion.
- **Un fichier `.fragmint.yaml`** : la definition du template (quels fragments utiliser, quelles metadonnees attendre, etc.).

### Comment fonctionne la composition

```
Fragments (base de connaissances)
        |
        v
Resolution des fragments --> Donnees JSON --> Injection dans le .docx
        ^                                          |
        |                                          v
  .fragmint.yaml                          Document final (.docx)
  (definition des slots)
```

1. Le fichier `.fragmint.yaml` declare les **slots** de fragments et les **metadonnees** attendues.
2. Fragmint resout chaque slot en selectionnant le fragment le plus pertinent (domaine, langue, qualite).
3. Les fragments resolus et les metadonnees sont assembles en un objet JSON.
4. Cet objet JSON est injecte dans le fichier `.docx` via le moteur `docx-templates`.
5. Le document final est genere.

---

## 2. Syntaxe du template DOCX

Fragmint utilise le moteur **docx-templates** (MIT). Les balises utilisent le delimiteur `+++`.

### 2.1 Insertion simple

Pour inserer une valeur dans le document :

```
+++INS metadata.client+++
```

Exemples concrets :

| Balise | Resultat |
|--------|----------|
| `+++INS metadata.client+++` | Nom du client |
| `+++INS metadata.date+++` | Date du document |
| `+++INS fragments.introduction.body+++` | Corps du fragment "introduction" |
| `+++INS fragments.introduction.quality+++` | Niveau de qualite du fragment |

### 2.2 Boucles dans les tableaux

Pour repeter des lignes de tableau a partir d'un tableau de fragments, on utilise `FOR` / `END-FOR`.

**Regle importante** : les instructions `FOR` et `END-FOR` doivent etre dans des **lignes de tableau separees** (pas dans la ligne de donnees). Ces lignes sont supprimees lors du rendu.

**Regle importante** : les variables de boucle utilisent le prefixe `$` (par exemple `$ligne.produit`, et non `ligne.produit`).

Voici un exemple complet de tableau de devis :

| Contenu de la cellule | Commentaire |
|---|---|
| Ligne d'en-tete normale | En-tetes du tableau |
| Ligne FOR (sera supprimee) | Demarre la boucle |
| Ligne de donnees avec `$variable` | Repetee pour chaque element |
| Ligne END-FOR (sera supprimee) | Termine la boucle |

Dans le `.docx`, le tableau ressemble a ceci :

```
| Produit | Description | Qte | P.U. | Total |
| +++FOR ligne IN fragments.produits+++ |||||
| +++INS $ligne.produit+++ | +++INS $ligne.body+++ | +++INS $ligne.qte+++ | +++INS $ligne.pu+++ EUR | +++INS $ligne.total+++ EUR |
| +++END-FOR ligne+++ |||||
| | | | TOTAL HT | +++INS metadata.total_ht+++ EUR |
```

Resultat pour un tableau de 3 produits :

```
| Produit       | Description       | Qte | P.U.    | Total     |
| Serveur X1    | Serveur rack 2U   | 2   | 3500 EUR | 7000 EUR  |
| Stockage S3   | Baie NAS 12 To    | 1   | 2200 EUR | 2200 EUR  |
| Support 1 an  | Maintenance 24/7  | 1   | 1500 EUR | 1500 EUR  |
| | | | TOTAL HT | 10700 EUR |
```

### 2.3 Conditions

Pour afficher ou masquer une section selon une condition :

```
+++IF metadata.show_cgv+++
Conditions generales de vente...
+++END-IF metadata.show_cgv+++
```

La section entre `IF` et `END-IF` n'apparait que si la valeur est evaluee a `true` (valeur non nulle, non vide, non `false`).

---

## 3. Structure des donnees

Le template recoit un objet JSON avec deux cles principales : `fragments` et `metadata`.

### 3.1 Structure generale

```json
{
  "fragments": {
    "introduction": {
      "body": "LINAGORA est un editeur de logiciels libres...",
      "id": "frag-abc123",
      "quality": "approved"
    },
    "produits": [
      {
        "body": "Serveur haute performance pour charges de travail critiques",
        "id": "frag-def456",
        "quality": "approved",
        "produit": "Serveur X1",
        "qte": "2",
        "pu": "3500",
        "total": "7000"
      },
      {
        "body": "Baie de stockage NAS entreprise",
        "id": "frag-ghi789",
        "quality": "approved",
        "produit": "Stockage S3",
        "qte": "1",
        "pu": "2200",
        "total": "2200"
      }
    ]
  },
  "metadata": {
    "client": "Acme Corp",
    "date": "2026-03-14",
    "total_ht": "10700",
    "show_cgv": true
  }
}
```

### 3.2 Fragments simples vs. tableaux

- Un **fragment simple** (ex: `introduction`) est un objet avec au minimum un champ `body`.
- Un **tableau de fragments** (ex: `produits`) est un tableau d'objets, chacun avec un `body` et des champs supplementaires.

### 3.3 Tags structures

Les fragments peuvent porter des **tags structures** sous la forme `cle:valeur`. Par exemple, un fragment avec les tags `produit:Serveur X1`, `pu:3500`, `qte:2` verra ces valeurs fusionnees directement dans l'objet du fragment :

```json
{
  "body": "Description du serveur...",
  "produit": "Serveur X1",
  "pu": "3500",
  "qte": "2"
}
```

Cela permet d'acceder a ces valeurs dans le template via `$ligne.produit`, `$ligne.pu`, etc.

---

## 4. Reference du fichier .fragmint.yaml

### 4.1 Exemple complet annote

```yaml
# Identifiant unique du template
id: devis-standard

# Nom lisible
name: "Devis commercial standard"

# Description du template
description: "Template de devis avec tableau de produits et conditions generales"

# Format de sortie
output_format: docx

# Chemin vers le fichier .docx du template
carbone_template: devis-standard.docx

# Version du template
version: "1.0.0"

# --- Definition des slots de fragments ---
fragments:
  # Fragment simple : un seul fragment attendu
  - key: introduction
    type: single            # "single" = un seul fragment
    domain: commercial      # Domaine metier pour la recherche
    lang: fr                # Langue souhaitee
    quality_min: draft      # Qualite minimale acceptee (draft | reviewed | approved)
    required: true          # Le slot doit etre rempli pour generer le document
    fallback: ""            # Texte par defaut si aucun fragment trouve (si required: false)

  # Tableau de fragments : plusieurs fragments attendus
  - key: produits
    type: array             # "array" = tableau de fragments
    domain: catalogue
    lang: fr
    quality_min: approved
    required: true
    count: "1-50"           # Nombre de fragments attendus (min-max)

  # Fragment optionnel avec fallback
  - key: cgv
    type: single
    domain: juridique
    lang: fr
    quality_min: approved
    required: false
    fallback: "Conditions generales disponibles sur demande."

# --- Schema des metadonnees (context_schema) ---
context_schema:
  client:
    type: string
    required: true
    description: "Nom du client"

  date:
    type: string
    required: true
    default: "today"
    description: "Date du devis (format YYYY-MM-DD)"

  total_ht:
    type: number
    required: true
    description: "Total hors taxes"

  show_cgv:
    type: boolean
    required: false
    default: true
    description: "Afficher les conditions generales de vente"

  devise:
    type: string
    required: false
    default: "EUR"
    enum: ["EUR", "USD", "GBP"]
    description: "Devise utilisee"

# --- Donnees structurees attendues dans les fragments ---
structured_data:
  produit:
    description: "Nom du produit"
    type: string
  qte:
    description: "Quantite"
    type: number
  pu:
    description: "Prix unitaire HT"
    type: number
  total:
    description: "Total ligne (qte x pu)"
    type: number
```

### 4.2 Reference des champs

| Champ | Type | Description |
|-------|------|-------------|
| `id` | string | Identifiant unique du template |
| `name` | string | Nom affichable |
| `description` | string | Description du template |
| `output_format` | string | Format de sortie (`docx`) |
| `carbone_template` | string | Chemin vers le fichier `.docx` |
| `version` | string | Version semantique |
| `fragments[]` | array | Liste des slots de fragments |
| `fragments[].key` | string | Cle d'acces dans le template (`fragments.<key>`) |
| `fragments[].type` | string | `single` ou `array` |
| `fragments[].domain` | string | Domaine metier pour le filtrage |
| `fragments[].lang` | string | Code langue (ex: `fr`, `en`) |
| `fragments[].quality_min` | string | Qualite minimale : `draft`, `reviewed`, `approved` |
| `fragments[].required` | boolean | Slot obligatoire ou non |
| `fragments[].fallback` | string | Valeur par defaut si non requis et non trouve |
| `fragments[].count` | string | Plage de cardinalite pour les tableaux (ex: `1-50`) |
| `context_schema` | object | Definition des metadonnees attendues |
| `context_schema.<field>.type` | string | Type : `string`, `number`, `boolean` |
| `context_schema.<field>.required` | boolean | Champ obligatoire |
| `context_schema.<field>.default` | any | Valeur par defaut |
| `context_schema.<field>.enum` | array | Liste de valeurs autorisees |
| `structured_data` | object | Definition des tags structures attendus dans les fragments |

---

## 5. Pieges courants

### FOR/END-FOR dans leurs propres lignes

**Incorrect** -- FOR dans la meme ligne que les donnees :

```
| +++FOR ligne IN fragments.produits+++ +++INS $ligne.produit+++ | +++INS $ligne.pu+++ |
```

**Correct** -- FOR et END-FOR dans des lignes separees :

```
| +++FOR ligne IN fragments.produits+++ |||
| +++INS $ligne.produit+++ | +++INS $ligne.pu+++ | ... |
| +++END-FOR ligne+++ |||
```

### Prefixe `$` obligatoire pour les variables de boucle

**Incorrect** :

```
+++INS ligne.produit+++
```

**Correct** :

```
+++INS $ligne.produit+++
```

Le prefixe `$` est necessaire uniquement pour les variables declarees dans un `FOR`. Les donnees de premier niveau (`metadata.client`, `fragments.introduction.body`) s'utilisent sans `$`.

### Acces aux donnees de premier niveau

Fragmint utilise `noSandbox: true` dans docx-templates. Cela signifie que les donnees de premier niveau sont accessibles directement :

```
+++INS metadata.client+++       (correct)
+++INS fragments.intro.body+++  (correct)
```

### Balises et mise en forme Word

Les balises `+++...+++` doivent former un **seul bloc de texte (run XML)** dans le fichier `.docx`. Si vous tapez une balise puis selectionnez une partie pour la mettre en gras, Word peut la decouper en plusieurs runs XML, ce qui casse la detection.

**A eviter** :
1. Taper `+++INS metadata.client+++`
2. Selectionner `metadata` et le mettre en gras

Word produira en interne quelque chose comme :
```xml
<w:r><w:t>+++INS </w:t></w:r>
<w:r><w:rPr><w:b/></w:rPr><w:t>metadata</w:t></w:r>
<w:r><w:t>.client+++</w:t></w:r>
```

Le moteur ne reconnaitra pas cette balise. Pour mettre en forme le resultat, appliquez la mise en forme a **l'ensemble** de la balise (selectionnez tout le texte `+++INS metadata.client+++` avant de changer le style).

### Caracteres speciaux dans les valeurs

Les valeurs injectees sont echappees automatiquement par docx-templates. Il n'est pas necessaire de gerer les caracteres speciaux XML (`&`, `<`, `>`) dans les contenus des fragments.

---

## 6. Feuille de route des formats

| Format | Statut | Moteur |
|--------|--------|--------|
| DOCX | Supporte | docx-templates |
| XLSX | Prevu | xlsx-template |
| PPTX / Slides | Prevu | reveal.js ou Slidev |

Le format DOCX est le seul actuellement supporte. Les formats tableur et presentation sont sur la feuille de route.
