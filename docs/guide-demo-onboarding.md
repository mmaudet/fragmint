# Guide de la Demo LinCloud — Comprendre et Creer ses Templates

## 1. Introduction

Ce guide utilise la demo **LinCloud Souverain** comme cas d'ecole pour comprendre le fonctionnement de Fragmint de bout en bout. A la fin de cette lecture, vous saurez :

- Ce qu'est un **fragment** et comment le structurer en JSON
- Comment fonctionnent les **donnees structurees** (lignes de devis, totaux)
- Comment creer un template dans **4 formats** : DOCX, XLSX, Marp (slides Markdown), reveal.js (slides HTML)
- Comment ecrire le fichier **YAML de definition** qui lie le template aux fragments
- Comment appeler l'**API de composition** pour generer le document final

Chaque section est autonome : vous pouvez sauter directement a la partie qui vous interesse.

> **Prerequis** : avoir lu le [Guide d'utilisation](guide-utilisation.md) pour comprendre les concepts de collections, qualite et workflow. La [Reference de syntaxe](template-syntax.md) complete ce guide avec les details techniques.

---

## 2. Le scenario LinCloud Souverain

### La solution fictive

LinCloud Souverain est une **plateforme cloud souveraine** fictive developpee par LINAGORA. Elle heberge des donnees sur le territoire francais, conforme au RGPD et au referentiel SecNumCloud de l'ANSSI. Le scenario cible les administrations et les OIV (Operateurs d'Importance Vitale).

### Pourquoi ce scenario est representatif

Le cas LinCloud est representatif parce qu'il couvre les trois types de documents qu'une equipe commerciale produit au quotidien :

| Document | Format | Objectif |
|----------|--------|----------|
| Proposition commerciale | DOCX | Document Word structure avec texte, arguments et tableau de prix |
| Devis | XLSX | Tableur avec lignes de detail, quantites, prix et totaux |
| Presentation | Marp ou reveal.js | Diaporama pour une soutenance ou une reunion client |

Les **4 documents** sont generes a partir des **memes fragments** et des **memes donnees metier**. C'est la force de Fragmint : ecrire le contenu une seule fois, le decliner dans tous les formats.

### Executer la demo

```bash
# Lancer le serveur Fragmint
pnpm dev

# Executer la demo (dans un autre terminal)
bash e2e/demo/run-demo.sh

# Conserver les donnees apres execution
bash e2e/demo/run-demo.sh --keep
```

Les fichiers generes sont dans `e2e/demo/output/`.

---

## 3. Anatomie des fragments

### Qu'est-ce qu'un fragment

Un fragment est un **bloc de contenu reutilisable** avec des metadonnees. Il represente une unite de texte autonome : une introduction, un argument technique, une grille tarifaire, une conclusion. Chaque fragment est classe par type, domaine et langue, et soumis a un workflow de qualite.

### Les 5 types utilises dans la demo

La demo LinCloud utilise 10 fragments repartis en 5 types :

| Type | Nombre | Role |
|------|--------|------|
| `introduction` | 1 | Presentation generale de la solution |
| `argument` | 6 | Arguments techniques (architecture, securite, interop, dispo, souverainete, support) |
| `pricing` | 1 | Grille tarifaire avec les prix unitaires |
| `argument` (references) | 1 | Certifications et references clients |
| `conclusion` | 1 | Synthese et engagement |

### Structure d'un fragment JSON

Chaque fragment est un fichier JSON avec les champs suivants :

```json
{
  "type": "...",      // Type du fragment (introduction, argument, pricing, conclusion)
  "domain": "...",    // Domaine metier pour le filtrage lors de la resolution
  "lang": "...",      // Code langue (fr, en)
  "body": "...",      // Contenu textuel (Markdown accepte)
  "tags": [...],      // Tags pour la categorisation et la recherche
  "quality": "..."    // Niveau de qualite (draft, reviewed, approved)
}
```

### Exemple commente : `01-introduction.json`

```json
{
  // Type "introduction" : sera resolu dans le slot "introduction" du template
  "type": "introduction",

  // Domaine "lincloud" : filtre les fragments par offre/produit
  "domain": "lincloud",

  // Langue francaise
  "lang": "fr",

  // Corps du fragment — c'est ce texte qui sera injecte dans le document
  "body": "LinCloud Souverain est une plateforme cloud souveraine developpee
           par LINAGORA. Elle garantit la maitrise complete des donnees
           hebergees sur le territoire francais, conforme au RGPD et au
           referentiel SecNumCloud de l'ANSSI. Concue pour les administrations
           et les OIV, LinCloud offre une alternative credible aux hyperscalers
           americains.",

  // Tags pour la recherche semantique et le classement
  "tags": ["lincloud", "introduction", "souverainete"],

  // Qualite "approved" : le fragment est valide et peut etre utilise en composition
  "quality": "approved"
}
```

### Stockage des fragments

Les fragments sont stockes dans trois couches complementaires :

- **Git** : les fichiers JSON sur disque (vault), versionnement natif
- **SQLite** : base de donnees locale pour les requetes structurees (type, domaine, langue, qualite)
- **Milvus** (optionnel) : base vectorielle pour la recherche semantique (embeddings `nomic-embed-text-v2-moe`)

### Cycle de vie

Un fragment suit trois etapes de qualite :

```
draft  ──>  reviewed  ──>  approved
  │              │              │
  │  redacteur   │   experte    │  pret pour
  │  cree/edite  │   valide     │  la composition
```

Seuls les fragments `approved` sont utilises par defaut lors de la composition. Le champ `quality_min` dans le YAML permet d'abaisser ce seuil si necessaire.

---

## 4. Les donnees structurees (structured_data)

### Difference entre fragments et donnees structurees

Les **fragments** contiennent du texte reutilisable stocke dans la bibliotheque Fragmint. Les **donnees structurees** sont des donnees metier passees au moment de la composition, specifiques a chaque document genere.

Exemple concret dans la demo :
- Les **fragments** fournissent le texte de l'introduction, des arguments, de la conclusion
- Les **donnees structurees** fournissent les lignes du devis (services, quantites, prix)

### Le concept de `lignes`

Dans la requete de composition, le champ `structured_data.lignes` contient un tableau d'objets representant les lignes du devis. L'utilisateur fournit uniquement `quantite` et `prix_unitaire` pour chaque ligne :

```json
{
  "structured_data": {
    "lignes": [
      {
        "service": "Compute vCPU",
        "description": "100 vCPU x 730h/mois",
        "quantite": 100,
        "prix_unitaire": 18.25
      },
      {
        "service": "Stockage objet S3",
        "description": "5 000 Go stockage objet",
        "quantite": 5000,
        "prix_unitaire": 0.008
      }
    ]
  }
}
```

Chaque ligne a 4 champs fournis par l'utilisateur : `service`, `description`, `quantite`, `prix_unitaire`. Le champ `total` est calcule automatiquement par le moteur de composition.

> **Calcul automatique des totaux**
> Fragmint calcule automatiquement a la composition :
> - `total` par ligne = `quantite x prix_unitaire`
> - `metadata.total_ht` = somme de tous les `total`
> - `metadata.tva` = `total_ht x 0.2`
> - `metadata.total_ttc` = `total_ht x 1.2`
>
> L'utilisateur n'a qu'a fournir `quantite` et `prix_unitaire` pour chaque ligne.

### Les totaux

Les totaux (`total_ht`, `tva`, `total_ttc`) sont **calcules automatiquement** par le moteur de composition et injectes dans `metadata`. Il n'est plus necessaire de les passer dans le `context`.

Le `context` ne contient que les metadonnees du document :

```json
{
  "context": {
    "client": "Ministere des Armees",
    "date": "2026-03-16"
  }
}
```

Dans les templates, les totaux auto-calcules sont accessibles via `metadata.total_ht`, `metadata.tva`, `metadata.total_ttc`. Le mot `metadata` dans le template correspond au champ `context` de la requete, enrichi par les valeurs calculees par le moteur.

---

## 5. Creer un template DOCX (docx-templates)

### Le principe

Un template DOCX est un fichier `.docx` classique (ouvrable dans Word ou LibreOffice Writer) contenant des **balises Fragmint** qui seront remplacees par du contenu lors de la composition. Le moteur utilise est **docx-templates**.

Les balises utilisent le delimiteur `+++` :

```
+++INS champ+++         — insertion simple
+++FOR var IN tableau+++  — debut de boucle
+++END-FOR var+++        — fin de boucle
```

### Insertion simple

Pour inserer une valeur dans le document :

```
+++INS metadata.client+++
```

Exemples dans la demo :

| Balise | Valeur injectee |
|--------|-----------------|
| `+++INS metadata.client+++` | "Ministere des Armees" |
| `+++INS metadata.date+++` | "2026-03-16" |
| `+++INS fragments.introduction.body+++` | Texte du fragment introduction |
| `+++INS fragments.references.body+++` | Texte du fragment references |
| `+++INS fragments.conclusion.body+++` | Texte du fragment conclusion |

### Boucle dans un paragraphe

Pour repeter un bloc de paragraphes (ex. : un argument par section), les balises `FOR` et `END-FOR` sont placees dans des paragraphes dedies :

```
+++FOR arg IN fragments.arguments+++
Titre : +++INS $arg.title+++
Contenu : +++INS $arg.body+++
+++END-FOR arg+++
```

Points importants :
- La variable de boucle (`$arg`) utilise le prefixe `$`
- `FOR` et `END-FOR` sont dans des **paragraphes separes** (pas sur la meme ligne que les donnees)
- Le paragraphe contenant `FOR` est supprime du document final

### Boucle dans un tableau (pattern critique)

C'est le pattern le plus delicat en DOCX. Pour repeter des lignes dans un tableau (ex. : lignes de devis), il faut 4 types de lignes :

```
Ligne 1 : En-tete du tableau (Service | Description | Qte | P.U. | Total)
Ligne 2 : +++FOR l IN lignes+++              <-- ligne FOR (sera supprimee)
Ligne 3 : +++INS $l.service+++ | +++INS $l.description+++ | ...  <-- ligne de donnees (repetee)
Ligne 4 : +++END-FOR l+++                    <-- ligne END-FOR (sera supprimee)
Ligne 5 : Total HT | +++INS metadata.total_ht+++
```

**Les lignes FOR et END-FOR doivent etre des lignes de tableau a part entiere.** Dans la demo, elles sont rendues invisibles avec :
- Taille de police : 2 (minuscule)
- Couleur du texte : blanc (`FFFFFF`)
- Bordures : aucune (`BorderStyle.NONE`)

Cela garantit que ces lignes n'apparaissent pas visuellement dans le template avant composition, tout en etant reconnues par le moteur docx-templates.

### Totaux apres la boucle

Les lignes de total sont placees apres la boucle `END-FOR`, comme des lignes de tableau normales. Les valeurs `metadata.total_ht`, `metadata.tva` et `metadata.total_ttc` sont auto-calculees par le moteur :

```
| Total HT  | +++INS metadata.total_ht+++ EUR  |
| TVA (20%) | +++INS metadata.tva+++ EUR       |
| Total TTC | +++INS metadata.total_ttc+++ EUR |
```

### Creation programmatique (Node.js)

La demo genere le fichier `.docx` avec la bibliotheque `docx` de Node.js. Voici le principe simplifie :

```javascript
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell } = require('docx');

// Ligne FOR invisible
const forRow = new TableRow({ children: [
  new TableCell({
    children: [new Paragraph({
      children: [new TextRun({
        text: '+++FOR l IN lignes+++',
        size: 2,        // Taille minuscule
        color: 'FFFFFF' // Texte blanc (invisible)
      })]
    })],
    borders: noBorders,  // Pas de bordures
    columnSpan: 5        // Occupe toute la largeur
  })
]});

// Ligne de donnees (repetee par le moteur)
// Note : $l.total est auto-calcule par le moteur (quantite x prix_unitaire)
const dataRow = new TableRow({ children: [
  dataCell('+++INS $l.service+++'),
  dataCell('+++INS $l.description+++'),
  dataCell('+++INS $l.quantite+++'),
  dataCell('+++INS $l.prix_unitaire+++'),
  dataCell('+++INS $l.total+++'),
]});
```

Le code complet se trouve dans `e2e/demo/run-demo.sh`, section 4a.

### Creation manuelle (LibreOffice Writer)

Pour creer un template DOCX a la main :

1. Ouvrir LibreOffice Writer
2. Taper les balises `+++INS metadata.client+++` la ou vous voulez inserer des valeurs
3. Pour les tableaux avec boucle : inserer une ligne supplementaire avant les donnees avec `+++FOR l IN lignes+++` et une apres avec `+++END-FOR l+++`
4. Sauvegarder au format `.docx`

### Piege : les runs XML

Les balises `+++...+++` doivent former un **seul bloc de texte** (run XML) dans le fichier `.docx`. Si vous tapez une balise puis selectionnez une partie pour la mettre en gras, Word ou LibreOffice peut la decouper en plusieurs runs XML, rendant la balise irreconnaissable.

**A eviter** : taper `+++INS metadata.client+++` puis mettre `metadata` en gras.

**Bonne pratique** : appliquer la mise en forme a l'ensemble de la balise d'un coup, ou ne pas la formater du tout.

---

## 6. Creer un template XLSX (ExcelJS)

### Le principe

Un template XLSX est un fichier `.xlsx` contenant des **placeholders** dans les cellules. La syntaxe est differente du DOCX : elle utilise `${...}` pour les insertions et `${table:...}` pour les boucles.

```
${field}              — insertion simple dans une cellule
${table:array.field}  — boucle : la ligne est dupliquee pour chaque element du tableau
```

### Insertion simple

Dans une cellule du tableur :

```
${metadata.client}
```

Exemples dans la demo :

| Cellule | Contenu | Resultat |
|---------|---------|----------|
| B3 | `${metadata.client}` | "Ministere des Armees" |
| B4 | `${metadata.date}` | "2026-03-16" |
| B5 | `${metadata.reference}` | "LC-2026-MINARM-001" |

### Boucle tableau

Pour repeter une ligne pour chaque element d'un tableau, on utilise le prefixe `table:` :

```
| A8                        | B8                            | C8                         | D8                              | E8                       |
|---------------------------|-------------------------------|----------------------------|---------------------------------|--------------------------|
| ${table:lignes.service}   | ${table:lignes.description}   | ${table:lignes.quantite}   | ${table:lignes.prix_unitaire}   | ${table:lignes.total}    |
```

Le moteur de rendu duplique automatiquement la ligne 8 pour chaque element du tableau `lignes`. Si le tableau contient 4 elements, 4 lignes seront inserees.

**Difference avec DOCX** : pas besoin de lignes FOR/END-FOR separees. Le prefixe `${table:...}` suffit a indiquer la boucle.

### Totaux

Les cellules de total utilisent la syntaxe d'insertion simple. Les valeurs sont **auto-calculees** par le moteur de composition (il n'est pas necessaire de les passer dans la requete) :

| Cellule | Contenu | Resultat (auto-calcule) |
|---------|---------|--------------------------|
| D13 | `Total HT :` | Texte fixe |
| E13 | `${metadata.total_ht}` | Somme des totaux par ligne |
| D14 | `TVA (20%) :` | Texte fixe |
| E14 | `${metadata.tva}` | total_ht x 0.2 |
| D15 | `Total TTC :` | Texte fixe |
| E15 | `${metadata.total_ttc}` | total_ht x 1.2 |

### Formatage des nombres

Le formatage des cellules (`numFmt`) est preserve par le moteur de rendu. Si vous definissez un format `#,##0.00 "EUR"` sur une cellule, il sera conserve dans le fichier de sortie.

Dans la demo :

```javascript
ws.getCell('E13').numFmt = '#,##0.00\\ "€"';
```

### Creation

**Avec ExcelJS (Node.js)** : le code de la demo cree le fichier programmatiquement (voir `run-demo.sh`, section 4b).

**Manuellement** : ouvrir LibreOffice Calc, taper les placeholders `${...}` dans les cellules, sauvegarder en `.xlsx`.

### Structure de la demo

Le devis de la demo comporte :

```
Ligne 1 : Titre "DEVIS — LinCloud Souverain" (cellules fusionnees A1:F1)
Ligne 3 : Client : ${metadata.client}
Ligne 4 : Date : ${metadata.date}
Ligne 5 : Reference : ${metadata.reference}
Ligne 7 : En-tetes (Service | Description | Quantite | Prix unitaire | Total)
Ligne 8 : Donnees (${table:lignes.service} | ... | ${table:lignes.total})
...
Ligne 13 : Total HT : ${metadata.total_ht}
Ligne 14 : TVA (20%) : ${metadata.tva}
Ligne 15 : Total TTC : ${metadata.total_ttc}
```

---

## 7. Creer un template Marp (slides Markdown)

### Le principe

[Marp](https://marp.app/) convertit du Markdown en diaporama HTML. Un template Marp est un fichier `.md` avec un front matter YAML `marp: true` et des balises Fragmint.

### Structure de base

```markdown
---
marp: true
theme: default
paginate: true
---

# Titre de la presentation

---

## Slide suivante
```

- Le front matter `---` en debut de fichier configure Marp
- `---` seul sur une ligne separe les slides
- Tout le contenu Markdown standard est supporte (titres, listes, images, tableaux, gras, italique)

### Insertion

Les balises `+++INS ...+++` fonctionnent directement dans le Markdown :

```markdown
# LinCloud Souverain
## Proposition pour +++INS metadata.client+++
+++INS metadata.date+++
```

### Boucle (une slide par element)

La boucle `FOR` combinee avec le separateur `---` permet de generer **une slide par element** :

```markdown
+++FOR arg IN fragments.arguments+++

## +++INS $arg.title+++

+++INS $arg.body+++

---

+++END-FOR arg+++
```

Ici, chaque fragment de type `argument` genere une slide avec son titre et son contenu. Le `---` a l'interieur de la boucle cree une nouvelle slide pour chaque iteration.

### Tableaux Markdown

Les tableaux sont ecrits en syntaxe Markdown native, rendue par Marp :

```markdown
| Service | Description | Qte | P.U. | Total |
|---------|-------------|-----|------|-------|
+++FOR l IN lignes+++| +++INS $l.service+++ | +++INS $l.description+++ | +++INS $l.quantite+++ | +++INS $l.prix_unitaire+++ | +++INS $l.total+++ |
+++END-FOR l+++| | | | **Total HT** | **+++INS metadata.total_ht+++ EUR** |
| | | | **TVA 20%** | **+++INS metadata.tva+++ EUR** |
| | | | **Total TTC** | **+++INS metadata.total_ttc+++ EUR** |
```

**Point important** : en Marp, les lignes `FOR` et `END-FOR` sont placees au debut de la ligne de tableau (pas sur une ligne separee comme en DOCX). La ligne `FOR` est suivie immediatement par le pipe `|` de la cellule.

### Themes

Marp propose trois themes integres :

| Theme | Style |
|-------|-------|
| `default` | Sobre, fond blanc, texte noir |
| `gaia` | Bleu/vert avec plus de couleurs |
| `uncover` | Minimaliste, grandes polices |

Configurez le theme dans le front matter :

```yaml
---
marp: true
theme: gaia
---
```

### Pagination

Activez la pagination avec `paginate: true` dans le front matter. Les numeros de page apparaissent en bas de chaque slide.

### CSS personnalise

Le front matter accepte un bloc `style` pour personnaliser les slides :

```yaml
---
marp: true
style: |
  section { font-size: 24px; }
  h1 { color: #2B579A; }
  h2 { color: #2B579A; }
---
```

### Template complet de la demo (commente)

```markdown
---
marp: true                    # Active le mode Marp
theme: default                # Theme sobre
paginate: true                # Numeros de page
style: |                      # CSS personnalise
  section { font-size: 24px; }
  h1 { color: #2B579A; }     # Titres en bleu LINAGORA
  h2 { color: #2B579A; }
---

# LinCloud Souverain
## Proposition pour +++INS metadata.client+++     # Nom du client injecte
+++INS metadata.date+++                           # Date du document

---                                               # --- = nouvelle slide

## Contexte

+++INS fragments.introduction.body+++             # Corps du fragment introduction

---

# Debut de la boucle sur les arguments
+++FOR arg IN fragments.arguments+++

## +++INS $arg.title+++                           # Titre de chaque argument

+++INS $arg.body+++                               # Corps de chaque argument

---                                               # Nouvelle slide a chaque iteration

+++END-FOR arg+++
# Fin de la boucle — autant de slides que d'arguments

## Tarification

# Tableau Markdown avec boucle sur les lignes de devis
| Service | Description | Qte | P.U. | Total |
|---------|-------------|-----|------|-------|
+++FOR l IN lignes+++| +++INS $l.service+++ | +++INS $l.description+++ | +++INS $l.quantite+++ | +++INS $l.prix_unitaire+++ | +++INS $l.total+++ |
+++END-FOR l+++| | | | **Total HT** | **+++INS metadata.total_ht+++ EUR** |
| | | | **TVA 20%** | **+++INS metadata.tva+++ EUR** |
| | | | **Total TTC** | **+++INS metadata.total_ttc+++ EUR** |

---

## References

+++INS fragments.references.body+++               # Fragment des references clients

---

## Conclusion

+++INS fragments.conclusion.body+++               # Fragment de conclusion

---

# Merci
## +++INS metadata.client+++
**LINAGORA** — LinCloud Souverain
```

---

## 8. Creer un template reveal.js (presentation HTML)

### Le principe

[reveal.js](https://revealjs.com/) est un framework de presentation HTML. Un template reveal.js est un fichier `.html` contenant des elements `<section>` (une par slide) avec des balises Fragmint.

### Structure

Chaque `<section>` correspond a une slide :

```html
<section>
  <h1>Titre</h1>
  <p>Contenu de la slide</p>
</section>
```

Des slides imbriquees (navigation verticale) sont possibles en imbriquant les `<section>` :

```html
<section>
  <section>Slide horizontale 1</section>
  <section>Sous-slide verticale 1.1</section>
</section>
```

### Insertion

La balise `+++INS ...+++` fonctionne dans le HTML :

```html
<section>
  <h1>Proposition LinCloud Souverain</h1>
  <h2>+++INS metadata.client+++</h2>
  <p>+++INS metadata.date+++</p>
</section>
```

### +++HTML path+++ : conversion Markdown vers HTML

La directive `+++HTML ...+++` est **specifique a reveal.js**. Elle convertit le contenu Markdown d'un fragment en HTML avant injection. C'est indispensable car les fragments contiennent du Markdown, et reveal.js attend du HTML.

```html
<section>
  <h2>Contexte</h2>
  +++HTML fragments.introduction.body+++
</section>
```

**Difference avec `+++INS ...+++`** :
- `+++INS ...+++` injecte le texte brut (le Markdown n'est pas rendu)
- `+++HTML ...+++` convertit le Markdown en HTML (`# titre` devient `<h1>titre</h1>`, etc.)

### Boucle

La boucle `FOR` / `END-FOR` entoure des elements `<section>` pour creer une slide par element :

```html
+++FOR arg IN fragments.arguments+++
<section>
  <h2>+++INS $arg.title+++</h2>
  +++HTML $arg.body+++
</section>
+++END-FOR arg+++
```

Chaque fragment de type `argument` genere une `<section>` (une slide).

### Tableau HTML avec boucle

Pour le tableau de tarification, on utilise un `<table>` standard avec une boucle dans le `<tbody>` :

```html
<section>
  <h2>Tarification</h2>
  <table>
    <thead>
      <tr style="background:#2B579A;color:white;">
        <th>Service</th>
        <th>Description</th>
        <th>Qte</th>
        <th>P.U.</th>
        <th>Total</th>
      </tr>
    </thead>
    <tbody>
    +++FOR l IN lignes+++
    <tr>
      <td>+++INS $l.service+++</td>
      <td>+++INS $l.description+++</td>
      <td>+++INS $l.quantite+++</td>
      <td>+++INS $l.prix_unitaire+++</td>
      <td>+++INS $l.total+++</td>
    </tr>
    +++END-FOR l+++
    </tbody>
    <tfoot>
      <tr style="background:#f0f0f0;font-weight:bold;">
        <td colspan="4" style="text-align:right;">Total HT</td>
        <td>+++INS metadata.total_ht+++ EUR</td>
      </tr>
      <tr>
        <td colspan="4" style="text-align:right;">TVA (20%)</td>
        <td>+++INS metadata.tva+++ EUR</td>
      </tr>
      <tr style="background:#2B579A;color:white;font-weight:bold;">
        <td colspan="4" style="text-align:right;">Total TTC</td>
        <td>+++INS metadata.total_ttc+++ EUR</td>
      </tr>
    </tfoot>
  </table>
</section>
```

### Themes reveal.js

Les themes sont configures cote serveur lors du rendu. Les themes disponibles :

| Theme | Style |
|-------|-------|
| `white` | Fond blanc, texte noir (defaut) |
| `black` | Fond noir, texte blanc |
| `league` | Fond gris fonce, texte clair |
| `night` | Fond sombre bleu, texte clair |
| `beige` | Fond beige, style classique |
| `moon` | Fond bleu nuit |
| `solarized` | Palette Solarized |

### Animations

Les transitions entre slides sont configurables avec l'attribut `data-transition` :

```html
<section data-transition="fade">
  <h2>Slide avec transition fondu</h2>
</section>

<section data-transition="zoom">
  <h2>Slide avec transition zoom</h2>
</section>
```

Options : `slide` (defaut), `fade`, `zoom`, `convex`, `concave`, `none`.

### Template complet de la demo (commente)

```html
<!-- Slide 1 : Page de titre -->
<section>
  <h1>Proposition LinCloud Souverain</h1>
  <h2>+++INS metadata.client+++</h2>        <!-- Nom du client -->
  <p>+++INS metadata.date+++</p>             <!-- Date du document -->
</section>

<!-- Slide 2 : Introduction (Markdown converti en HTML) -->
<section>
  <h2>Contexte</h2>
  +++HTML fragments.introduction.body+++     <!-- +++HTML+++ convertit le Markdown -->
</section>

<!-- Slides 3 a N : une slide par argument -->
+++FOR arg IN fragments.arguments+++
<section>
  <h2>+++INS $arg.title+++</h2>             <!-- Titre de l'argument -->
  +++HTML $arg.body+++                       <!-- Corps en HTML -->
</section>
+++END-FOR arg+++

<!-- Slide N+1 : Tableau de tarification -->
<section>
  <h2>Tarification</h2>
  <table style="font-size:0.7em;width:100%;border-collapse:collapse;">
    <thead><tr style="background:#2B579A;color:white;">
      <th>Service</th>
      <th>Description</th>
      <th>Qte</th>
      <th>P.U.</th>
      <th>Total</th>
    </tr></thead>
    <tbody>
    +++FOR l IN lignes+++                    <!-- Boucle sur les lignes de devis -->
    <tr style="border-bottom:1px solid #ddd;">
      <td>+++INS $l.service+++</td>
      <td>+++INS $l.description+++</td>
      <td style="text-align:right;">+++INS $l.quantite+++</td>
      <td style="text-align:right;">+++INS $l.prix_unitaire+++</td>
      <td style="text-align:right;">+++INS $l.total+++</td>
    </tr>
    +++END-FOR l+++
    </tbody>
    <tfoot>
      <tr style="background:#f0f0f0;font-weight:bold;">
        <td colspan="4" style="text-align:right;">Total HT</td>
        <td style="text-align:right;">+++INS metadata.total_ht+++ EUR</td>
      </tr>
      <tr>
        <td colspan="4" style="text-align:right;">TVA (20%)</td>
        <td style="text-align:right;">+++INS metadata.tva+++ EUR</td>
      </tr>
      <tr style="background:#2B579A;color:white;font-weight:bold;">
        <td colspan="4" style="text-align:right;">Total TTC</td>
        <td style="text-align:right;">+++INS metadata.total_ttc+++ EUR</td>
      </tr>
    </tfoot>
  </table>
</section>

<!-- Slide references -->
<section>
  <h2>References</h2>
  +++HTML fragments.references.body+++       <!-- References clients -->
</section>

<!-- Slide conclusion -->
<section>
  <h2>Conclusion</h2>
  +++HTML fragments.conclusion.body+++       <!-- Conclusion -->
</section>

<!-- Slide de remerciement -->
<section>
  <h1>Merci</h1>
  <p><strong>LINAGORA</strong> — Editeur de logiciels libres</p>
  <p>contact@linagora.com | www.linagora.com</p>
</section>
```

---

## 9. Le fichier YAML de definition (.fragmint.yaml)

Le fichier YAML est le **lien** entre le template et les fragments. Il declare quels fragments sont attendus, quelles metadonnees le client doit fournir, et dans quel format le document sera genere.

### Structure complete

```yaml
# --- Identite du template ---
id: tpl-lincloud-slides              # Identifiant unique
name: "LinCloud Souverain — ..."     # Nom lisible
output_format: slides                # Format de sortie
carbone_template: lincloud-slides.md # Fichier template associe
version: "1.0"                       # Version semantique

# --- Metadonnees attendues ---
context_schema:
  client:
    type: string
    required: true
  date:
    type: date
    default: today
  reference:
    type: string
    default: "LC-2026-001"

# --- Slots de fragments ---
fragments:
  - key: introduction
    type: introduction
    domain: cloud
    lang: fr
    count: 1
  - key: arguments
    type: argument
    domain: cloud
    lang: fr
    count: 6
```

### Champs du YAML expliques

#### Identite

| Champ | Description | Exemple |
|-------|-------------|---------|
| `id` | Identifiant unique du template | `tpl-lincloud-docx` |
| `name` | Nom affichable pour l'utilisateur | `"LinCloud — Proposition DOCX"` |
| `output_format` | Format de sortie | `docx`, `xlsx`, `slides`, `reveal` |
| `carbone_template` | Nom du fichier template uploade | `lincloud-proposal.docx` |
| `version` | Version du template | `"1.0"` |

#### `output_format` : valeurs possibles

| Valeur | Description |
|--------|-------------|
| `docx` | Document Word via docx-templates |
| `xlsx` | Tableur Excel via ExcelJS |
| `slides` | Diaporama Marp (Markdown vers HTML) |
| `reveal` | Presentation reveal.js (HTML) |
| `pptx` | PowerPoint (prevu) |

#### `context_schema` : les metadonnees

Le `context_schema` definit les champs que le client doit fournir lors de la composition :

```yaml
context_schema:
  client:
    type: string          # Type : string, number, boolean, date
    required: true         # Obligatoire
  date:
    type: date
    default: today         # Valeur par defaut si non fourni
  devise:
    type: string
    default: "EUR"
    enum: ["EUR", "USD"]   # Liste de valeurs autorisees
```

Dans le template, ces valeurs sont accessibles via `metadata.<champ>`.

#### `fragments[]` : les slots de resolution

Chaque slot declare un fragment (ou un groupe de fragments) a resoudre :

```yaml
fragments:
  - key: introduction       # Cle d'acces : fragments.introduction.body
    type: introduction       # Filtre par type de fragment
    domain: cloud            # Filtre par domaine
    lang: fr                 # Filtre par langue
    count: 1                 # Nombre de fragments attendus (1 = single)

  - key: arguments           # Cle d'acces : fragments.arguments (tableau)
    type: argument
    domain: cloud
    lang: fr
    count: 6                 # 6 fragments attendus (array)

  - key: references
    type: argument
    domain: cloud
    lang: fr
    count: 1
    fallback: skip           # Si non trouve : ignorer (pas d'erreur)
```

| Champ | Description |
|-------|-------------|
| `key` | Cle d'acces dans le template (`fragments.<key>`) |
| `type` | Type de fragment a rechercher |
| `domain` | Domaine metier pour le filtrage |
| `lang` | Langue souhaitee |
| `count` | Nombre de fragments : `1` = single, `>1` = array |
| `quality_min` | Qualite minimale acceptee (`draft`, `reviewed`, `approved`) |
| `fallback` | Comportement si non trouve : `skip` (ignorer), texte par defaut, ou erreur |
| `required` | Slot obligatoire (`true`) ou optionnel (`false`) |

### Exemple commente : YAML de la demo (Marp)

```yaml
# Template de presentation Marp pour l'offre LinCloud
id: tpl-lincloud-slides
name: "LinCloud Souverain — Presentation Marp"
output_format: slides                      # Rendu Marp (Markdown -> HTML)
carbone_template: lincloud-slides.md       # Fichier .md a utiliser
version: "1.0"

# Donnees attendues dans la requete de composition
context_schema:
  client:
    type: string
    required: true                         # Le nom du client est obligatoire
  date:
    type: date
    default: today                         # Date du jour si non fournie
  reference:
    type: string
    default: "LC-2026-001"                 # Reference par defaut

# Fragments a resoudre automatiquement
fragments:
  - key: introduction                      # fragments.introduction.body
    type: introduction
    domain: cloud
    lang: fr
    count: 1                               # Un seul fragment

  - key: arguments                         # fragments.arguments[].body
    type: argument
    domain: cloud
    lang: fr
    count: 6                               # 6 arguments (un par slide)

  - key: pricing                           # fragments.pricing.body
    type: pricing
    domain: cloud
    lang: fr
    count: 1

  - key: references                        # fragments.references.body
    type: argument
    domain: cloud
    lang: fr
    count: 1
    fallback: skip                         # Si pas de fragment references, pas d'erreur

  - key: conclusion                        # fragments.conclusion.body
    type: conclusion
    domain: cloud
    lang: fr
    count: 1
```

### Differences entre les 4 YAML de la demo

Les 4 templates partagent la meme structure. Les differences :

| | Marp | reveal.js | DOCX | XLSX |
|---|---|---|---|---|
| `id` | tpl-lincloud-slides | tpl-lincloud-reveal | tpl-lincloud-docx | tpl-lincloud-xlsx |
| `output_format` | slides | reveal | docx | xlsx |
| `carbone_template` | .md | .html | .docx | .xlsx |
| Fragments | 5 slots | 5 slots | 5 slots | 3 slots (intro, pricing, conclusion seulement) |

Le YAML du XLSX est plus simple car le devis n'a pas besoin des arguments ni des references : il se concentre sur les donnees de tarification.

---

## 10. La requete de composition

### Endpoint

```
POST /v1/templates/:id/compose
```

Ou `:id` est l'identifiant du template (ex. `tpl-lincloud-docx`).

### Corps de la requete

```json
{
  "context": {
    "client": "Ministere des Armees",
    "date": "2026-03-16",
    "reference": "LC-2026-MINARM-001"
  },
  "structured_data": {
    "lignes": [
      {"service": "Compute vCPU", "description": "100 vCPU x 730h/mois", "quantite": 100, "prix_unitaire": 18.25},
      {"service": "Stockage objet S3", "description": "5 000 Go stockage objet", "quantite": 5000, "prix_unitaire": 0.008},
      {"service": "Stockage bloc SSD", "description": "2 000 Go SSD haute perf.", "quantite": 2000, "prix_unitaire": 0.12},
      {"service": "Support Premium 24/7", "description": "12 mois SLA 4h", "quantite": 12, "prix_unitaire": 850.00}
    ]
  },
  "output": {
    "format": "docx",
    "filename": "lincloud-proposition.docx"
  }
}
```

> **Note** : les champs `total` par ligne, `total_ht`, `tva` et `total_ttc` ne sont pas fournis dans la requete. Le moteur de composition les calcule automatiquement et les injecte dans `metadata` (voir section 4).

| Champ | Description |
|-------|-------------|
| `context` | Les metadonnees du document (accessibles via `metadata.*` dans le template) |
| `structured_data` | Les donnees tabulaires (accessibles via leur cle, ex. `lignes`) — seuls `quantite` et `prix_unitaire` sont requis par ligne |
| `output.format` | Format de sortie souhaite |
| `output.filename` | Nom du fichier genere |
| `overrides` | (optionnel) Surcharges de fragments specifiques |

### Reponse : le rapport de composition

```json
{
  "data": {
    "resolved": [
      {"key": "introduction", "fragment_id": "frag-abc123", "quality": "approved"},
      {"key": "arguments", "fragment_ids": ["frag-1", "frag-2", "..."], "quality": "approved"}
    ],
    "skipped": [],
    "warnings": [],
    "render_ms": 245,
    "document_url": "/v1/outputs/lincloud-proposition.docx"
  }
}
```

| Champ | Description |
|-------|-------------|
| `resolved` | Fragments resolus avec succes |
| `skipped` | Slots ignores (fallback: skip) |
| `warnings` | Avertissements (qualite inferieure, fallback utilise) |
| `render_ms` | Temps de rendu en millisecondes |
| `document_url` | URL de telechargement du document genere |

### Telecharger le document

```bash
GET /v1/outputs/:filename
```

### Exemple curl complet

```bash
# 1. Se connecter
TOKEN=$(curl -s -X POST http://localhost:3210/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"mmaudet","password":"fragmint-dev"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['token'])")

# 2. Composer le document
curl -s -X POST http://localhost:3210/v1/templates/tpl-lincloud-docx/compose \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "context": {
      "client": "Ministere des Armees",
      "date": "2026-03-16"
    },
    "structured_data": {
      "lignes": [
        {"service": "Compute vCPU", "description": "100 vCPU", "quantite": 100, "prix_unitaire": 18.25}
      ]
    },
    "output": {"format": "docx", "filename": "ma-proposition.docx"}
  }'

# 3. Telecharger le fichier genere
curl -s -o ma-proposition.docx \
  -H "Authorization: Bearer $TOKEN" \
  http://localhost:3210/v1/outputs/ma-proposition.docx
```

---

## 11. Creer sa propre demo

### Etape 1 : Definir son cas d'usage

Commencez par definir :
- **Le domaine** : quel produit ou service ? (ex. cybersecurite, RH, logistique)
- **Les types de documents** : proposition ? devis ? presentation ? rapport ?
- **Les fragments necessaires** : quels blocs de contenu sont reutilisables ?

### Etape 2 : Ecrire les fragments en JSON

Creez un repertoire `fragments/` et ecrivez un fichier JSON par fragment :

```json
{
  "type": "argument",
  "domain": "mon-produit",
  "lang": "fr",
  "body": "Mon argument principal...",
  "tags": ["tag1", "tag2"],
  "quality": "approved"
}
```

### Etape 3 : Creer les templates

Choisissez un ou plusieurs formats parmi DOCX, XLSX, Marp, reveal.js. Pour chaque format, creez le fichier template en utilisant la syntaxe decrite dans les sections 5 a 8.

### Etape 4 : Ecrire les YAML de definition

Pour chaque template, ecrivez un fichier `.yaml` qui declare les slots de fragments et les metadonnees attendues (voir section 9).

### Etape 5 : Adapter le script

Copiez `e2e/demo/run-demo.sh` et modifiez :
- Les chemins vers vos fragments et templates
- Les donnees de composition (`COMPOSE_CONTEXT`)
- Les appels `upload_template` et `compose_and_download`

### Conseils

| Ordre | Format | Difficulte | Pourquoi |
|-------|--------|------------|----------|
| 1 | **Marp** | Facile | Markdown pur, pas de XML, edition dans n'importe quel editeur texte |
| 2 | **DOCX** | Moyen | Attention aux runs XML et aux lignes FOR/END-FOR dans les tableaux |
| 3 | **reveal.js** | Moyen | HTML standard, mais il faut connaitre la structure `<section>` |
| 4 | **XLSX** | Avance | Creation programmatique recommandee, syntaxe `${table:...}` specifique |

**Astuce** : commencez toujours par un template simple avec seulement des insertions (`+++INS ...+++`), puis ajoutez les boucles une fois que les insertions fonctionnent.

---

## 12. Resume des syntaxes par format

### Tableau recapitulatif

| Concept | DOCX | XLSX | Marp | reveal.js |
|---------|------|------|------|-----------|
| Insertion simple | `+++INS field+++` | `${field}` | `+++INS field+++` | `+++INS field+++` |
| Boucle | `+++FOR var IN array+++` (ligne separee) | `${table:array.field}` | `+++FOR var IN array+++` (inline) | `+++FOR var IN array+++` (inline) |
| Fin de boucle | `+++END-FOR var+++` (ligne separee) | (automatique) | `+++END-FOR var+++` (inline) | `+++END-FOR var+++` (inline) |
| Variable boucle | `$var.field` | (automatique) | `$var.field` | `$var.field` |
| Condition | `+++IF field+++` | N/A | `+++IF field+++` | `+++IF field+++` |
| Markdown vers HTML | N/A | N/A | natif (Marp rend le Markdown) | `+++HTML field+++` |
| Separation slides | N/A | N/A | `---` | `<section>` |
| Fichier template | `.docx` | `.xlsx` | `.md` | `.html` |
| Moteur de rendu | docx-templates | ExcelJS | Marp CLI | reveal.js |

### Acces aux donnees

| Donnee | Syntaxe dans le template |
|--------|--------------------------|
| Metadonnee (context) | `metadata.<champ>` |
| Fragment simple | `fragments.<key>.body` |
| Fragment en boucle | `$var.body` (dans un FOR) |
| Donnee structuree simple | `<champ>` |
| Donnee structuree en boucle | `$var.<champ>` (dans un FOR) |

### Prefixe `$` : quand l'utiliser

| Contexte | Syntaxe | Exemple |
|----------|---------|---------|
| Hors boucle | Pas de `$` | `+++INS metadata.client+++` |
| Dans une boucle | `$` + nom de variable | `+++INS $arg.body+++` |
| Premier niveau | Pas de `$` | `+++INS fragments.introduction.body+++` |

### Fichiers de la demo

```
e2e/demo/
  fragments/
    01-introduction.json     — type: introduction
    02-architecture.json     — type: argument (architecture)
    03-security.json         — type: argument (securite)
    04-interoperability.json — type: argument (interoperabilite)
    05-availability.json     — type: argument (disponibilite)
    06-sovereignty.json      — type: argument (souverainete)
    07-support.json          — type: argument (support)
    08-pricing.json          — type: pricing
    09-references.json       — type: argument (references)
    10-conclusion.json       — type: conclusion
  templates/
    marp/
      lincloud-slides.md     — template Marp
      lincloud-slides.yaml   — definition YAML
    reveal/
      lincloud-reveal.html   — template reveal.js
      lincloud-reveal.yaml   — definition YAML
    docx/
      lincloud-proposition.yaml — definition YAML (le .docx est genere par le script)
    xlsx/
      lincloud-devis.yaml    — definition YAML (le .xlsx est genere par le script)
  run-demo.sh                — script d'execution
  output/                    — fichiers generes
```
