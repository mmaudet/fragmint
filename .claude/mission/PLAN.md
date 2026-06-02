# Fragmint — Plan complet (Phase 1 + Phase 2+)

> **Document fusionné** — Partie 1 : fondations (à exécuter en premier) + Partie 2 : architecture cible (à exécuter après).
>
> **Version** : V2 — intègre les décisions issues des notes Paul (3 modes confirmés, multi-agent self-consistency, simplification temporelle, distinction relations implicites/explicites)
>
> **Ordre de lecture recommandé** :
>
> - Commencer par la **Partie 1** (fondations : chunking, métadonnées, taux de confiance, référentiels admin) — ce sont les prérequis
> - Puis lire la **Partie 2** (architecture cible : 3 modes retrieval, index.md Karpathy, relations, supersedure, contradictions, Skills OpenCode)
>
> Les deux parties sont complémentaires. La Partie 1 conditionne la qualité de tout ce qui est décrit en Partie 2.

---

---

# PARTIE 1 — Fondations (Phase 1, Semaine 1 Jours 1-3)

> **À exécuter en premier** — ces chantiers conditionnent la qualité de tout le reste.

---

# Fragmint — Phase 1 : Fondations

> **Objectif** : décrire les chantiers de **fondations** à attaquer en **priorité absolue** (Semaine 1, jours 1-3) avant les chantiers d'architecture (modes de retrieval, index.md, etc.) décrits en Partie 2.
>
> **Date** : 21 mai 2026
> **Lien avec la Partie 2** : cette partie approfondit les sections 5, 6 et 27 de la Partie 2. Les deux parties sont **complémentaires**, pas redondantes.

---

## Comment lire ce document avec le doc principal

### Si tu démarres Fragmint depuis zéro

1. **Lis d'abord** la **Partie 2** de ce document pour le contexte stratégique global (sections 1-3)
2. **Lis ensuite ce doc** pour les chantiers de fondations à exécuter en premier
3. **Reviens au doc principal** pour les chantiers d'architecture (modes retrieval, index.md, Karpathy, etc.)

### Pourquoi ces chantiers sont en Phase 1

Les chantiers décrits ici **conditionnent la qualité de tout le reste** :

- Sans fragments bien dimensionnés, le retrieval Karpathy va galérer (index trop volumineux ou fragments trop coarse)
- Sans métadonnées structurées, le LLM as judge ne peut pas raisonner finement
- Sans référentiels admin, le système accumule du bruit (variations orthographiques, duplications conceptuelles)
- Sans taux de confiance fiable, l'humain ne sait pas où porter son attention en validation

**Faire ces fondations en premier permet à tout le reste de bien marcher**. C'est l'inverse qui serait catastrophique : implémenter les 3 modes de retrieval sur des fragments mal dimensionnés et mal classés = inutile.

### Ordre d'exécution proposé pour la Phase 1

| Jour        | Chantier                                            | Référence                  |
| ----------- | --------------------------------------------------- | -------------------------- |
| Lundi       | Référentiels admin + Schéma DB enrichi              | Section 1 ci-dessous       |
| Mardi       | Prompt LLM enrichi (taille + structure métadonnées) | Sections 2 et 3 ci-dessous |
| Mercredi    | Post-processing chunking + Fix taux de confiance    | Sections 2 et 4 ci-dessous |
| Mercredi PM | Ré-ingestion corpus + tests                         | Section 5 ci-dessous       |

**Important** : ces chantiers se font **en parallèle** (métadonnées + chunking + confiance), pas en séquentiel, parce qu'ils touchent les mêmes fichiers (`llm-client.ts`, `harvester-service.ts`).

---

## Table des matières

1. [Référentiels admin et validation des métadonnées émergentes](#1-référentiels-admin)
2. [Chunking : fix de la taille des fragments](#2-chunking)
3. [Refonte du prompt segmentAndClassify (chunking + métadonnées en une passe)](#3-prompt-unifié)
4. [Taux de confiance : signaux qualitatifs](#4-taux-de-confiance)
5. [Workflow de test sur le cas IRA](#5-workflow-test-ira)
6. [Stratégie d'ordonnancement détaillée](#6-ordonnancement)
7. [Discussion de fond](#7-discussion-de-fond)

---

## 1. Référentiels admin et validation des métadonnées émergentes

### Pourquoi

Aujourd'hui, le LLM génère les tags librement. Résultat observé sur des fragments réels :

- Mélange de catégories dans les tags : `jmap` (technologie), `apache-james` (technologie), `email` (concept), `twake-mail` (produit), `gafam` (entité externe), `open-source` (concept), `deployment` (fonction), `saas` (mode)
- Variations orthographiques non regroupées : `open-source` vs `opensource` vs `open source`, `twake-mail` vs `twake mail` vs `Twake Mail`
- Aucun moyen pour un admin de valider, renommer, fusionner ou rejeter ces propositions

**Conséquence** : recherche peu fiable, knowledge graph pollué, métadonnées non comparables entre fragments.

### Approche

Mettre en place 3 référentiels structurés :

- **Subjects** : valeurs admin-defined (twake-mail, twake-calendar, linshare, lincloud, linto, openrag, linagora-corp, other)
- **Entities** : valeurs admin-defined avec types (clients, products, technologies, partners, certifications, regulations, metrics)
- **Tags conceptuels** : valeurs admin-defined (open-source, sovereignty, on-premise, scalable, high-availability, etc.)

Le LLM doit **choisir dans le référentiel en priorité**. Il peut proposer de nouvelles valeurs, mais elles sont marquées `validated: false` et nécessitent validation admin.

### Implémentation

#### Schéma DB

```sql
-- Migration: référentiels
CREATE TABLE subjects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  display_name TEXT,
  description TEXT,
  validated BOOLEAN DEFAULT 1,
  usage_count INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  proposed_by TEXT  -- 'admin' | 'llm-auto'
);

CREATE TABLE entities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN ('client', 'product', 'technology', 'partner', 'certification', 'regulation', 'metric')),
  name TEXT NOT NULL,
  canonical_name TEXT NOT NULL,  -- forme canonique (ex: "CNB" pour "Conseil National des Barreaux")
  normalized_name TEXT NOT NULL,  -- lowercase, no accents, pour recherche
  aliases TEXT,  -- JSON array des variantes connues
  validated BOOLEAN DEFAULT 0,
  usage_count INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  proposed_by TEXT,

  UNIQUE(type, normalized_name)
);

CREATE INDEX idx_entities_type_normalized ON entities(type, normalized_name);

CREATE TABLE tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  normalized_name TEXT NOT NULL,
  category TEXT,  -- 'concept' | 'mode' | 'industry' | 'other'
  validated BOOLEAN DEFAULT 0,
  usage_count INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  proposed_by TEXT
);

-- Table de liaison fragments <-> entities
CREATE TABLE fragment_entities (
  fragment_id TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  PRIMARY KEY (fragment_id, entity_id),
  FOREIGN KEY (fragment_id) REFERENCES fragments(id) ON DELETE CASCADE,
  FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE
);
```

#### Seed des référentiels initiaux

Créer un fichier `packages/server/src/seeds/references.ts` avec les valeurs initiales basées sur ce qu'on a vu dans le corpus Linagora :

```typescript
export const INITIAL_SUBJECTS = [
  { name: 'twake-mail', description: 'Twake Mail messaging product' },
  { name: 'twake-calendar', description: 'Twake Calendar product' },
  { name: 'twake-drive', description: 'Twake Drive file sharing' },
  { name: 'twake-chat', description: 'Twake Chat instant messaging' },
  { name: 'linshare', description: 'LinShare secure file sharing' },
  { name: 'lincloud', description: 'LinCloud sovereign cloud platform' },
  { name: 'linto', description: 'LinTO voice/AI assistant' },
  { name: 'openrag', description: 'OpenRAG retrieval-augmented generation' },
  { name: 'linagora-corp', description: 'Linagora as a company' },
  { name: 'other', description: 'Fallback when nothing else fits' },
];

export const INITIAL_ENTITIES = {
  clients: [
    { canonical: 'CNB', aliases: ['Conseil National des Barreaux'] },
    { canonical: 'Sesam-Vitale', aliases: ['SESAM-Vitale', 'Sesam Vitale'] },
    { canonical: 'IRA', aliases: ["Institut Régional d'Administration", 'IRAs'] },
    { canonical: 'État Mauricien', aliases: ['Maurice', 'gouvernement mauricien'] },
    { canonical: 'DGAFP', aliases: ["Direction générale de l'administration"] },
  ],
  products: [
    { canonical: 'Twake Mail', aliases: ['Twake.Mail'] },
    { canonical: 'Twake Calendar', aliases: ['Twake.Calendar'] },
    { canonical: 'Twake Drive', aliases: ['Twake.Drive'] },
    { canonical: 'Twake Chat', aliases: ['Twake.Chat'] },
    { canonical: 'LinShare', aliases: ['LinShare Pro'] },
    { canonical: 'LinCloud', aliases: ['LinCloud Souverain'] },
    { canonical: 'Apache James', aliases: ['James'] },
    { canonical: 'Microsoft Exchange', aliases: ['Exchange'] },
    { canonical: 'Office 365', aliases: ['Microsoft 365', 'O365'] },
    { canonical: 'Outlook', aliases: ['Microsoft Outlook'] },
  ],
  technologies: [
    { canonical: 'JMAP', aliases: [] },
    { canonical: 'IMAP', aliases: [] },
    { canonical: 'CalDAV', aliases: [] },
    { canonical: 'LDAP', aliases: ['Active Directory', 'AD'] },
    { canonical: 'LemonLDAP', aliases: ['LemonLDAP-NG'] },
    { canonical: 'Kubernetes', aliases: ['K8s'] },
    { canonical: 'Docker', aliases: [] },
    { canonical: 'Cassandra', aliases: ['Apache Cassandra'] },
    { canonical: 'PostgreSQL', aliases: ['Postgres'] },
    { canonical: 'CouchDB', aliases: [] },
    { canonical: 'RspamD', aliases: ['Rspamd'] },
    { canonical: 'ClamAV', aliases: [] },
    { canonical: 'Matrix', aliases: ['Matrix protocol'] },
    { canonical: 'SAML', aliases: [] },
    { canonical: 'OIDC', aliases: ['OpenID Connect'] },
    { canonical: 'CAS', aliases: [] },
  ],
  partners: [
    { canonical: 'Cloud Temple', aliases: [] },
    { canonical: 'DINUM', aliases: ['Direction interministérielle du numérique'] },
    { canonical: 'Tchap', aliases: [] },
    { canonical: 'OVH', aliases: ['OVHcloud'] },
  ],
  certifications: [
    { canonical: 'SecNumCloud', aliases: [] },
    { canonical: 'RGPD', aliases: ['GDPR'] },
    { canonical: 'HDS', aliases: ['Hébergeur de Données de Santé'] },
    { canonical: 'ISO27001', aliases: ['ISO 27001'] },
  ],
  regulations: [
    { canonical: 'RGPD', aliases: ['GDPR'] },
    { canonical: 'Cloud Act', aliases: ['CLOUD Act'] },
    { canonical: 'FISA', aliases: [] },
  ],
};

export const INITIAL_TAGS = {
  concept: [
    'open-source',
    'sovereignty',
    'on-premise',
    'cloud-native',
    'high-availability',
    'scalable',
    'interoperability',
    'european-initiative',
    'third-way-digital',
  ],
  mode: ['saas', 'self-hosted', 'hybrid', 'cloud', 'edge'],
  industry: ['public-sector', 'health', 'finance', 'education', 'government'],
};
```

#### Endpoint admin pour validation

```typescript
// GET /v1/admin/proposals?type=tag|entity|subject&status=pending
// Retourne les propositions en attente de validation

// POST /v1/admin/proposals/:id/validate
// Body: { action: 'approve' | 'rename' | 'merge_with' | 'reject', target?: string }

// Exemple:
// POST /v1/admin/proposals/42/validate
// { action: 'merge_with', target: 'open-source' }
// → fusionne "opensource" (proposition) avec "open-source" (existant validé)
```

#### UI admin minimum

Page "Validation Métadonnées" avec 3 onglets :

- Tags émergents (count d'usage + preview fragments)
- Entités émergentes (avec type proposé)
- Subjects émergents (cas rare)

Actions par item : Approuver / Renommer / Fusionner / Rejeter.

Cette UI peut être générée par Claude Design (cf section 17 du doc principal).

**Implémentation complète disponible** : voir le package `FRAGMINT_ADMIN_METADATA_PACKAGE.md` qui contient le code complet (DB Drizzle, endpoints API, composants React, hooks) prêt à intégrer.

---

## 2. Chunking : fix de la taille des fragments

### Constat empirique

Lors d'un test d'ingestion réel sur des fragments Linagora, plusieurs fragments observés font **15 à 20+ lignes** (estimés à 300-500 mots) :

- Fragment "Contexte géopolitique et souveraineté" : ~20 lignes, mélange Cloud Act, FISA, initiatives européennes, Gaia-X dans un seul bloc
- Fragment "Adaptabilité et modèles de déploiement" : ~15 lignes, couvre SaaS souverain + On-Premise + Hybridation + Modèle économique dans un seul bloc

Ces fragments mélangent **plusieurs idées distinctes** dans un seul bloc, ce qui les rend peu réutilisables.

### Diagnostic

Le problème vient du prompt `segmentAndClassify` dans `llm-client.ts` : il ne donne **aucune contrainte de taille** au LLM lors du découpage. Le LLM produit des chunks de taille arbitraire en suivant la structure du doc source.

### Solution en 2 niveaux : prompt + post-processing

**Niveau 1 — Prompt** : ajouter des règles de taille et de cohérence dans le prompt
**Niveau 2 — Post-processing** : filet de sécurité dans `harvester-service.ts` qui split les blocs trop grands et fusionne les trop petits

Le LLM ne respecte pas toujours les consignes de taille (surtout sur des modèles plus petits), donc le post-processing est nécessaire même avec un bon prompt.

### Modification du prompt (`llm-client.ts`)

Ajouter dans le prompt `segmentAndClassify` :

```
- size: each block body must be 30–200 words. If a section exceeds 200 words,
  split it into multiple separate blocks, each covering ONE distinct idea.
  List items may each become their own block when ≥30 words.
  Short atomic blocks (≥30 words) are valuable — don't artificially merge them.
  Never bundle unrelated ideas into one block.

- coherence: each block must express ONE coherent idea that can stand alone.
  A reader should understand the block without context from other blocks.
  Avoid references like "as mentioned above" or "see next section".
```

**Note importante sur le min** : 30 mots (pas 50) pour préserver les fragments "atomiques" punchy qui sont très réutilisables. Exemples :

- Référence client courte : "Le CNB déploie Twake Mail pour 17 000 avocats." (~10 mots, légitime)
- Argument punchy : "Open source réel, pas de dual licensing." (~7 mots, précieux)
- Engagement contractuel : "SLA 99,5% sur heures ouvrées." (~7 mots, essentiel)

### Post-processing dans `harvester-service.ts`

Ajouter une méthode `splitOversizedBlocks` et `mergeUndersizedBlocks` appelées après `deduplicateBlocks`.

#### Stratégie de découpage hiérarchique

```typescript
const MIN_WORDS = 30;
const MAX_WORDS = 200;
const TARGET_WORDS = 100;

function splitOversizedBlock(block: Block): Block[] {
  const wordCount = countWords(block.body);
  if (wordCount <= MAX_WORDS) return [block];

  // 1. Essayer de découper sur les sous-titres markdown (### et ####)
  let parts = splitByMarkdownHeadings(block.body, [3, 4]);
  if (parts.length > 1 && allPartsValid(parts)) return finalize(parts, block);

  // 2. Essayer de découper sur les paragraphes (\n\n)
  parts = block.body.split(/\n\n+/);
  if (parts.length > 1 && allPartsValid(parts)) return finalize(parts, block);

  // 3. Essayer de découper sur les items de liste
  parts = splitByListItems(block.body);
  if (parts.length > 1 && allPartsValid(parts)) return finalize(parts, block);

  // 4. Fallback : découper sur les phrases en regroupant jusqu'à TARGET_WORDS
  parts = splitBySentencesWithTarget(block.body, TARGET_WORDS);
  return finalize(parts, block);
}

function allPartsValid(parts: string[]): boolean {
  return parts.every((p) => {
    const wc = countWords(p);
    return wc >= MIN_WORDS && wc <= MAX_WORDS;
  });
}

function finalize(parts: string[], originalBlock: Block): Block[] {
  return parts.map((part, idx) => ({
    ...originalBlock,
    body: part,
    id: `${originalBlock.id}-${idx + 1}`,
    parent_id: originalBlock.id,
    split_index: idx,
  }));
}
```

#### Fusion des petits morceaux

```typescript
function mergeUndersizedBlocks(blocks: Block[]): Block[] {
  const merged: Block[] = [];
  let buffer: Block | null = null;

  for (const block of blocks) {
    if (countWords(block.body) < MIN_WORDS) {
      if (buffer) {
        // Vérifier compatibilité sémantique avant fusion
        if (areSemanticCompatible(buffer, block)) {
          buffer = mergeTwo(buffer, block);
        } else {
          // Pas compatible : on garde le buffer comme petit fragment isolé
          merged.push(buffer);
          buffer = block;
        }
      } else {
        buffer = block;
      }
    } else {
      if (buffer) {
        if (areSemanticCompatible(buffer, block)) {
          merged.push(mergeTwo(buffer, block));
        } else {
          merged.push(buffer);
          merged.push(block);
        }
        buffer = null;
      } else {
        merged.push(block);
      }
    }
  }

  if (buffer) {
    merged.push(buffer);
  }

  return merged;
}

function areSemanticCompatible(a: Block, b: Block): boolean {
  // Critères :
  // - même subject détecté (si la classification a déjà été faite)
  // - sinon, défaut : compatibles
  if (a.subject && b.subject && a.subject !== b.subject) return false;
  return true;
}
```

### Re-classification des sous-blocs créés par split

Quand un bloc est splitté, les métadonnées d'origine ne sont **plus forcément valides** pour les sous-blocs (ils peuvent couvrir des sujets différents).

**Stratégie hybride** :

- Sous-blocs **gros** (>150 mots) : re-classification LLM complète
- Sous-blocs **moyens** (50-150 mots) : héritage des métadonnées parent + flag `needs_review: true`
- Sous-blocs **petits** (30-50 mots) : héritage strict des métadonnées parent

```typescript
async function reclassifySplitBlocks(blocks: Block[]): Promise<Block[]> {
  return await Promise.all(
    blocks.map(async (block) => {
      if (!block.parent_id) return block; // pas un sous-bloc

      const wordCount = countWords(block.body);
      if (wordCount > 150) {
        // Re-classification complète
        return await classifyFragment(block);
      } else {
        // Héritage + flag
        return { ...block, needs_review: wordCount > 50 };
      }
    }),
  );
}
```

### Séquence d'exécution complète dans `harvester-service.ts`

```typescript
async function harvestDocument(doc: ParsedDoc): Promise<Fragment[]> {
  // 1. LLM segmente et classifie (avec nouveau prompt incluant règles de taille)
  let blocks = await llmClient.segmentAndClassify(doc);

  // 2. Déduplication (existant)
  blocks = deduplicateBlocks(blocks);

  // 3. NOUVEAU : post-processing taille
  blocks = blocks.flatMap(splitOversizedBlock);
  blocks = mergeUndersizedBlocks(blocks);

  // 4. NOUVEAU : re-classifier les sous-blocs créés par split
  blocks = await reclassifySplitBlocks(blocks);

  // 5. NOUVEAU : extraction d'entités (cf section 26)
  blocks = await extractEntities(blocks);

  // 6. Persistence (existant, adapté pour nouveaux champs)
  return persistFragments(blocks);
}
```

### Critères de qualité pour valider le chunking

Sur le corpus de test après ré-ingestion :

- **90% des fragments** dans la cible 30-200 mots
- **95% des fragments** sont sémantiquement cohérents (lisibles seuls)
- **Aucun fragment** ne fait référence à un contexte absent ("comme mentionné précédemment", "voir section X")
- Distribution équilibrée : ~30% courts (30-80 mots), ~50% moyens (80-150 mots), ~20% longs (150-200 mots)

### Piège à éviter

**Ne pas boucler à l'infini sur la qualité du chunking**. C'est un puits sans fond. Une fois les critères ci-dessus atteints, passer à la suite.

---

## 3. Refonte du prompt segmentAndClassify (chunking + métadonnées en une passe)

### Pourquoi en une seule passe

Les deux chantiers (chunking et métadonnées) touchent **le même prompt** dans `llm-client.ts`. Les faire en séquentiel = modifier 2 fois le prompt complexe = risque d'erreur et perte de temps.

**Faire les 2 en une seule passe permet** :

- Une seule rédaction soignée du prompt
- Une seule re-ingestion du corpus pour valider
- Une seule série de tests d'intégration

### Structure du nouveau prompt

```typescript
const SEGMENT_AND_CLASSIFY_PROMPT = `
Tu analyses un document et tu en extrais des fragments réutilisables.

# Document à analyser
Title: {document.title}
Body:
{document.body}

# Référentiels disponibles

## Subjects validés (utilise UNIQUEMENT ces valeurs)
{validated_subjects_list}

## Functions disponibles (choisir UNE)
- technical: architecture, déploiement, intégration
- commercial: offres, pricing, engagements, value proposition
- legal: clauses, conformité, aspects réglementaires
- operational: support, SLA, maintenance, procédures
- strategic: vision, positionnement, roadmap, partenariats
- reference: témoignage client, cas d'usage

## Types rhétoriques disponibles (choisir UN)
introduction, argument, description, pricing, clause, faq, conclusion, bio, 
temoignage, reference-technique, methodology, engagement, cas-usage

## Audiences (choisir 1 à 3)
technique, decideur, utilisateur, juridique

## Maturity (choisir UN)
production, beta, roadmap, archive

## Entities validées (utilise les formes canoniques)
- Clients : {validated_clients}
- Products : {validated_products}
- Technologies : {validated_technologies}
- Partners : {validated_partners}
- Certifications : {validated_certifications}
- Regulations : {validated_regulations}

## Tags conceptuels validés (utilise en priorité ces valeurs)
{validated_tags}

# Règles de découpage des fragments

- size: each block body must be 30–200 words. If a section exceeds 200 words,
  split it into multiple separate blocks, each covering ONE distinct idea.
  List items may each become their own block when ≥30 words.
  Short atomic blocks (≥30 words) are valuable — don't artificially merge them.
  Never bundle unrelated ideas into one block.

- coherence: each block must express ONE coherent idea that can stand alone.
  A reader should understand the block without context from other blocks.
  Avoid references like "as mentioned above" or "see next section".

# Règles de classification

1. Pour subject, function, type, maturity : choisir UNIQUEMENT dans le référentiel
2. Pour les entities : utiliser les formes canoniques du référentiel
3. Si tu identifies une entity ou un tag qui n'existe PAS dans le référentiel :
   - Tu peux le proposer en le préfixant par "NEW:"
   - Exemple: "NEW:edge-computing" pour un tag, "NEW:Kotlin" pour une technology
4. Privilégier toujours les valeurs existantes aux nouvelles propositions
5. Pour confidence : être conservateur. Score 0.95+ uniquement si totalement certain.

# Output JSON

[
  {
    "title": "titre court et descriptif du fragment",
    "body": "contenu du fragment, 30-200 mots, une idée cohérente",
    "subject": "twake-mail" | etc.,
    "function": "technical" | etc.,
    "type": "argument" | etc.,
    "audience": ["technique", "decideur"],
    "maturity": "production",
    "lang": "fr" | "en",
    "entities": {
      "clients": ["CNB"],
      "products": ["Twake Mail"],
      "technologies": ["Apache James", "JMAP"],
      "partners": [],
      "certifications": ["SecNumCloud"],
      "regulations": []
    },
    "tags": ["open-source", "sovereignty"],
    "new_proposals": {
      "tags": ["NEW:edge-computing"],
      "entities": {"technologies": ["NEW:Kotlin"]}
    },
    "confidence": 0.85
  }
]
`;
```

### Effort estimé pour ce chantier

- Rédaction et test du prompt : 2h
- Modification du code TypeScript pour parser la nouvelle structure : 1h
- Tests avec différents documents : 1h

**Total : ~4h** pour le prompt + structure de sortie.

---

## 4. Taux de confiance : signaux qualitatifs

### 4.1 Diagnostic complet : pourquoi la confiance actuelle est cassée

#### Constat empirique

Le taux de confiance actuel est **systématiquement faussé** :

- Score affiché toujours élevé (80-95%) même quand la classification est mauvaise
- **Bug spécifique observé** : pour des doublons exacts, le score n'est PAS 100% comme il devrait l'être. Les doublons sont détectés mais le score de confiance reste autour de 80-90% au lieu de 1.0 (100%)
- Le slider "minimum confidence" en UI ne fait pas son travail filtrant

#### Trois causes racines identifiées

Après debugging approfondi du code actuel, **3 bugs distincts** se cumulent. Il est crucial de les distinguer parce qu'ils se corrigent à des endroits différents.

##### Cause 1 (principale) — Le prompt ancre le LLM sur 0.85

Dans `llm-client.ts:224`, l'exemple JSON du prompt montre :

```json
"confidence": 0.85
```

**Aucune instruction sur comment utiliser l'échelle**. Sans calibration, le LLM colle à cet ancre et sort systématiquement 0.80-0.95.

Le plan initial mentionnait "Score 0.95+ uniquement si totalement certain" mais cette instruction n'a jamais été ajoutée au vrai prompt.

**Validé empiriquement** : ajout de la guidance de calibration dans le prompt → aucun effet. Mistral-small-3.2-24b sort 0.85-0.95 malgré l'instruction. Approche abandonnée.

##### Cause 2 — Le filtre `min_confidence` ne filtre rien

Dans `harvester-service.ts:247-275`, `minConfidence` est utilisé **uniquement pour incrémenter un compteur de stats** :

```typescript
// Compte stats uniquement
if (blocks[j].confidence < minConfidence) lowConfidenceCount++;

// Mais TOUS les blocs sont insérés malgré tout
await this.db.insert(harvestCandidates).values(blocks.map(...));
```

Le slider en UI envoie bien la valeur au backend, mais **aucun bloc n'est réellement exclu**. Donc le filtre n'a aucun effet visible même si les scores variaient.

##### Cause 3 — Détection de doublons silencieusement désactivée

Dans `_runPipeline()` lignes 232-239, la détection Milvus est dans un `try/catch` qui swallow l'erreur si Milvus est off (ce qui est le défaut : `FRAGMINT_MILVUS_ENABLED=false`).

**Résultat** : `dupeChecks` est toujours `null` pour tous les blocs, et `duplicate_score` jamais renseigné. Le bug "doublons exacts pas à 1.0" vient de là.

#### Diagnostic du problème de calibration générale (au-delà des 3 bugs)

Les LLM sont **notoirement mauvais à estimer leur propre confiance**. Un LLM dit "95% sûr" même quand il se trompe complètement. C'est un problème connu en LLM eval, terme technique : **mauvaise calibration**.

La recherche (Amazon Science 2024, Langfuse, ECE studies 2025-2026) documente que :

- Les Expected Calibration Errors des LLM dépassent largement les seuils acceptables (0.10-0.42)
- Les distributions de confiance se concentrent autour de 80-100% au lieu d'être uniformes
- C'est valable pour tous les modèles testés, y compris GPT-4o, Claude, Mistral

**Donc même si on fixe les 3 bugs ci-dessus, le score de confiance LLM brut reste fondamentalement peu fiable.**

---

### 4.2 Distinction critique : deux types de confiance, deux solutions

C'est l'erreur conceptuelle la plus piégeuse dans le système actuel : **mélanger deux problèmes différents** sous le même mot "confidence".

#### Confiance "ingestion" (qualité intrinsèque)

**Question répondue** : "Ce fragment est-il bien formé et bien classifié ?"

**Contexte** : on vient d'extraire un fragment d'un document, on doit décider s'il est utilisable.

**Signaux pertinents** :
- Le subject classifié est-il cohérent avec le body ?
- Les entités attendues pour ce type sont-elles présentes ?
- Le fragment est-il un doublon ?
- Le fragment est-il bien formé (taille, cohérence sémantique) ?

**Calculable à l'ingestion sans contexte de requête.**

#### Confiance "retrieval" (pertinence contextuelle)

**Question répondue** : "Ce fragment est-il adapté à CETTE section du document ?"

**Contexte** : on compose un document, on cherche les meilleurs fragments pour une section donnée.

**Signaux pertinents** :
- Score Milvus (cosine similarity) en mode vector-only
- Score LLM judge Phase 2 en mode agentic et hybrid
- Score combiné 40/60 en mode hybrid

**Calculable uniquement avec un contexte de requête (la section à composer).**

#### Pourquoi cette distinction est critique

| Aspect | Confiance ingestion | Confiance retrieval |
|--------|---------------------|---------------------|
| Quand calculée | Au moment de l'ingestion | Au moment de la recherche |
| Stockée en DB ? | Oui (sur le fragment) | Non (transient, par requête) |
| Filtre `min_confidence` | Sans intérêt à l'ingestion | C'est ICI que ça a du sens |
| Solution | Signaux locaux + LLM-as-judge | Déjà résolu par Milvus/LLM judge Phase 2 |

**Conséquence pour l'UI** :
- Le slider "minimum confidence" actuel devrait s'appliquer **uniquement au retrieval**, pas à l'ingestion
- La page Validation montre les badges qualitatifs (cohérence subject, doublon, etc.), pas un score numérique
- La page Composition montre le score LLM judge (avec justification) sur les candidats proposés

---

### 4.3 Approches rejetées (pour mémoire)

#### Approche "fréquence metadata" — rejetée

Une approche proposée pendant l'analyse : calculer la confiance en comptant les fragments validés existants avec la même combinaison `(subject, function, type)`. Beaucoup → confiance élevée. Zéro → confiance basse.

**Pourquoi cette approche est piégeuse** :

1. **Récompense l'inertie, pénalise la nouveauté légitime** : un fragment vraiment nouveau sur un sujet peu couvert aurait mécaniquement une confiance basse, même s'il est de meilleure qualité que les fragments existants
2. **Bootstrap impossible** : sur les 50 premiers fragments ingérés, tout est rare donc tout est saturé à un score bas, le filtre n'apporte aucune info
3. **Mauvaise interprétation du "class prior calibration"** : le vrai class prior calibration (arXiv 2109.05263) pénalise les classes ultra-fréquentes (parce qu'elles sont faciles à prédire par défaut), pas l'inverse comme proposé
4. **Confond ingestion et retrieval** : la fréquence des métadonnées dit "ce pattern est commun", pas "ce fragment est de qualité"

**Décision** : ne pas implémenter cette approche.

#### Approche "score auto-évalué LLM amélioré" — rejetée

Modifier le prompt pour demander au LLM d'être plus conservateur (ajouter "Score 0.95+ uniquement si totalement certain", forcer une distribution).

**Pourquoi insuffisant** :

1. La recherche est claire : la calibration verbalisée par le LLM reste mauvaise même avec un meilleur prompt
2. Les LLM montrent une overconfidence systématique liée à leur training, pas au prompt
3. Même les techniques avancées (chain-of-thought, self-consistency) donnent des estimations overconfident
4. **Validé empiriquement sur ce projet** : guidance de calibration ajoutée → résultat identique (0.85-0.95), aucun effet mesurable

**Décision** : ne plus dépendre du score auto-évalué LLM brut. Le score peut être conservé pour le tri relatif (ordre d'affichage), pas pour le filtrage absolu.

---

### 4.4 Solution retenue : 3 niveaux selon effort/valeur

L'approche est structurée en **3 niveaux indépendants**, à implémenter dans l'ordre selon le budget temps disponible.

#### Niveau 1 — Fix immédiat (1h) : ne plus mentir à l'utilisateur

**Objectif** : arrêter d'afficher un score qui ne veut rien dire, sans pour autant tout casser.

**Actions** :

1. **Fixer le bug doublons exacts** (critique) :

```typescript
// Dans harvester-service.ts, ajouter cette détection AVANT la détection Milvus
function normalizeForComparison(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}
```

**Périmètre de comparaison décidé** : comparer contre tous les fragments en DB avec `quality IN ('reviewed', 'approved')`. Ne pas comparer contre les `draft` (pas encore validés, non fiables). Ne pas se limiter au batch courant (qui ne couvre que ~10% des cas réels de doublons).

**Optimisation** : filtrer en SQL par `type = block.type` avant le string match pour éviter de scanner toute la DB. Sur 200 fragments, instantané.

**Implémentation** : lors de `_runPipeline`, charger en début de job tous les fragments `reviewed/approved` (filtrés par `collection_slug` si set). Pour chaque block, vérifier si `normalizeForComparison(block.body.slice(0, 200))` correspond au `body_excerpt` normalisé d'un fragment existant du même type. Si match → `duplicate_of = fragment.id`, `duplicate_score = 1.0`.

Cette détection s'exécute **toujours**, indépendamment de Milvus. Score 1.0 garanti sur match exact.

2. **Supprimer le slider `min_confidence` en page Ingestion** :

**Décision** : supprimer entièrement. Pas de filtrage, tout passe en queue de validation. L'humain trie via les signaux qualitatifs (Niveau 2) et le LLM-as-judge (Niveau 3). Un fragment à confiance LLM basse n'est pas forcément mauvais — le LLM sur-estime systématiquement donc l'échelle n'est pas interprétable.

**Note** : le slider en page **Composition** reste intact — c'est le score de retrieval (pertinence contextuelle), pas le score d'ingestion. Cf. section 4.2.

**Scope** : retirer le param `min_confidence` de l'API POST `/harvest`, du hook `useStartHarvest`, et du state `harvest.tsx`. La colonne `min_confidence` en DB reste (compatibilité ascendante avec les jobs existants) mais est fixée à `0` côté serveur.

3. **Remplacer l'affichage du score "85%" par un badge statut doublon** :

**Décision Niveau 1** : afficher uniquement le statut doublon (pas les 3 badges qualitatifs qui appartiennent au Niveau 2). Dans `CandidateCard` et `CandidateDetailSheet`, remplacer le badge `{confidence}%` par :
- badge amber `Doublon` si `duplicate_of !== null`
- badge muted `OK` si pas de doublon détecté

**Pourquoi pas le score LLM même en petit** : afficher "LLM score" même avec un label "tri uniquement" créerait de la confusion ("c'est quoi cette valeur, dois-je m'y fier ?"). Le score LLM en DB sert UNIQUEMENT au tri interne de la liste, jamais affiché à l'utilisateur.

Les 3 badges qualitatifs complets (`[OK] Subject`, `[OK] Doublon`, `[INFO] Entités`) sont l'objectif du Niveau 2.

4. **Conserver le score numérique en DB** pour le tri relatif uniquement — les fragments avec score LLM plus élevé apparaissent en premier dans la liste de validation. Jamais affiché comme valeur de vérité.

**Bénéfice immédiat** : on arrête de mentir. Le badge "Doublon" sur un fragment dupliqué exact est plus utile qu'un score "87%" qui ne varie jamais.

**Effort** : 1h. Fait gagner toute la suite.

#### Niveau 2 — Signaux locaux (3-4h) : vrai diagnostic qualitatif

**Objectif** : remplacer le score numérique par 4 signaux qualitatifs concrets, déterministes, calculables localement.

##### Signal 1 : Cohérence subject ↔ body

Vérifier que le subject classifié est effectivement mentionné dans le body via une lookup table de mots-clés.

```typescript
function checkSubjectCoherence(fragment: Fragment): CoherenceFlag {
  const subjectKeywords = SUBJECT_KEYWORDS[fragment.subject];
  const bodyLower = fragment.body.toLowerCase();
  const matches = subjectKeywords.filter((kw) => bodyLower.includes(kw.toLowerCase()));

  if (matches.length === 0) {
    return {
      type: 'subject_coherence',
      level: 'warning',
      message: `Subject "${fragment.subject}" not explicitly mentioned in body`,
    };
  }
  return {
    type: 'subject_coherence',
    level: 'ok',
    message: `Subject keywords found: ${matches.join(', ')}`,
  };
}

const SUBJECT_KEYWORDS: Record<string, string[]> = {
  'twake-mail': ['twake mail', 'twake', 'messagerie', 'apache james', 'jmap', 'mail'],
  'twake-calendar': ['twake calendar', 'agenda', 'calendar', 'caldav'],
  'twake-drive': ['twake drive', 'drive', 'partage de fichiers'],
  'twake-chat': ['twake chat', 'matrix', 'chat', 'messagerie instantanée'],
  linshare: ['linshare', 'partage sécurisé', 'fichiers volumineux'],
  lincloud: ['lincloud', 'cloud souverain'],
  linto: ['linto', 'voix', 'assistant'],
  openrag: ['openrag', 'rag', 'retrieval'],
  'linagora-corp': ['linagora', 'notre société', 'notre entreprise'],
};
```

**Niveau émis** : `ok` si match trouvé, `warning` sinon.

##### Signal 2 : Couverture des entités attendues

Pour certaines combinaisons `subject + function`, on s'attend à trouver certaines entités. Leur absence est suspecte.

```typescript
function checkEntityCoverage(fragment: Fragment): CoherenceFlag {
  const expectations: Record<string, string[]> = {
    technical: ['technologies', 'products'],
    commercial: ['products'],
    reference: ['clients'],
    legal: ['regulations', 'certifications'],
  };

  const expected = expectations[fragment.function] || [];
  const missing = expected.filter(
    (type) => !fragment.entities[type] || fragment.entities[type].length === 0,
  );

  if (missing.length > 0) {
    return {
      type: 'entity_coverage',
      level: 'warning',
      message: `Expected entities not found for function "${fragment.function}": ${missing.join(', ')}`,
    };
  }
  return {
    type: 'entity_coverage',
    level: 'ok',
    message: `Expected entities present`,
  };
}
```

**Niveau émis** : `ok` si toutes les entités attendues sont présentes, `warning` sinon.

##### Signal 3 : Doublons (exact + near)

Le fix doublons du Niveau 1, plus la détection near-duplicates si Milvus est actif.

```typescript
function checkDuplicates(
  fragment: Fragment,
  existingFragments: Fragment[],
  milvusEnabled: boolean,
): CoherenceFlag {
  // Always: exact match
  const exactDup = detectExactDuplicate(fragment, existingFragments);
  if (exactDup) {
    return {
      type: 'duplicate_check',
      level: 'error',
      message: `Exact duplicate of ${exactDup.existing_id} (score 1.0)`,
    };
  }

  // If Milvus enabled: near duplicate via Jaccard or cosine
  if (milvusEnabled) {
    const nearDup = detectNearDuplicate(fragment, existingFragments);
    if (nearDup) {
      return {
        type: 'duplicate_check',
        level: 'warning',
        message: `Near duplicate of ${nearDup.existing_id} (score ${nearDup.similarity.toFixed(2)})`,
      };
    }
  }

  return { type: 'duplicate_check', level: 'ok', message: 'No duplicates detected' };
}
```

**Niveau émis** : `error` si exact, `warning` si near, `ok` sinon.

##### Signal 4 : Distance au prototype de catégorie (si Milvus actif)

Pour chaque subject, calculer un embedding prototype (moyenne des embeddings des fragments validés). Un nouveau fragment trop distant est suspect.

```typescript
async function checkPrototypeDistance(fragment: Fragment): Promise<CoherenceFlag> {
  if (!process.env.FRAGMINT_MILVUS_ENABLED) {
    return { type: 'prototype_distance', level: 'info', message: 'Milvus disabled, skipping' };
  }

  const prototype = await getSubjectPrototype(fragment.subject);
  if (!prototype) {
    return { type: 'prototype_distance', level: 'info', message: 'No prototype available yet (bootstrap)' };
  }

  const fragmentEmbedding = await embed(fragment.body);
  const distance = cosineDistance(fragmentEmbedding, prototype);
  const avgDistance = await getAvgDistanceForSubject(fragment.subject);

  if (distance > avgDistance * 1.5) {
    return {
      type: 'prototype_distance',
      level: 'warning',
      message: `Atypical for ${fragment.subject} (distance ${distance.toFixed(2)} vs avg ${avgDistance.toFixed(2)})`,
    };
  }
  return { type: 'prototype_distance', level: 'ok', message: 'Typical for category' };
}
```

**Niveau émis** : `ok` si proche du prototype, `warning` si atypique, `info` si bootstrap ou Milvus off.

#### Stockage en DB

Ces signaux ne remplacent **pas** le score numérique en DB (gardé pour tri relatif). Ils s'ajoutent comme un champ JSON :

```sql
ALTER TABLE harvest_candidates ADD COLUMN quality_signals TEXT;
-- JSON array of CoherenceFlag objects
```

Type TypeScript :

```typescript
interface CoherenceFlag {
  type: 'subject_coherence' | 'entity_coverage' | 'duplicate_check' | 'prototype_distance';
  level: 'ok' | 'warning' | 'error' | 'info';
  message: string;
}

interface HarvestCandidate {
  // ... existing fields
  quality_signals: CoherenceFlag[];
}
```

#### Affichage en UI

Page Validation, pour chaque fragment :

```
[Fragment Title] [twake-mail / commercial / argument]

Body: "..."

Signaux qualitatifs :
✓ Subject mentionné (5 fois)
✓ Entités attendues présentes  
⚠ Atypique pour twake-mail (distance 0.42 vs 0.28)
✓ Pas de doublon

[Accepter] [Rejeter] [Éditer]
```

**Pas de score numérique unique**. Les flags sont indépendants.

#### Pourquoi pas un score agrégé ?

Tentation : agréger les 4 signaux en un score 0-1 pour avoir un seul nombre.

**Pourquoi on ne le fait pas** :
1. Le score agrégé masque l'info utile (lequel des signaux pose problème ?)
2. Les poids (30%, 20%, 20%, 30% par exemple) sont arbitraires
3. L'humain en validation veut savoir QUOI ne va pas, pas un score
4. Pour le tri relatif, on garde le score numérique brut LLM (qui sert juste à ordonner, pas à filtrer)

**Décision** : afficher les flags séparément, pas de score agrégé.

#### Tri en page Validation

Pour ordonner les candidats dans la liste, utiliser une logique simple basée sur les flags :

```typescript
function sortKey(candidate: HarvestCandidate): number {
  const flags = candidate.quality_signals;
  
  // Errors first (need immediate attention)
  const hasError = flags.some(f => f.level === 'error');
  if (hasError) return -1000;
  
  // Then warnings
  const warningCount = flags.filter(f => f.level === 'warning').length;
  if (warningCount > 0) return -warningCount;
  
  // Clean fragments last (already OK, lower priority for review)
  return 0;
}
```

Logique : les fragments problématiques apparaissent en premier (pour validation prioritaire), les fragments OK ensuite.

**Effort niveau 2** : 3-4h (signaux : 2h, migration DB + sérialisation : 30min, UI : 1h, tests : 30min)

---

### 4.5 Niveau 3 — LLM-as-judge avec rubrique (6-8h, optionnel)

**Objectif** : pour les cas vraiment douteux (signaux locaux donnent warnings), utiliser un second passage LLM avec une rubrique structurée pour évaluer la qualité intrinsèque.

#### Quand déclencher

**Pas systématiquement**. Le LLM-as-judge coûte ~1500 tokens (≈1 centime) par fragment.

**Stratégie hybride** :

```typescript
async function shouldRunQualityJudge(candidate: HarvestCandidate): Promise<boolean> {
  const flags = candidate.quality_signals;
  
  // Skip if everything is OK (no need)
  const hasWarnings = flags.some(f => f.level === 'warning' || f.level === 'error');
  if (!hasWarnings) return false;
  
  // Skip if exact duplicate (already invalid)
  const isDuplicate = flags.some(f => 
    f.type === 'duplicate_check' && f.level === 'error'
  );
  if (isDuplicate) return false;
  
  // Run judge on the ambiguous middle: warnings but not exact duplicates
  return true;
}
```

Concrètement : sur 200 fragments, environ 30-50 auront des warnings et déclencheront le judge. Coût : ~50 centimes total.

#### Rubrique structurée (3 dimensions pass/partial/fail)

Inspirée du pattern Webflow (Towards Data Science, August 2025) et du framework G-Eval.

Boolean ou ternary scoring est **plus fiable** que les échelles fines (AWS Bedrock guide, Confident AI 2026) : réduit la variabilité, force des décisions discrètes, plus facile à auditer.

```typescript
const QUALITY_JUDGE_PROMPT = `
You are evaluating the quality of a content fragment extracted from a document.

# Fragment to evaluate
Title: {fragment.title}
Body: {fragment.body}

# Metadata assigned by ingestion
Subject: {fragment.subject} / Function: {fragment.function} / Type: {fragment.type}
Audience: {fragment.audience} / Entities: {fragment.entities}

# Quality signals already detected
{quality_signals_summary}

# Your task
Evaluate along 3 dimensions. For each: verdict "pass" | "partial" | "fail" + 1-sentence reason.

## Dimension 1: Reusability
Can this fragment be inserted as-is in another proposal without requiring external context?
PASS: stands alone, no "as mentioned above", no dangling pronouns
FAIL: starts with "Furthermore/Moreover", refers to "previous section", undefined entities

## Dimension 2: Semantic Coherence
Does the fragment express ONE coherent idea, readable in isolation?
PASS: single topic, logical flow
FAIL: multiple distinct ideas bundled, abrupt topic shifts

## Dimension 3: Classification Accuracy
Do the assigned metadata (subject, function, type) match the actual content?
PASS: subject is actual topic, function/type align
FAIL: subject ≠ body topic, function or type mismatch

# Output JSON only:
{
  "reusability": { "verdict": "pass"|"partial"|"fail", "reason": "..." },
  "semantic_coherence": { "verdict": "pass"|"partial"|"fail", "reason": "..." },
  "classification_accuracy": { "verdict": "pass"|"partial"|"fail", "reason": "..." },
  "overall_recommendation": "accept"|"review"|"reject",
  "overall_reason": "1-2 sentences"
}
`;
```

**Effort niveau 3** : 6-7h (prompt + few-shot : 1h, implémentation : 2h, migration DB + UI : 2h, tests : 2h)

---

### 4.6 Sur le score numérique LLM brut : que faire ?

Le score `confidence` actuel (le float 0.85 retourné par le LLM) reste dans le schéma.

**Décisions** :

1. **Ne plus l'afficher en UI** comme une valeur de vérité (pas de "87%" en gros)
2. **Conserver en DB** pour permettre le tri relatif et les analyses futures
3. **Supprimer du prompt l'exemple "0.85"** : remplacer par une instruction explicite :

```
"confidence": <float 0.0-1.0, where:
  - 0.95+ = highly certain, all metadata correct without ambiguity
  - 0.70-0.94 = confident but some ambiguity
  - 0.50-0.69 = uncertain, requires human review
  - <0.50 = very uncertain, likely misclassified

Default toward lower values when unsure. Avoid clustering around 0.85.>
```

Cela ne corrigera pas magiquement la calibration LLM (validé empiriquement), mais évite l'ancrage explicite sur 0.85.

---

### 4.7 Sur la confiance "retrieval" (composition de documents)

C'est **un problème déjà résolu** dans le plan actuel via les 3 modes de retrieval :

| Mode | Score utilisé pour le retrieval |
|------|--------------------------------|
| vector-only | Score Milvus (cosine similarity) |
| agentic-only | Score LLM judge Phase 2 (0-10 avec justification) |
| hybrid | Score combiné 40% vector + 60% LLM |

**Implémentation** :
- En page Validation : slider supprimé ou désactivé (les flags qualitatifs guident)
- En page Composition : slider conservé, applique le seuil sur le score de retrieval

C'est la **vraie séparation** des deux problèmes.

---

### 4.8 Implémentation prioritaire pour la mission

| Budget | Actions | Impact |
|--------|---------|--------|
| **1h** | Fix bug doublons exacts + désactiver slider Validation + remplacer "85%" par badges | Arrêter de mentir |
| **4h** | + Niveau 2 : 4 signaux locaux | Diagnostic concret pour la démo |
| **1 jour** | + Niveau 3 : LLM-as-judge rubrique sur fragments warning | Maturité système, argument différenciateur |

---

### 4.9 Discours pour la démo Maudet

> "Une chose qu'on a améliorée : les scores de confiance auto-évalués par le LLM sont notoirement peu fiables — c'est documenté dans la littérature, les LLM ont un biais d'overconfidence systématique. On les a remplacés par des signaux qualitatifs concrets — cohérence du subject avec le contenu, couverture des entités attendues, détection de doublons exacts, distance au prototype de la catégorie. C'est plus précis et plus utile pour l'humain qui valide."

Si Niveau 3 implémenté, ajouter :

> "Sur les cas vraiment douteux, on déclenche un second passage LLM qui évalue la qualité du fragment selon 3 dimensions structurées : réutilisabilité, cohérence sémantique, justesse de la classification. C'est le pattern LLM-as-judge avec rubrique, standard de l'industrie en 2026."

---

### 4.10 Critères de succès

- [ ] Aucun fragment ne s'affiche avec un score numérique seul
- [ ] Les fragments dupliqués exacts sont systématiquement détectés (score 1.0)
- [ ] Les flags qualitatifs (4 signaux) apparaissent pour chaque fragment
- [ ] Le tri en page Validation met les fragments warning/error en premier
- [ ] Le slider min_confidence n'apparaît plus en page Validation
- [ ] En page Composition, le slider min_confidence fonctionne sur le score de retrieval

**Métrique de validation** : sur le corpus de test (cas IRA), un fragment volontairement mal classifié (ex: pricing classé en "technical") doit déclencher au moins 2 warnings sur les 4 signaux.

---

## 5. Workflow de test sur le cas IRA

### Documents disponibles dans `mission/cas-ira/`

1. `01_-_Expression_de_besoin_Messagerie__P18__-_V2.docx/.md` : **cahier des charges client** (369 lignes)
2. `02_-_plan_cible_de_taille__et_retravaille_.md` : **plan élaboré à la main** (73 lignes) — référence pour validation
3. `03_-_fragments_se_lectionne_s_a__la_main_pour_IRA.docx` : **fragments Linagora pré-existants** sélectionnés manuellement
4. `04_-_md_obtenu_a__transformer_en_docx.md` : doc final markdown (503 lignes) — référence pour validation
5. `05_-_Proposition_IRA_finale.docx` : document final livré

### Workflow de test après Phase 1

#### Étape 1 — Ré-ingestion du corpus

Une fois les chantiers Phase 1 terminés, ré-ingérer :

- Le fichier 03 (fragments sélectionnés à la main)
- Idéalement 2-4 autres docs Linagora pour enrichir le corpus

#### Étape 2 — Validation des fragments

Aller dans Validation, vérifier que :

- Les fragments font 30-200 mots (cible 100)
- Les métadonnées sont remplies (subject, function, type, entities, audience, maturity, tags)
- Les signaux qualitatifs sont cohérents (pas de warnings non justifiés)
- Les doublons ont bien un score 1.0 (si fichier 03 contient des fragments répétés)

#### Étape 3 — Validation admin des émergents

Aller dans la nouvelle UI admin :

- Valider/Renommer/Rejeter les nouveaux tags émergents
- Valider/Renommer/Fusionner les nouvelles entités émergentes
- Idéalement : aucun nouveau subject (référentiel devrait être stable)

#### Étape 4 — Test de génération de plan

Créer un nouveau plan :

- Title : "Proposition IRA - Messagerie collaborative"
- Specifications : coller le contenu du fichier 01 (cahier des charges)

Comparer le plan généré avec le fichier 02 :

- Similarité structurelle : viser >85% sections communes
- Sections principales (synthèse, contexte, solution, archi, etc.) : doivent être présentes

Si plan généré médiocre, améliorer le **prompt système backend** (`plan-generator.ts`), pas le prompt utilisateur.

#### Étape 5 — Sélection des fragments par section

Pour chaque section du plan :

- Comparer les fragments sélectionnés avec les fragments du fichier 03 (choix manuel)
- Viser >70% de fragments communs

#### Étape 6 — Composition et comparaison finale

Composer le doc complet, comparer avec le fichier 04 :

- Similarité textuelle : viser >75%
- Structure : viser >85%

### Métriques de validation globale

| Étape                | Métrique                                | Objectif           |
| -------------------- | --------------------------------------- | ------------------ |
| Ingestion fichier 03 | Nombre de fragments extraits            | 15-30 par doc      |
| Chunking             | % fragments dans 30-200 mots            | >90%               |
| Classification       | % fragments bien classés                | >85% post-curation |
| Signaux qualitatifs  | % fragments sans warnings               | >75%               |
| Plan généré          | Similarité structurelle avec fichier 02 | >85%               |
| Sélection fragments  | % fragments communs avec choix manuel   | >70%               |
| Composition finale   | Similarité textuelle avec fichier 04    | >75%               |
| Temps total          | De l'upload au DOCX final               | <20 min            |

### Punchline démo

"L'auteur a passé 6 heures sur ce document. Fragmint le fait en 20 minutes avec la même qualité, en gardant la validation humaine à chaque étape critique."

---

## 6. Stratégie d'ordonnancement détaillée

### Pourquoi pas en séquentiel

Faire d'abord les métadonnées puis le chunking = **modifier 2 fois le prompt segmentAndClassify** (qui est le truc le plus délicat). Faire d'abord le chunking puis les métadonnées = **idem**.

Les deux chantiers touchent les **mêmes fichiers** :

- `llm-client.ts` (prompt segmentAndClassify)
- `harvester-service.ts` (post-processing chunking + extraction entités)
- Schéma DB (colonnes métadonnées + tables référentiels)

### Ordre proposé pour la Phase 1

#### Lundi (J1) — Fondations DB et référentiels

**Matin (3h)** :

- Migrations SQL pour le schéma enrichi
- Seed des référentiels initiaux (subjects, entities, tags)
- Endpoint admin GET/POST pour les propositions

**Après-midi (3h)** :

- UI admin "Validation Métadonnées" (peut être généré par Claude Design)
- Tests de base sur les endpoints

#### Mardi (J2) — Prompt unifié et post-processing

**Matin (3h)** :

- Rédaction du nouveau prompt segmentAndClassify (cf section 3 de ce doc)
- Adaptation du parsing TypeScript pour la nouvelle structure

**Après-midi (3h)** :

- Implémentation `splitOversizedBlock` et `mergeUndersizedBlocks` dans harvester-service.ts
- Implémentation `reclassifySplitBlocks`

#### Mercredi (J3) — Fix taux de confiance et tests

**Matin (3h)** :

- Fix du bug doublons exacts (score 1.0 sur match exact)
- Implémentation Signaux 1 et 2 (cohérence subject + couverture entités)
- Mise à jour UI fragment detail

**Après-midi (3h)** :

- Ré-ingestion du corpus de test (fichier 03 + autres docs)
- Validation des fragments
- Validation admin des émergents
- Premier test plan IRA

#### Jeudi (J4) — Curation manuelle et fine-tuning

- Identifier les fragments mal classés post-ingestion
- Script de curation manuelle backend (cf section 16 du doc principal)
- Ajustement des few-shot examples dans le prompt
- Re-ingestion si nécessaire

### Marge de sécurité

Si la Phase 1 prend plus de 3-4 jours, il faut **réduire le scope de la Phase 2** (architecture 3 modes). Ne pas hésiter à descoper :

- Skills OpenCode (peut être démontré en V2)
- Knowledge graph visuel (peut être remplacé par une simple liste)
- Mode hybrid (peut être ajouté post-démo)

**Ce qui est non-négociable** :

- Mode vector-only fonctionnel (existant amélioré)
- Mode agentic-only fonctionnel (au moins basique)
- Classification fiable post-Phase 1
- Démo cas IRA convaincante

---

## 7. Discussion de fond

### Pourquoi commencer par les fondations

Plusieurs allers-retours ont confirmé que **les fondations conditionnent tout le reste** :

1. **Sans bons fragments (taille + métadonnées)** : tous les modes de retrieval donneront des résultats médiocres
2. **Sans référentiels admin** : le système accumule du bruit qui dégrade la recherche au fil du temps
3. **Sans fix du taux de confiance** : l'humain ne sait pas où porter son attention en validation
4. **Sans extraction d'entités** : pas de cross-references possibles, donc le pattern Karpathy perd de sa puissance

### Pourquoi NE PAS commencer par les modes de retrieval

Tentation initiale : faire les 3 modes (vector/agentic/hybrid) en premier pour avoir l'archi cible. Mauvaise idée parce que :

- Tester les modes sur des fragments mal foutus = on ne sait pas si le mode marche ou pas
- Devoir re-tester tous les modes après refacto métadonnées = perte de temps
- Risque de sur-engineering sur l'archi avant d'avoir validé les fondations

### Sur le combinaison de chantiers

Décision validée : **combiner chunking + métadonnées + fix confiance** en une seule passe parce que :

- Mêmes fichiers touchés → cohérence
- Une seule re-ingestion pour valider
- Un seul prompt complexe à rédiger
- Gain : 0.5-1 jour sur la mission

### Sur le rôle des métadonnées pour le LLM judge

Les métadonnées enrichies (`domain`, `function_type`, `audience`, `maturity`, `entities`, `tags`) sont utiles aux **3 modes de retrieval**, pas seulement au mode agentic.

| Mode | Usage des métadonnées |
|------|-----------------------|
| `vector-only` | Pré-filtrage SQL avant Milvus (ex: `WHERE domain='twake-mail' AND maturity!='roadmap'`) |
| `agentic-only` | Structure de l'`index.md` — le LLM navigue par subject × function, impossible sans |
| `hybrid` | Les deux : pré-filtrage SQL + contexte pour le LLM judge Phase 2 |

Pour le **LLM judge** spécifiquement, les métadonnées servent de grille d'évaluation mécanique :

- **Économie de tokens** : le LLM ne re-infère pas ce qui est déjà classifié. Il compare `fragment.domain == slot.domain` plutôt que lire le body pour deviner le sujet.
- **Consistance** : mêmes critères structurés sur tous les candidats → scores comparables.
- **Matching d'entities** : si le brief client mentionne SecNumCloud, le judge vérifie directement `fragment.entities.certifications.includes('SecNumCloud')` → gain de précision impossible à l'œil sur le body seul.
- **Filtrage rapide** : un fragment `domain: linshare` est éliminé en 1 ligne pour une section `twake-mail`, sans lire son body.
- **Cross-references** : quand le judge sélectionne un fragment avec `entities.certifications: [SecNumCloud]`, il peut remonter automatiquement les autres fragments mentionnant SecNumCloud comme candidats supplémentaires.

**Conséquence** : la Phase 1 (métadonnées) conditionne la qualité de la Phase 2 pour **tous** les modes, pas uniquement le mode agentic. Implémenter les 3 modes sur des fragments sans métadonnées enrichies = récupérer 30 candidats dont 20 hors-sujet, et demander au LLM judge de tout re-inférer depuis le body.

### Sur la stratégie LLM

Pour la Phase 1, **utiliser Claude Sonnet via OpenRouter** dès le début pour avoir des résultats fiables sur la classification enrichie. Mistral-nemo:12b risque de mal gérer la complexité du nouveau prompt (référentiels + règles taille + structure JSON riche).

### Sur les seeds et la curation initiale

L'effort de curation manuelle (1-2h) **avant la Phase 2** est un investissement rentable :

- Permet de sélectionner les meilleurs few-shot examples pour le prompt
- Stabilise les référentiels (on sait ce qui est légitime ou pas)
- Crée un corpus "or" pour benchmarker la qualité de toute amélioration future

### Lien avec le doc principal

Une fois la **Phase 1 terminée** (mercredi/jeudi semaine 1), passer à la **Partie 2** de ce document à partir de la section 4 (Architecture cible : trois modes de retrieval) pour démarrer la Phase 2.

Les fondations posées en Phase 1 permettent à toute la Phase 2 (modes retrieval, index.md Karpathy, relations explicites, supersedure, contradictions, Skills OpenCode) de bien marcher.

---

**Fin de la Partie 1.**


---

---

# PARTIE 2 — Architecture cible (Phase 2+, après Phase 1)

> **À lire après la Partie 1** — architecture des 3 modes de retrieval, index.md Karpathy, supersedure, Skills OpenCode.
>
> **État au 2026-05-26** :
> - ✅ **Piste B livrée** : 3 modes retrieval (vector-only, agentic-only, hybrid) + factory + routes admin
> - 🔜 **Toggle UI mode retrieval** : composant frontend dans le header admin (spec ci-dessous, §4bis)
> - 🔜 **Piste A — must-have** : skill `/fragmint` Claude Code/OpenCode (cache index local, workflow plan→fragments→export)
> - 🔜 **Multi-agent self-consistency — must-have** : 2 judges parallèles dans `AgenticRetriever`, arbitrage si désaccord
> - ⏸️ **Différés post-mission** : relations explicites, contradictions, knowledge graph

---

# Contexte d'évolution Fragmint — Post-réunion Paul

> **Document de contexte stratégique et technique** pour Claude Code.
> Consolide l'ensemble des réflexions, décisions, pistes techniques et points ouverts
> issus de la réunion avec Paul (CTO Linagora) et des sessions de design qui ont suivi.
>
> **Date de consolidation** : 22 mai 2026 (V2 — intègre décisions notes Paul approfondies)
> **Objectif** : refondre Fragmint pour la démo du 12 juin 2026 devant Michel-Marie Maudet (CEO Linagora).
> **Budget temps** : 20 jours dev + weekends, Juliette + Paul.

---

## Table des matières

1. [Contexte mission et état actuel](#1-contexte-mission-et-état-actuel)
2. [Décisions stratégiques issues de la réunion Paul](#2-décisions-stratégiques-issues-de-la-réunion-paul)
3. [Référence Karpathy / LLM Wiki](#3-référence-karpathy--llm-wiki)
4. [Architecture cible : trois modes de retrieval avec feature flag](#4-architecture-cible--trois-modes-de-retrieval-avec-feature-flag)
5. [Refonte des métadonnées : 7 axes enrichis](#5-refonte-des-métadonnées--7-axes-enrichis)
6. [Classification hiérarchique en 3 étapes](#6-classification-hiérarchique-en-3-étapes)
7. [Génération du fragments-index.md](#7-génération-du-fragments-indexmd)
8. [Recherche en 2 phases (mode agentic et hybrid)](#8-recherche-en-2-phases-mode-agentic-et-hybrid)
9. [LLM as judge : prompts et architecture](#9-llm-as-judge--prompts-et-architecture)
10. [Cache LRU et invalidation](#10-cache-lru-et-invalidation)
11. [Relations entre fragments (implicites et explicites)](#11-relations-entre-fragments-implicites-et-explicites)
11bis. [Knowledge Graph : visualisation interactive du corpus](#11bis-knowledge-graph--visualisation-interactive-du-corpus)
12. [Auto-supersedure des fragments](#12-auto-supersedure-des-fragments)
13. [Détection sémantique de contradictions](#13-détection-sémantique-de-contradictions)
14. [Skills OpenCode (3 skills minimum viable)](#14-skills-opencode-3-skills-minimum-viable)
15. [Migration LLM via OpenRouter](#15-migration-llm-via-openrouter)
16. [Curation manuelle backend du corpus](#16-curation-manuelle-backend-du-corpus)
17. [UI admin via Claude Design (artifacts React)](#17-ui-admin-via-claude-design-artifacts-react)
18. [Cas de validation réel : marché public IRA](#18-cas-de-validation-réel--marché-public-ira)
19. [Schéma de base de données cible](#19-schéma-de-base-de-données-cible)
20. [Prompts complets pour chaque opération LLM](#20-prompts-complets-pour-chaque-opération-llm)
21. [Stratégie démo finale 12 juin](#21-stratégie-démo-finale-12-juin)
22. [Risques, mitigations et plan B](#22-risques-mitigations-et-plan-b)
23. [Roadmap V2/V3 à présenter à Maudet](#23-roadmap-v2v3-à-présenter-à-maudet)
24. [Questions ouvertes à trancher](#24-questions-ouvertes-à-trancher)
25. [Workflow admin et Trust by Source](#25-workflow-admin-et-trust-by-source)

---

## 1. Contexte mission et état actuel

### Mission

Juliette est consultante chez Linagora pour 20 jours de mission, mission focalisée sur l'évolution de **Fragmint** (https://github.com/mmaudet/fragmint), système de génération de documents commerciaux par recomposition de fragments versionés. Branche de travail : `juliette/mission-stabilization`.

**Rendu fixe : 12 juin 2026**. Démo prévue devant Michel-Marie Maudet (CEO Linagora) et probablement Paul.

### Stack actuelle

- TypeScript / Node.js, React (UI), monorepo packages/server + packages/web
- SQLite pour métadonnées fragments (en `:memory:` en dev, `.fragmint.db` en prod)
- Vault Git pour stockage source des fragments (`example-vault/fragments/*.md`)
- Milvus pour vector search (avec instabilité etcd sur macOS)
- Mistral-nemo:12b via Ollama pour LLM (local, souverain)
- Docker Compose pour orchestration

### État au moment de la réunion Paul

**Acquis** :

- Workflow d'ingestion fonctionnel (DOCX → fragments)
- Workflow de validation 2 phases (draft → reviewed → approved)
- Workflow de composition (plan → fragments → drafts → assembly)
- Classification basique mais peu précise (beaucoup de `other`/`other`)
- Premier export DOCX avec template

**Bugs et limites identifiés** :

- Bug #11 : contamination de la classification harvester par les domains existants en DB
- Bug #33 : Composer lacks intent/description input pour sélection contextuelle
- Bug #35 : taxonomy harvester divergente du schéma canonique (résolu)
- Milvus crashes etcd sur Mac, instable
- JWT non persistant (résolu)
- Template DOCX corrigés (Inter+#C71F45 pour CR, Liberation Sans+#c00d2d pour Offre)
- Classification single-shot LLM produit beaucoup d'`other`/`other`
- Pas de cross-references entre fragments
- Pas de temporalité (`valid_from`/`valid_until` existent mais peu utilisés)
- Pas de détection de contradictions

### Livrables bonus livrés (hors plan initial — documentés ici pour traçabilité)

Ces 4 services ont été implémentés et intégrés dans le pipeline mais n'apparaissaient pas dans le plan initial. Ils sont documentés ici pour éviter de les ré-implémenter ou de les perdre lors des prochaines sessions.

| Service | Fichier | Rôle |
|---------|---------|------|
| **quality-judge** | `services/quality-judge.ts` | LLM-as-judge d'ingestion : évalue chaque fragment sur 3 dimensions (reusability, semantic coherence, classification accuracy). Verdict : accept/review/reject + `suggested_metadata` (corrections de type/domain/tags). Appelé dans `harvester-pipeline.ts:194` pour tous les fragments non-doublons. |
| **signal-recalc-service** | `services/signal-recalc-service.ts` | Job de recalcul des signaux qualité en batch. V1 stub : itère les IDs fragments et tique le job pour le tracking de progression. Appelé depuis l'UI admin (bouton "Recalculer signaux"). |
| **harvester-validation** | `services/harvester-validation.ts` | Logique de validation et bulk-accept extraite de `harvester-service.ts`. Gère `validate()` : commit, merge, reject des candidats ; mise à jour `harvestCandidates`, `harvestJobs`, `fragmentTags`, `entities`, `fragmentEntities`. |
| **harvester-taxonomy** | `services/harvester-taxonomy.ts` | Taxonomie seed par défaut (domains + descriptions) mergée avec les domains existants en DB au moment de l'ingestion. Définit `HARVESTER_DOMAINS` (twake, lincloud, linagora, other) + `HARVESTER_FUNCTION_TYPES` + `HARVESTER_TYPES` avec descriptions précises pour le LLM de classification. |

### Comportement des hints au harvest (référence implémentation)

Documenté ici pour ne pas perdre la logique lors des prochaines sessions.
Dernière vérification sur le code : 2026-06-02 (branch `mission-phase-2`, commit `81c7cff`).

#### Vue d'ensemble

Les hints (`UploadHints`) sont renseignés à l'upload via le champ multipart `upload_hints` (JSON), stockés dans `harvest_jobs.upload_hints`. Ils sont **doc-level** (s'appliquent au document entier), pas fragment-level. `UploadHints` a exactement deux champs : `domain?: string` et `tags?: string[]` (`schema/trust-source.ts:5`).

> ⚠️ Les hints `entities`, `function_type`, `audience`, `maturity` n'existent plus dans `UploadHints` — supprimés lors du refactor entities.

#### Règles par type de hint

| Hint | Blocs LLM | Candidats tableau |
|------|-----------|-------------------|
| `domain` | **Conditionnel** (3 gardes, voir ci-dessous) | **Inconditionnel** : `uploadHints.domain ?? existingDomains[0] ?? 'other'` (`harvest-table-extractor.ts:70`) |
| `tags` | **Body-scan forcé** : pour chaque tag hint, si le corps du bloc contient le mot-clé du tag (partie après `:` pour les tags préfixés, tag entier sinon), le tag est ajouté au bloc même si le LLM ne l'a pas proposé. Le tag est aussi injecté comme suggestion dans le prompt LLM (`llm-client.ts:140`). (`harvest-hint-processor.ts:37`) | Non applicable |

**Détail du domain override pour blocs LLM** (`harvest-hint-processor.ts:43`) — les 3 gardes :
1. Le hint domain est **absent du référentiel** (nouveau domaine que le LLM ne connaissait pas)
2. Le LLM a retourné `domain === "other"` pour ce bloc
3. Le corps du bloc contient le mot-domaine hint (sous-chaîne, lowercase)

Si le domaine est **déjà connu** dans le référentiel, le LLM l'avait dans sa liste de valeurs valides — l'override ne se déclenche jamais (le choix LLM est considéré délibéré).

#### Trust sources calculées (par fragment, par champ)

Calculé dans `computeTrustSources` (`schema/trust-source.ts:73`) après `applyUploadHintsInPlace` :

| Cas | TrustSource |
|-----|-------------|
| Pas de hint pour ce champ | `'llm-inferred'` |
| Hint présent, LLM d'accord | `'llm-confirmed'` |
| Hint présent, LLM a dévié | `'llm-deviation'` |
| Bloc dont le domain a été overridé | `'human-direct'` (patché en dur, `harvester-pipeline.ts:325`) |

Stocké dans `harvest_candidates.trust_sources_json`. **Non copié** dans le fragment à l'acceptation.

#### Post-pipeline : surfaçage en queue admin

`flushHintReferentials` (`harvest-hint-processor.ts:120`) est appelé après tous les fichiers :
- Hint `domain` nouveau → `fragmentDomains` avec `validated=0, proposedBy='harvest-hint', trustSource='human-direct'`
- Hint `tags` **utilisés par le LLM** (dans `hintTagsFound`) → `fragmentTags` avec `validated=0, status='pending', proposedBy='harvest-hint'`
- Hint tags **non utilisés par le LLM** → pas de surfaçage

#### Signaux qualitatifs

`computeQualitySignals` (`quality-signals.ts:93`) produit `subject_coherence` et `duplicate_check`. Le type `entity_coverage` est déclaré dans `CoherenceFlag` (ligne 22) mais **n'est jamais produit** par aucune fonction — type mort issu du refactor entities.

#### Fichiers clés

| Fichier | Responsabilité hints |
|---------|---------------------|
| `schema/trust-source.ts` | Type `UploadHints`, `TrustSource`, `computeTrustSources`, `determineTrustSource` |
| `harvest-hint-processor.ts` | `applyUploadHintsInPlace`, `insertNewProposals`, `flushHintReferentials` |
| `harvester-pipeline.ts` | Orchestration : passage hints → LLM → override → trust → insert candidats → flush |
| `harvest-table-extractor.ts` | Assignation directe du domain hint aux candidats tableau |
| `llm-client.ts` | `segmentAndClassify()` — injection hints dans le prompt (suggestions, pas obligations) |

#### Invariant important

`trust_sources_json` est calculé par fragment et stocké sur `harvest_candidates`, mais **n'est pas transféré** au fragment créé à l'acceptation (`harvester-validation.ts`). Il reste une métadonnée de la phase d'ingestion uniquement.

---

### Cas d'usage métier réel observé

Un rédacteur a partagé son workflow manuel actuel :

1. Lit le document source (ex: appel d'offres, cahier des charges)
2. Itère sur le document pour comprendre les besoins
3. Donne à Claude le document source + structure cible + fragments choisis à la main
4. Itère jusqu'à un document final cohérent

Ce workflow prend **plusieurs heures par document**. L'objectif de Fragmint est de réduire ce temps à **15-30 minutes** avec maintien de la qualité.

---

## 2. Décisions stratégiques issues de la réunion Paul

### Décision 1 : pivot vers une architecture agentique

**Inspiration directe** : Andrej Karpathy, gist "LLM Wiki" publié le 4 avril 2026 (https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f).

**Principe** : remplacer la recherche RAG vectorielle classique par une **table des matières structurée** que le LLM lit directement, avec recherche en 2 phases (gros grain sur métadonnées, fin grain sur contenu).

### Décision 2 : feature flag avec 3 modes (confirmé)

Initial Paul : 2 modes (vector vs agentic). Après analyse du cas IRA : **3 modes** :

| Mode           | Description                                 | Cas d'usage                          |
| -------------- | ------------------------------------------- | ------------------------------------ |
| `vector-only`  | Milvus seul (archi actuelle)                | Baseline, fallback si LLM down       |
| `agentic-only` | Pattern Karpathy pur (index.md + LLM judge) | Petit/moyen corpus, qualité maximale |
| `hybrid`       | Milvus pré-filtrage + LLM as judge re-rank  | Production réelle, scale + qualité   |

Le mode `hybrid` est positionné comme **mode recommandé** dans la démo (c'est ce que font les RAG modernes en production : LlamaIndex, LangChain).

**Décision confirmée** : on garde les 3 modes pour V1 (cf section 4 pour justification détaillée).

### Décision 3 : refonte des métadonnées

Suite à l'analyse du cas IRA, l'enrichissement des métadonnées devient une priorité :

- Split `domain` actuel en `subject` + `function` (deux axes distincts)
- Ajout d'`entities` (clients, produits, technologies, partenaires, certifications, régulations)
- Ajout d'`audience` et `maturity`
- Tags ouverts émergents (LLM peut proposer, admin valide)

### Décision 4 : Skills OpenCode comme canal d'usage secondaire

Paul voulait initialement faire la démo de la composition en CLI/OpenCode (pour la rapidité des validations en click). **Décision finale** : la démo principale reste en UI pour ne pas brouiller le message produit. Les Skills OpenCode sont présentés comme **bonus** ("voilà comment ça s'intègre dans les workflows développeurs").

**3 Skills max** :

- `/fragmint plan [brief]` : génère un plan structuré
- `/fragmint compose [plan-id]` : récupère fragments + génère drafts
- `/fragmint export [doc-id] [format]` : export final

### Décision 5 : LLM plus puissant via OpenRouter

Pour la démo, basculement sur **Claude Sonnet via OpenRouter** plutôt que mistral-nemo:12b. **Discours souverain** : à mentionner explicitement que la production utilisera **Mistral Large** (API souveraine française).

### Décision 6 : suppression Milvus en feature flag

Milvus reste disponible (utilisé par modes `vector-only` et `hybrid`), mais désactivable via env var. En mode `agentic-only`, Milvus n'est pas utilisé du tout.

### Décision 7 : extension du scope (validée après analyse approfondie)

3 features initialement sorties du scope ont été remises dedans après réflexion :

1. **Relations entre fragments** (implicites mécaniques + explicites typées)
2. **Auto-supersedure par date avec LLM as judge**
3. **Détection sémantique de contradictions**

Justification : le cas IRA révèle que ces features sont **nécessaires pour une démo crédible**, pas juste des nice-to-have. Et Paul est disponible pour aider, donc on a la bande passante.

### Décision 8 : multi-agent self-consistency pour le LLM judge — **must-have V1** (mis à jour CR Paul 26 mai)

Pour chaque section d'un plan, lancer **2 LLM judges en parallèle** avec des prompts légèrement différents :

- Agent A : pertinence factuelle du fragment pour la section
- Agent B : cohérence stylistique et tonale
- Si |score_A - score_B| < 0.2 → score final = moyenne
- Si désaccord → 3e appel arbitre (ou garder le plus conservateur)
- Parallélisation : dès qu'une vérification de section est terminée, l'autre agent revalide immédiatement

Feature flag : `FRAGMINT_MULTI_AGENT=true/false` (défaut `false`, activé pour démo max qualité).

> **Mis à jour 2026-05-26** : Paul CR confirme explicitement ce pattern comme must-have V1, pas V2. Implémentation dans `AgenticRetriever.searchForSection()` — remplace le `judgeFragment()` unique par 2 appels parallèles.

### Décision 9 : simplification temporelle

Décision V1 : **supprimer `valid_from` / `valid_until`** (redondants avec la supersedure et peu utilisés en pratique). On garde :

- `maturity` : stade de développement du sujet
- `superseded_by` / `supersedes` : mécanisme de remplacement par événement
- `created_at` / `updated_at` : dates système

Détails complets en section 5 (axe 6 maturity).

---

## 3. Référence Karpathy / LLM Wiki

### Idée centrale du gist

> "The LLM **incrementally builds and maintains a persistent wiki** — a structured, interlinked collection of markdown files that sits between you and the raw sources. When you add a new source, the LLM doesn't just index it for later retrieval. It reads it, extracts the key information, and integrates it into the existing wiki — updating entity pages, revising topic summaries, noting where new data contradicts old claims, strengthening or challenging the evolving synthesis."

### Trois couches Karpathy

1. **Raw sources** : documents bruts, immutables. Pour Fragmint : DOCX uploadés.
2. **The wiki** : fichiers markdown LLM-generated. Pour Fragmint : les fragments `.md` validés + `fragments-index.md`.
3. **The schema** : fichier de config (CLAUDE.md / AGENTS.md) qui dit au LLM comment maintenir le wiki. Pour Fragmint : un `FRAGMINT.md` à créer décrivant les conventions.

### Trois opérations Karpathy

1. **Ingest** : LLM lit la source, discute des takeaways, met à jour 8-15 pages du wiki.
2. **Query** : LLM lit l'index, drill-down sur les pages pertinentes, synthétise.
3. **Lint** : LLM périodiquement vérifie la cohérence (contradictions, stale, orphans, gaps).

### Adaptation à Fragmint

Fragmint diffère du wiki Karpathy classique sur ces points :

- Les "pages" sont des **fragments réutilisables**, pas des articles de synthèse
- Le but est la **réassemblage modulaire**, pas la **synthèse compounding**
- Pas de cross-références fortes natives (mais on en ajoute via `relates_to`)
- Validation humaine plus présente (workflow review/approve existant)

### Implémentations communautaires citées (commentaires du gist)

1. **theafh/ai-modules** (skills OpenCode) : SHA256 sur sources, détection drift, cleanup agent
2. **wikova.com** (jianghailong-xy) : 3 buckets sources/wiki/agents, self-healing loop
3. **nohmitaina** (nowissan) : DDD event-storming, "Dream cycle" pour consolidation
4. **Origin** (7xuanlu) : distill loop avec absorption et refresh stale pages
5. **TrueHOOHA/LLM-Wiki-Skilled** : "agent skills to enforce workflow rigidity"

**Problèmes connus identifiés par nowissan** :

1. **Identity** : même concept extrait sous des noms différents (duplicates)
2. **Level** : pas de hiérarchie entre concepts importants et tactiques
3. **Relationship** : types de liens entre pages perdus (similar/contains/contradicts)

### Limites enterprise (critique communautaire)

> "When the same company needs a compliance assistant for 200 analysts querying across 50,000 documents in five systems with role-based access, the LLM wiki breaks down immediately: index overflow, no access control layer, and write conflicts across simultaneous users."

**Implication pour Fragmint** : le mode `agentic-only` est pertinent jusqu'à ~500 fragments. Au-delà, le mode `hybrid` reprend la main.

---

## 4. Architecture cible : trois modes de retrieval avec feature flag

### Variable de configuration

```env
FRAGMINT_RETRIEVAL_MODE=hybrid  # vector-only | agentic-only | hybrid
```

Toggle en runtime via endpoint admin `/v1/retrieval/mode` pour la démo.

### Interface unifiée

```typescript
// packages/server/src/retrieval/fragment-retriever.ts
export interface FragmentRetriever {
  searchForSection(
    section: PlanSection,
    options?: { k?: number; minScore?: number },
  ): Promise<RankedFragment[]>;
}

export interface RankedFragment {
  fragment: Fragment;
  score: number;
  scoreBreakdown?: {
    vectorScore?: number;
    llmScore?: number;
    combined?: number;
  };
  justification?: string; // LLM-provided reason (en mode agentic/hybrid)
}
```

### Factory pattern

```typescript
// packages/server/src/retrieval/factory.ts
export function createRetriever(): FragmentRetriever {
  const mode = process.env.FRAGMINT_RETRIEVAL_MODE ?? 'hybrid';
  switch (mode) {
    case 'vector-only':
      return new VectorRetriever();
    case 'agentic-only':
      return new AgenticRetriever();
    case 'hybrid':
      return new HybridRetriever();
    default:
      throw new Error(`Unknown retrieval mode: ${mode}`);
  }
}
```

### Détail des 3 implémentations

#### VectorRetriever (existant, à refactorer)

- Embedding de la query (section title + description) via Ollama
- Recherche Milvus avec filtres SQL (`subject`, `type`, `status='approved'`)
- Retour des top K par cosine similarity
- Latence : ~200ms
- Coût LLM : 0 (sauf embedding)

#### AgenticRetriever (nouveau, pattern Karpathy)

- Lecture de `fragments-index.md` en mémoire (cache)
- Phase 1 : LLM lit l'index + la section, retourne 10-15 IDs candidats
- Phase 2 : LLM as judge sur chaque candidat avec le contenu réel, top 5
- Latence : 3-15s
- Coût LLM : ~20k tokens par section

#### HybridRetriever (nouveau, retrieve-and-rerank)

- Phase 1 : Milvus retourne 30-50 candidats par cosine similarity + filtres
- Phase 2 : LLM as judge re-rank ces 30-50 sur le contenu
- Phase 3 : top K avec score combiné (40% vector + 60% LLM)
- Latence : 2-8s
- Coût LLM : ~10k tokens par section (moitié de agentic)

### Score combiné en mode hybrid

```typescript
function combinedScore(vectorScore: number, llmScore: number): number {
  // vector_score in [0,1] (cosine similarity)
  // llm_score in [0,10] (judge output)
  const normalizedLlm = llmScore / 10;
  return 0.4 * vectorScore + 0.6 * normalizedLlm;
}
```

Poids 40/60 favorise le LLM (qualité) tout en gardant l'apport vectoriel (rapidité de pré-filtrage). Ajustable.

### Note sur les 3 modes vs bool simple

La spec initiale (notes de réunion Paul) prévoyait un **bool simple** activé/désactivé :
- Activé = full LLM (pattern Karpathy)
- Désactivé = Milvus seul (archi actuelle)

Après analyse du cas IRA, on a fait évoluer vers **3 modes** :
- `vector-only` (équivalent désactivé)
- `agentic-only` (équivalent activé)
- `hybrid` (nouveau, recommandé)

Justification du mode hybrid : c'est ce que font les RAG modernes en production (LlamaIndex, LangChain). Il combine la vitesse de Milvus (pré-filtrage 30-50 candidats par cosine) avec la précision du LLM as judge (re-rank des candidats sur le contenu).

Pour la démo Maudet, montrer les 3 modes en parallèle apporte une valeur démonstrative forte : "Voici la baseline, voici l'agentique pure, voici l'hybride qui combine les deux".

**Décision : on garde les 3 modes pour V1.**

---

## 4bis. Toggle UI — Sélecteur de mode retrieval

> **État** : 🔜 à implémenter après refonte admin Fragments
> **Backend** : déjà livré — `GET/POST /v1/admin/retrieval/mode` avec `requireRole('admin')`
> **Effort estimé** : 1-2h frontend uniquement

### Pourquoi

Faire des `curl` en direct devant le CEO Linagora lors de la démo du 12 juin, c'est exclu. Le toggle UI est indispensable pour switcher entre les 3 modes en live.

### Décisions de design (validées)

| Question | Décision |
|----------|----------|
| Placement | **Header admin** — toujours visible, accessible depuis n'importe quelle page admin |
| Contrôle | **Toggle group horizontal** (3 boutons côte à côte, mode actif highlighté) |
| Tooltip | Court, sur chaque bouton : description du mode + temps estimé |
| Permission | **Admin uniquement** — cohérent avec la route backend |
| Feedback | Highlight du bouton actif + toast léger "Mode hybrid activé" |

### Tooltips par mode

| Mode | Libellé bouton | Tooltip |
|------|---------------|---------|
| `vector-only` | Vectoriel | Milvus cosine similarity, <100ms, baseline |
| `agentic-only` | Agentique | LLM judge sur index.md Karpathy, 2-5s par section, qualité maximale |
| `hybrid` | Hybride ⭐ | Milvus pré-filtrage + LLM re-rank, 1-3s, recommandé pour la démo |

### Composants à créer

```
packages/web/src/
  components/admin/retrieval-mode-toggle.tsx   ← toggle group + toast
  api/hooks/use-retrieval-mode.ts              ← useQuery + useMutation
```

### Hook `useRetrievalMode`

```typescript
// GET /v1/admin/retrieval/mode → { mode: 'vector-only' | 'agentic-only' | 'hybrid' }
export function useRetrievalMode() { ... }

// POST /v1/admin/retrieval/mode { mode }
export function useSetRetrievalMode() { ... }
```

### Intégration

Insérer `<RetrievalModeToggle />` dans `admin-layout.tsx`, dans la zone bas de la sidebar (ou en haut du `<main>` si on préfère ne pas alourdir la sidebar).

### Ordre d'implémentation

1. `use-retrieval-mode.ts` (hook fetch + mutation)
2. `retrieval-mode-toggle.tsx` (toggle group shadcn + tooltip)
3. Intégration dans `admin-layout.tsx`
4. Toast de confirmation

---


## 5. Refonte des métadonnées : 7 axes enrichis

### Vue d'ensemble

Aujourd'hui : `domain` + `type` + `lang` + `tags` (limité).
Cible : 7 axes structurés pour navigation sémantique riche.

### Axe 1 : Subject (refacto du `domain` actuel)

Le **sujet métier** dont parle le fragment.

**Valeurs prédéfinies** :

- `twake-mail`
- `twake-calendar`
- `twake-drive`
- `twake-chat`
- `linshare`
- `lincloud`
- `linto`
- `openrag`
- `linagora-corp` (la société elle-même)
- `other`

**Émergentes** : le LLM peut proposer une nouvelle valeur si un produit non listé apparaît. Validation admin.

### Axe 2 : Function (nouveau, distinct de subject) — V2

> **Non affiché en V1 mission.** Le champ `function_type` est stocké en DB et renseigné par le harvester, mais n'est pas visible dans l'UI et n'intervient pas dans la sélection des fragments. Sera activé en V2.

La **fonction métier** du fragment.

**Valeurs prédéfinies** :

- `technical` (architecture, déploiement, intégration)
- `commercial` (offres, pricing, engagements)
- `legal` (clauses, conformité, RGPD)
- `operational` (support, SLA, maintenance)
- `strategic` (vision, positionnement, roadmap)
- `reference` (témoignage client, cas d'usage)

### Axe 3 : Type (inchangé)

La fonction rhétorique dans un document.

`introduction` | `argument` | `description` | `pricing` | `clause` | `faq` | `conclusion` | `bio` | `temoignage` | `reference-technique` | `methodology` | `engagement` | `cas-usage`

### Axe 4 : Entities (nouveau, LLM-extracted)

Objets métier nommés. Crée des cross-references implicites entre fragments.

**Types d'entités à extraire** :

- `clients_mentioned` : ex. ["CNB", "Maurice", "IRA", "Sesam-Vitale"]
- `products_mentioned` : ex. ["Twake Mail", "Apache James", "Outlook"]
- `technologies` : ex. ["JMAP", "IMAP", "CalDAV", "Cassandra", "PostgreSQL"]
- `partners` : ex. ["Cloud Temple", "DINUM", "Tchap"]
- `certifications` : ex. ["SecNumCloud", "HDS", "ISO27001"]
- `regulations` : ex. ["RGPD", "Cloud Act", "FISA"]
- `metrics` : ex. ["5M emails/jour", "99.5% SLA", "50% réduction réseau"]

**Pour la mission V1** : on se limite aux 4 types prioritaires : `clients`, `products`, `technologies`, `partners`, `certifications`. `regulations` et `metrics` en V2 si temps.

### Axe 5 : Audience (nouveau) — V2

> **Non affiché en V1 mission.** Stocké en DB et renseigné par le harvester, invisible dans l'UI. Sera activé en V2.

Pour qui le fragment est écrit.

**Valeurs** : `technique` | `decideur` | `utilisateur` | `juridique`

Un fragment peut viser plusieurs audiences (champ array).

**Pourquoi un axe distinct et pas un tag** : c'est un enum fermé qui sert au LLM judge comme grille d'évaluation structurée. Si on le mettait en tag (`audience:technique` mélangé à `pu:4.50`, `cloud`...), on perdrait :
- La garantie de cohérence (un contributor pourrait écrire `audience:décideur` avec accent ou `audience:executive` en anglais)
- La structuration dans l'index.md de Karpathy (ligne dédiée `Audience: ...`)
- La fiabilité du LLM judge (qui doit deviner ce qui est une info d'audience parmi des tags ouverts)

### Axe 6 : Maturity (nouveau) — V2

> **Non affiché en V1 mission.** Stocké en DB et renseigné par le harvester, invisible dans l'UI. Sera activé en V2.

Le **stade de développement** du sujet traité par le fragment.

**Valeurs** : `production` | `beta` | `roadmap` | `archive`

#### Définitions détaillées

**`production`** : le sujet/feature est **disponible et opérationnel aujourd'hui**.
- Exemple : "Twake Mail est qualifié SecNumCloud" → c'est vrai aujourd'hui
- "Notre SLA est de 99,5%" → opérationnel
- "Apache James est notre backend depuis 2019" → en production
- **Utilisation** : peut être inclus dans un document livrable sans réserve

**`beta`** : le sujet/feature est **en phase beta**, disponible mais en stabilisation.
- Exemple : "Le module d'audit avancé est en beta depuis Q2 2026"
- "L'intégration Twake Drive ↔ Twake Calendar est en cours de finalisation"
- **Utilisation** : avec disclaimer ("en cours de stabilisation"), nécessite accord client

**`roadmap`** : le sujet/feature **n'est pas encore livré**, c'est une promesse future.
- Exemple : "Twake Mail intégrera le chiffrement E2E natif d'ici fin 2026"
- "Le support de SAML est prévu pour Q4"
- **Utilisation** : danger ! Ne pas proposer comme acquis. Mention "feature en roadmap" obligatoire si utilisé.

**`archive`** : le sujet est **dépassé**, conservé pour référence historique.
- Exemple : ancienne tarification 2024 qu'on garde pour comparer
- Ancienne offre commerciale remplacée
- **Utilisation** : exclu par défaut des recherches, accessible via toggle "include archives"

#### Distinction avec les autres mécanismes temporels

| Question | Mécanisme |
|----------|-----------|
| À quel stade en est ce sujet aujourd'hui ? | `maturity` |
| Ce fragment a-t-il été remplacé par un autre ? | `superseded_by` / `supersedes` (mécanisme de supersedure) |

Un fragment a **toujours** un `maturity`. Il **peut** avoir une supersedure (vide si pas remplacé). Les deux sont complémentaires.

#### Exemples de combinaisons

- Fragment "Twake Mail SLA 99,5% (2024)" : `maturity=production` puis `archived` après supersedure par "SLA 99,9% (2026)"
- Fragment "Roadmap chiffrement E2E" : `maturity=roadmap`, pas de supersedure (en attente de devenir production)
- Fragment "Tarification 2026" : `maturity=production`, possiblement `supersedes` la "Tarification 2025"

### Axe 7 : Tags libres (existant, enrichi)

Mots-clés free-form pour ce qui ne rentre pas dans les axes structurés.

Le LLM peut proposer des tags émergents. Admin valide via UI dédié.

### Axe optionnel V2 : Custom notes

Annotations libres de l'auteur après validation :

```yaml
custom_notes:
  - 'À utiliser quand le client demande des références volumétriques fortes'
  - 'Argument à privilégier face à Microsoft'
  - 'Validité limitée : version Twake v2.5+'
```

Reporté en V2, sauf si temps en fin de mission.

### Note sur la simplification temporelle (décision V1)

Le plan initial prévoyait 3 mécanismes pour gérer la temporalité :
- `valid_from` / `valid_until` (période de validité prédéterminée)
- `superseded_by` / `supersedes` (mécanisme de remplacement)
- `maturity` (stade de développement)

**Décision V1 : supprimer `valid_from` / `valid_until`** pour les raisons suivantes :

1. **Peu utilisé en pratique** : les cas où on connaît à l'avance une date d'expiration sont rares
2. **Redondant avec supersedure** : la supersedure couvre 95% des cas (un nouveau pricing arrive → l'ancien est archivé via supersedure, pas besoin de valid_until prédéfini)
3. **Confusion sémantique** : 3 mécanismes temporels créent de la confusion entre auteur/admin

**Ce qu'on garde** :
- `maturity` : stade de développement (production / beta / roadmap / archive)
- `superseded_by` / `supersedes` : mécanisme de remplacement par événement
- `created_at` / `updated_at` : dates système (Drizzle natif)

**Cas d'usage de "date d'expiration"** : utiliser le body du fragment ("Offre promotionnelle valable jusqu'au 31/12/2025") plutôt qu'un champ dédié. Le LLM judge détectera la date dans le body au moment du retrieval si pertinent.

Si en V2 un besoin réel apparaît, on pourra réintroduire le mécanisme.

---

## 6. Classification hiérarchique en 3 étapes

### Pourquoi hiérarchique

Le LLM produit de meilleurs résultats quand on lui demande **une décision à la fois** plutôt qu'une classification composite. Validation empirique : passer de single-shot à 2-3 étapes réduit significativement les `other`/`other`.

### Architecture en 3 étapes

#### Étape 1 : Subject + Function (axes principaux)

```typescript
// 1 appel LLM, 2 outputs structurés
const { subject, function } = await classifySubjectAndFunction(fragment);
```

Prompt court, focus sur "de quoi ça parle" + "à quoi ça sert".

#### Étape 2 : Type + Entities (rhétorique + extraction)

```typescript
const { type, entities } = await classifyTypeAndExtractEntities(fragment);
```

Le LLM identifie la fonction rhétorique ET extrait les entités nommées en un seul appel (plus efficace que 2 appels séparés).

#### Étape 3 : Audience + Maturity + Tags (enrichissement)

```typescript
const { audience, maturity, tags } = await enrichMetadata(fragment, previousResults);
```

Le LLM utilise les résultats des étapes 1-2 comme contexte pour affiner.

### Bénéfices

1. **Précision** : chaque étape a une décision restreinte
2. **Debugabilité** : on peut mesurer la qualité par axe indépendamment
3. **Coût** : possibilité d'utiliser un modèle plus petit pour les étapes simples
4. **Iteration** : si une étape merde, on relance juste celle-là

### Coût total estimé

- Étape 1 : ~800 tokens prompt + ~50 tokens output
- Étape 2 : ~1200 tokens prompt + ~150 tokens output
- Étape 3 : ~1500 tokens prompt + ~100 tokens output

**Total : ~3800 tokens par fragment ingéré**. À ~$1/Mtoken (Claude Sonnet input) : ~0.4 centime par fragment.

Pour 200 fragments à ré-ingérer : ~$0.80. Négligeable.

### Few-shot examples par catégorie

Pour améliorer la précision, on injecte 2-3 exemples validés par catégorie dans le prompt.

**Stratégie de sélection des exemples** :

Pour la mission, **sélection manuelle** : Juliette choisit après la curation manuelle les 3 meilleurs exemples pour chaque valeur. C'est hardcodé dans le prompt.

**V2** : sélection dynamique par clustering des fragments validés (le plus diversifié possible dans la catégorie).

---

## 7. Génération du fragments-index.md

### Rôle dans l'architecture

L'`index.md` est le **point d'entrée unique** pour le mode `agentic-only` et le **support de réflexion** pour le mode `hybrid` :

- Le LLM le lit pour identifier les candidats Phase 1
- Il est régénéré à chaque modification de fragment (approve, edit, archive)
- Stocké dans le vault Git (versionné automatiquement)

### Format proposé

```markdown
---
generated_at: 2026-05-28T10:00:00Z
total_fragments: 142
total_approved: 89
total_reviewed: 38
total_draft: 15
schema_version: 1
last_lint_at: 2026-05-27T18:30:00Z
---

# Fragments Index

## By Subject × Function

### twake-mail × commercial (12 fragments, 8 approved)

#### Approved

- `[abc-123]` **Twake Mail pricing 2026**
  - Type: pricing · Audience: decideur, juridique · Maturity: production
  - Entities: certification:SecNumCloud, partner:OVH, metric:99.5%-SLA
  - Tags: tarification, engagement, sla
  - Supersedes: [xyz-987]
  - Summary: Grille tarifaire détaillée Twake Mail avec options Pro/Enterprise

- `[def-456]` **Twake Mail argument open source réel**
  - Type: argument · Audience: decideur, technique · Maturity: production
  - Entities: technology:Apache-James, regulation:Cloud-Act
  - Tags: open-source, dual-licensing, souverain
  - Summary: Différenciateur vs concurrents avec dual licensing caché

#### Reviewed (en attente d'approbation)

- `[jkl-012]` **Twake Mail roadmap 2026**
  - Type: engagement · Audience: decideur · Maturity: roadmap
    ...

### twake-mail × technical (18 fragments, 12 approved)

...

## By Entity

### certification:SecNumCloud (8 fragments)

- `[abc-123]` Twake Mail pricing 2026 (twake-mail/commercial)
- `[mno-345]` LinShare Pro architecture (linshare/technical)
- `[pqr-678]` LinCloud audit RGPD (lincloud/legal)

### technology:Apache-James (15 fragments)

- `[def-456]` Twake Mail argument open source réel (twake-mail/commercial)
- `[ghi-789]` Twake Mail architecture (twake-mail/technical)
- `[stu-901]` Référence Sesam-Vitale (linagora-corp/reference)

### partner:Cloud-Temple (6 fragments)

...

## By Status

### Currently active approved (89 fragments)

### Superseded (15 fragments — archived)

## Recently Added (7 days)

- `[abc-123]` Twake Mail pricing 2026 — 2026-05-15
- `[def-456]` Twake Mail argument open source réel — 2026-05-12
```

### Sections de l'index

1. **Frontmatter YAML** : métadonnées globales pour navigation rapide
2. **By Subject × Function** : section principale, navigation par 2 axes croisés
3. **By Entity** : navigation par entités (cross-references implicites)
4. **By Status** : pour le filtrage par statut
5. **Recently Added** : pour le contexte de fraîcheur

### Stockage

**Choix retenu** : fichier markdown dans le vault Git + cache mémoire serveur.

```typescript
class IndexManager {
  private indexFilePath = './example-vault/fragments-index.md';
  private cachedIndex: ParsedIndex | null = null;
  private cachedAt: number = 0;

  async getIndex(): Promise<ParsedIndex> {
    const stat = await fs.stat(this.indexFilePath);
    if (this.cachedIndex && stat.mtimeMs <= this.cachedAt) {
      return this.cachedIndex;
    }
    const content = await fs.readFile(this.indexFilePath, 'utf-8');
    this.cachedIndex = parseIndex(content);
    this.cachedAt = stat.mtimeMs;
    return this.cachedIndex;
  }

  async regenerate(): Promise<void> {
    const fragments = await db.fragments.findMany({
      where: { status: { not: 'draft' } },
    });
    const content = await generateIndexMarkdown(fragments);
    await fs.writeFile(this.indexFilePath, content);
    this.cachedIndex = null;
  }
}
```

### Triggers de régénération

**Automatique** :

- Approve fragment
- Reject fragment
- Edit fragment (titre, métadonnées, body)
- Supersedure validée
- Contradiction résolue

**Manuel** :

- Endpoint admin `POST /v1/index/rebuild`

### Performances

- 200 fragments → ~50ms pour générer l'index
- Index de ~3000 lignes pour 200 fragments
- ~15-25k tokens (tient dans le contexte Claude Sonnet 200k)
- Pour 500+ fragments : compression nécessaire (résumés plus courts)

---


## 8. Recherche en 2 phases (mode agentic et hybrid)

### Phase 1 : Sélection des candidats

#### Mode `agentic-only`

Le LLM reçoit :

- L'index complet (fragments-index.md)
- La section du plan à composer (titre + description + contexte plan)
- Les critères globaux de la requête (langue cible, audience cible, etc.)

Le LLM retourne 10-15 IDs candidats avec justification courte.

#### Mode `hybrid`

Milvus retourne 30-50 candidats par cosine similarity sur l'embedding de la section.

Filtres SQL appliqués avant Milvus :

- `status = 'approved'` (sauf si on inclut explicitement reviewed)
- `lang` correspond à la langue cible
- `maturity != 'roadmap'` (sauf si on veut explicitement de la roadmap)
- `superseded_by IS NULL` (pas de fragments archivés)

### Phase 2 : LLM as judge sur le contenu

Pour chaque candidat (10-15 en mode agentic, 30-50 en mode hybrid), le LLM lit le contenu complet et juge.

**Implémentation : batching plutôt que parallélisation**

Au lieu de N appels parallèles, on fait **1 seul appel qui juge tous les candidats à la fois** :

```typescript
async function judgeBatch(
  section: PlanSection,
  candidates: Fragment[],
  context: SearchContext,
): Promise<JudgmentResult[]> {
  const prompt = buildJudgePrompt(section, candidates, context);
  const response = await llm.complete(prompt);
  return parseJudgmentResults(response);
}
```

**Avantages du batching** :

- 1 seul overhead réseau au lieu de N
- Le LLM peut comparer entre fragments (meilleure calibration des scores)
- Moins de tokens utilisés (prompt système 1 fois)

**Limite** : si le total contexte dépasse 32k tokens, fallback sur batches plus petits.

### Score et seuil

Chaque candidat reçoit :

- Score de pertinence [0-10]
- Justification courte (1 phrase)
- Recommandation `use` | `skip` | `borderline`

Seuil par défaut : score >= 7. Configurable par l'utilisateur.

### Intelligence temporelle au retrieval

Le LLM judge utilise les métadonnées temporelles pour calibrer la sélection selon le contexte du plan.

#### Filtres durs (appliqués avant la phase 2)

```typescript
function applyTemporalFilters(candidates, planContext) {
  return candidates.filter(c => {
    // Exclure les fragments archivés
    if (c.status === 'archived') return false;
    
    // Exclure les fragments superseded
    if (c.superseded_by !== null) return false;
    
    // Exclure roadmap si livraison imminente
    if (planContext.signature_date_within_days < 30 && c.maturity === 'roadmap') {
      return false;
    }
    
    return true;
  });
}
```

#### Intelligence prédictive selon la date de signature

Lors de la création d'un plan, l'auteur précise (optionnellement) :
- Date prévue de livraison
- Date prévue de début de déploiement

Le LLM judge utilise ces infos pour calibrer la sélection :
- Livraison imminente (< 30j) : exclure tout `roadmap`, privilégier `production`
- Déploiement à 3-6 mois : accepter `beta` qui auront stabilisé d'ici là
- Document long terme (> 12 mois) : roadmap acceptable avec disclaimer "prévu"

#### Préférence de fraîcheur

Quand 2 fragments sont équivalents en pertinence, privilégier le plus récent :
- Bonus +0.5 pour fragments < 3 mois
- Bonus +0.25 pour fragments < 6 mois
- Neutre pour fragments < 12 mois
- Malus -0.25 pour fragments > 24 mois (candidat potentiel à supersedure)

#### Compréhension native du LLM

Avec le mode agentic, le LLM comprend nativement les expressions temporelles dans les requêtes utilisateur :
- "Fragments sur Twake Mail créés ces 2 derniers mois"
- "Références client de cette année"
- "Avant la refonte de la roadmap 2026"

Pas besoin de programmer des filtres dédiés. Le LLM applique l'intelligence temporelle à la lecture de l'index. **C'est un avantage du mode agentic vs vector-only** à mettre en avant en démo.

---

## 9. LLM as judge : prompts et architecture

### Prompt pour la sélection Phase 1 (mode agentic-only)

```
You are helping select content fragments for a section of a document.

# Section to compose
Title: {section.title}
Description: {section.description}
Context in plan: {section.plan_context}
Target audience: {context.target_audience}
Target language: {context.target_language}

# Available fragments index
{index_markdown}

# Your task
Identify the 10-15 most relevant fragments for this section.

Consider:
- Subject match (does the fragment talk about the right topic?)
- Function match (technical/legal/strategic alignment)
- Type appropriateness (introduction, argument, reference, etc.)
- Entity overlap (mentioned clients, technologies, certifications)
- Audience alignment
- Maturity (avoid roadmap features if production deployment imminent)
- Avoid superseded or archived fragments

Output JSON only:
{
  "selected_ids": ["abc-123", "def-456", ...],
  "reasoning": "Brief explanation of selection logic"
}
```

### Prompt pour la sélection Phase 1 (mode hybrid)

Similaire mais avec les candidats déjà filtrés par Milvus :

```
You are re-ranking content fragments for a section of a document.

# Section to compose
Title: {section.title}
Description: {section.description}
Context in plan: {section.plan_context}

# Candidate fragments (pre-filtered by vector similarity)
{candidate_fragments_summary}

# Your task
Re-rank these candidates by their actual relevance to the section.
Vector similarity already pre-filtered for topical match, but you should
evaluate semantic appropriateness, completeness, and contextual fit.

Output JSON only:
{
  "rankings": [
    { "id": "abc-123", "rank": 1, "score": 9, "reason": "..." },
    ...
  ]
}
```

### Prompt pour le judge Phase 2

```
You are evaluating whether content fragments fit a specific section of a
document.

# Section
Title: {section.title}
Description: {section.description}
Target audience: {context.target_audience}
Plan context: {section.plan_context}

# Fragments to evaluate ({n} fragments)

## Fragment 1: {id}
Title: {title}
Metadata: {metadata_summary}
Content:
{body}

## Fragment 2: {id}
...

# Your task
Evaluate each fragment on a 0-10 scale:
- 0-3: Irrelevant or tangential
- 4-6: Partially relevant, could fit but better alternatives may exist
- 7-9: Highly relevant, fits naturally in the section
- 10: Perfect match, was clearly written for this kind of section

Consider:
- Topical match (is this about the right subject?)
- Functional appropriateness (technical depth, tone, style, etc.)
- Completeness (does it cover the section's needs?)
- Compatibility with other fragments likely selected
- Contextual fit with the target audience and use case

Output JSON only:
{
  "judgments": [
    {
      "id": "fragment_id",
      "score": 0-10,
      "reason": "One sentence explanation",
      "recommendation": "use" | "skip" | "borderline"
    }
  ]
}
```

### Pattern multi-agent self-consistency pour le LLM judge

Pour les cas où la qualité du retrieval est critique (V2 et démo prod), on peut activer un pattern **2 agents avec validations différentes** :

#### Agent A — Pertinence factuelle

- Évalue si le fragment répond techniquement à la section
- Focus : subject match, function match, entity coverage
- Prompt orienté "Ce fragment couvre-t-il les besoins factuels de la section ?"

#### Agent B — Cohérence stylistique et tonale

- Évalue si le fragment s'intègre bien avec les autres sélectionnés
- Focus : ton, audience, niveau de détail, cohérence narrative
- Prompt orienté "Ce fragment s'enchaîne-t-il bien avec les autres ?"

#### Workflow

```typescript
async function judgeWithMultiAgent(section, candidates) {
  const [factualResults, coherenceResults] = await Promise.all([
    agentA_judgeFactual(section, candidates),
    agentB_judgeCoherence(section, candidates)
  ]);
  
  return reconcileResults(factualResults, coherenceResults);
}

function reconcileResults(factual, coherence) {
  for (const candidate of candidates) {
    const scoreA = factual[candidate.id].score;
    const scoreB = coherence[candidate.id].score;
    
    // Désaccord majeur : re-vérification
    if (Math.abs(scoreA - scoreB) > 3) {
      candidate.needs_recheck = true;
      candidate.disagreement = { factual: scoreA, coherence: scoreB };
    }
    
    // Score combiné
    candidate.final_score = (scoreA + scoreB) / 2;
  }
  return candidates;
}
```

#### Re-vérification automatique

Quand les 2 agents sont en désaccord majeur (différence > 3 points sur 10), un 3e appel LLM est déclenché avec un prompt enrichi qui inclut les 2 raisonnements précédents :

```
You previously evaluated this fragment with 2 different criteria:
- Factual relevance: score 8/10. Reason: ...
- Stylistic coherence: score 4/10. Reason: ...

Reconcile these views and provide a final score with justification.
```

#### Coût et arbitrage

- Avec multi-agent : ×2 appels LLM par section (+ éventuel ×3 en cas de désaccord)
- Pour 5 sections × 30 candidats : ~60-90 appels LLM
- Justifié pour documents à fort enjeu, pas pour itérations rapides

#### Activation par feature flag

```env
FRAGMINT_MULTI_AGENT_JUDGE=false  # default pour V1
FRAGMINT_MULTI_AGENT_JUDGE=true   # pour démo qualité max ou prod
```

Pour V1 démo : activer sur 1-2 sections critiques de la démo IRA pour montrer la fiabilité accrue, désactiver sur le reste pour rapidité.

Pour V2 : activer par défaut, possibilité de désactiver pour tâches non critiques.

### Prompts pour les autres opérations

Voir section 20 pour les prompts complets : classification, supersedure, contradictions, extraction d'entités.

---

## 10. Cache LRU et invalidation

### Pourquoi cacher

Les appels LLM coûtent et prennent du temps. Pendant les répétitions de démo, le même cahier des charges va être testé plusieurs fois.

### Bibliothèque

`lru-cache` (npm), hyper-standard, 60M downloads/semaine.

### Implémentation

```typescript
import { LRUCache } from 'lru-cache';
import crypto from 'crypto';

class RetrievalCache {
  private cache: LRUCache<string, RankedFragment[]>;

  constructor() {
    this.cache = new LRUCache({
      max: 100,
      ttl: 1000 * 60 * 60, // 1h
      updateAgeOnGet: true,
    });
  }

  buildKey(section: PlanSection, mode: RetrievalMode): string {
    const content = JSON.stringify({
      section_title: section.title,
      section_desc: section.description,
      mode,
      index_version: this.getCurrentIndexVersion(),
    });
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  get(key: string): RankedFragment[] | undefined {
    return this.cache.get(key);
  }

  set(key: string, value: RankedFragment[]): void {
    this.cache.set(key, value);
  }

  clear(): void {
    this.cache.clear();
  }

  private getCurrentIndexVersion(): string {
    // Hash du mtime de fragments-index.md
    // Ainsi tout changement d'index invalide automatiquement le cache
    const stat = fs.statSync('./example-vault/fragments-index.md');
    return String(stat.mtimeMs);
  }
}
```

### Stratégie d'invalidation

**Cas où invalider** :

- Nouveau fragment approved/rejected → cache.clear() (l'index a changé)
- Fragment modifié (title, metadata, body) → cache.clear()
- Mode retrieval changé → invalidation automatique (clé inclut le mode)

**Stratégie simple et robuste** : `cache.clear()` à chaque écriture sur la DB des fragments. Brutal mais sûr et lisible.

### Persistance

Pour la mission : **en mémoire seulement**. Si le serveur restart, le cache repart vide. 5-10 min de répétitions le remplit à nouveau.

V2 : persistance SQLite optionnelle.

---

## 11. Relations entre fragments (implicites et explicites)

> **⚠️ Hors périmètre V1 mission** — Cette fonctionnalité est documentée pour la V2. Ne pas implémenter lors de la mission de 20 jours. Les colonnes DB (`fragment_relations`) peuvent être créées mais le tab Relations et la génération LLM de relations explicites sont différés.

### Concept

Le graph de fragments est construit à **2 niveaux distincts** qui se complètent :

### Niveau 1 — Cross-references implicites (mécanique, gratuit)

Construites automatiquement par agrégation SQL sur les métadonnées partagées des fragments approved :

- Fragments partageant la même entity → arête implicite
- Fragments du même subject → cluster
- Fragments avec tags communs → proximité

**Pas de LLM nécessaire**. Mise à jour automatique à chaque modification.

**Exemple** : si fragment A mentionne `entities.certifications: [SecNumCloud]` et fragment B aussi, ils sont implicitement liés. Quand on clique sur SecNumCloud dans le graph, tous les fragments le mentionnant remontent.

### Niveau 2 — Relations explicites typées (LLM-generated)

Construites par le LLM à l'ingestion d'un nouveau fragment. Types pour V1 :

1. **`details`** : "B détaille A" (overview → spec technique)
2. **`exemplified_by`** : "A est illustré par B" (argument → référence client)
3. **`priced_by`** : "A est tarifié par B" (description produit → pricing)

**Types reportés en V2** :

- `introduces`, `implements`, `requires`, `contradicts`, `supersedes`

Coût LLM mais valeur sémantique forte. Validation admin via le tab Relations. Affichées dans le graph uniquement une fois validées.

### Différenciation visuelle dans le knowledge graph

- Arêtes implicites : gris fin, faible opacité (pour visualiser les clusters)
- Arêtes explicites : couleur épaisse, label du type (pour les vraies relations sémantiques)

### Périmètre du graph

Le knowledge graph affiche **uniquement les fragments `approved`** et **uniquement les relations explicites validées**. C'est cohérent avec l'usage en composition de documents : on ne navigue que dans le corpus stable et validé.

Les fragments en `draft` ou `reviewed` se valident via l'UI fragments list standard, pas dans le graph.

Cette dualité (niveau 1 + niveau 2) permet :
- Un graph **utile dès qu'un fragment est approved** (niveau 1 gratuit, immédiat)
- Un graph **enrichi progressivement** par validation des relations explicites (niveau 2)

### Modèle de données

```sql
CREATE TABLE fragment_relations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_fragment_id TEXT NOT NULL,
  to_fragment_id TEXT NOT NULL,
  relation_type TEXT NOT NULL CHECK(relation_type IN ('details', 'exemplified_by', 'priced_by')),
  created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL,  -- 'llm-auto' | 'admin:username'
  confidence REAL,  -- 0.0 to 1.0, only for LLM-detected
  validated_at INTEGER,
  validated_by TEXT,

  FOREIGN KEY (from_fragment_id) REFERENCES fragments(id),
  FOREIGN KEY (to_fragment_id) REFERENCES fragments(id),
  UNIQUE(from_fragment_id, to_fragment_id, relation_type)
);

CREATE INDEX idx_relations_from ON fragment_relations(from_fragment_id);
CREATE INDEX idx_relations_to ON fragment_relations(to_fragment_id);
```

### Génération automatique

Lors de l'ingestion d'un nouveau fragment, le LLM propose des relations candidates en analysant :

- Fragments existants avec entités communes
- Fragments de même subject + types complémentaires (overview vs detail, argument vs reference, etc.)

**Prompt LLM** :

```
You are analyzing a new fragment to detect potential relationships with existing fragments.

# New fragment
{new_fragment}

# Potentially related fragments (filtered by entity overlap and subject match)
{candidate_fragments}

# Your task
Detect potential relationships between the new fragment and existing ones.

Available relation types:
- "details": fragment A introduces/overviews, fragment B details/elaborates
- "exemplified_by": fragment A makes a claim, fragment B provides a real-world example
- "priced_by": fragment A describes a product/feature, fragment B provides pricing

Output JSON only:
{
  "relations": [
    {
      "from": "new_fragment_id",
      "to": "existing_fragment_id",
      "type": "details" | "exemplified_by" | "priced_by",
      "confidence": 0.0-1.0,
      "reason": "Brief explanation"
    }
  ]
}

Only suggest relations with confidence >= 0.7.
```

### Validation humaine

UI admin liste les relations proposées par le LLM, avec :

- Diff côte à côte des 2 fragments
- Bouton "Confirmer" / "Rejeter" / "Modifier le type"

### Utilisation dans la recherche

Quand le LLM judge Phase 2 sélectionne un fragment, il peut **automatiquement remonter ses voisins** (selon le type de relation) comme candidats supplémentaires :

- Si on sélectionne un fragment `argument`, on cherche son `exemplified_by`
- Si on sélectionne un fragment `description`, on cherche son `priced_by`
- Si on sélectionne un fragment `introduction`, on cherche ses `details`

Ça enrichit la composition de manière contextuellement cohérente.

### Visualisation

Vue admin "Knowledge Graph" : graphe interactif (cytoscape ou vis.js) avec :

- Nœuds colorés par `subject`
- Edges typés par couleur
- Filtres par subject/function/entity
- Click → détail du fragment

Voir section 17 pour les détails Claude Design.

---


## 11bis. Knowledge Graph : visualisation interactive du corpus

> **⚠️ Hors périmètre V1 mission** — La visualisation interactive du corpus est différée à la V2. Le tab Knowledge Graph est affiché dans l'UI admin avec la mention "coming soon" mais n'est pas implémenté. Dépend de la section 11 (Relations) qui est elle-même hors périmètre V1.

> Cette section documente le Knowledge Graph en tant que **vue UI**, complément
> à la section 11 qui définit les relations sémantiques en tant que **structure
> de données**.

### 11bis.1 Rôle dans Fragmint

Le Knowledge Graph est l'outil d'**exploration visuelle** du corpus. Là où les
autres tabs admin servent à **maintenir** la qualité (validation, résolution),
le Knowledge Graph sert à **comprendre** le corpus dans son ensemble :

- Identifier les clusters de fragments par sujet
- Voir quelles entités sont surreprésentées vs sous-représentées
- Détecter les zones du corpus qui mériteraient plus de contenu
- Préparer un document en partant d'une thématique
- Argument démo : projeter le graph montre la richesse du référentiel

Ce n'est **pas** un outil de validation quotidienne. C'est un outil de réflexion
stratégique et de démo.

### 11bis.2 Périmètre d'affichage

Le graph affiche **uniquement les fragments `approved`** (cf section 11). C'est
cohérent avec l'usage en composition : on ne navigue que dans le corpus stable
et validé.

Décision V1 : pas de toggle "afficher les drafts/reviewed". L'admin valide
ailleurs (tab Validation), le graph ne pollue pas la vue avec du contenu non-stable.

### 11bis.3 Trois modes d'affichage selon Milvus

Le graph fonctionne avec ou sans Milvus, mais la richesse change.

#### Mode A — Milvus actif (mode nominal V1)

Le graph affiche **2 types d'edges** :

**Edges implicites — fines, grises** :
- Calculées automatiquement par agrégation SQL : fragments partageant une entity
- Calculées par similarité sémantique (cosine embedding) : fragments proches même sans entity commune
- Pas de LLM, pas de validation admin nécessaire
- Mise à jour automatique à chaque approbation

**Edges explicites — épaisses, colorées par type** :
- Construites par le LLM à l'ingestion (`details`, `exemplified_by`, `priced_by`)
- Validées par l'admin via le tab Relations
- Couleur différente par type pour lisibilité

C'est le mode complet, le plus riche, à viser pour la démo.

#### Mode B — Milvus inactif (mode dégradé)

Sans Milvus, on perd la similarité sémantique. Il reste :

**Edges implicites par métadonnées partagées seulement** :
- Fragments avec entities communes : edge fine
- Fragments du même subject : groupement visuel par cluster, pas d'edge directe
- Fragments avec tags partagés : edge encore plus fine

**Edges explicites typées** : inchangées

Bannière en haut du graph : "Mode dégradé : la similarité sémantique est désactivée
(Milvus inactif). Activez Milvus pour une vue enrichie."

#### Mode C — Pas de fragments validés (bootstrap)

Si le corpus n'a pas encore de fragments `approved`, le graph est vide. Message :

```
"Aucun fragment validé pour le moment. Le knowledge graph se construit
au fur et à mesure de vos validations. Allez valider les fragments
candidats dans le tab Harvest."
```

Lien direct vers la page de validation.

### 11bis.4 Trois modes de retrieval, un seul mode d'affichage

**Distinction critique** : les 3 modes de retrieval (vector-only / agentic-only /
hybrid) décrits en section 4 concernent la **recherche de fragments pour
composition**. Ils sont indépendants du Knowledge Graph qui est une **vue
d'exploration**.

Le Knowledge Graph est utilisé pour :
- Voir le corpus (lecture)
- Explorer des relations (navigation)
- Comprendre des patterns (analyse)

Le retrieval est utilisé pour :
- Trouver les meilleurs fragments pour une section donnée (composition)
- Scorer la pertinence (filtrage)

Confondre les deux serait une erreur architecturale. Le graph ne fait pas de
retrieval, il fait de la visualisation.

### 11bis.5 Architecture technique

#### Bibliothèque de rendu

**Recommandation V1** : `react-flow`.

Comparaison rapide :

| Critère | react-flow | cytoscape.js |
|---------|------------|--------------|
| Intégration React | Native | Via wrapper |
| Performance > 500 nœuds | OK avec optimisations | Excellente |
| Layouts automatiques | Quelques presets | Très large bibliothèque |
| Interactivité (zoom, pan, drag) | Native | Native |
| Style customisable | CSS-in-JS | CSS standard |
| Taille bundle | ~200 KB | ~300 KB |

**Décision V1** : react-flow pour la cohérence avec le stack React. Si le corpus
dépasse 500 fragments en V2, envisager le switch vers cytoscape.js.

#### Endpoint backend

`GET /v1/graph` retourne les nœuds et edges au format attendu par react-flow.

```typescript
// packages/server/src/routes/graph-routes.ts

router.get('/v1/graph', async (req, res) => {
  const subject = req.query.subject as string | undefined;
  const entityId = req.query.entity_id as string | undefined;
  const includeImplicit = req.query.include_implicit !== 'false';
  const includeExplicit = req.query.include_explicit !== 'false';

  const fragmentsList = await db.select().from(fragments)
    .where(
      and(
        eq(fragments.quality, 'approved'),
        subject ? eq(fragments.domain, subject) : undefined,
      )
    );

  const nodes = fragmentsList.map(f => ({
    id: f.id,
    type: 'fragment',
    data: {
      title: f.title,
      subject: f.domain,
      functionType: f.function_type,
      type: f.type,
      maturity: f.maturity,
    },
    position: { x: 0, y: 0 },
  }));

  const explicitEdges = includeExplicit
    ? await db.select().from(fragmentRelations)
        .where(isNotNull(fragmentRelations.validatedAt))
    : [];

  const explicitEdgeList = explicitEdges.map(e => ({
    id: `explicit-${e.id}`,
    source: e.fromFragmentId,
    target: e.toFragmentId,
    type: 'explicit',
    data: { relationType: e.relationType },
  }));

  let implicitEdgeList: any[] = [];
  if (includeImplicit) {
    const sharedEntities = await computeSharedEntityEdges(fragmentsList);
    let semanticEdges: any[] = [];
    if (process.env.FRAGMINT_MILVUS_ENABLED === 'true') {
      semanticEdges = await computeSemanticEdges(fragmentsList);
    }
    implicitEdgeList = [...sharedEntities, ...semanticEdges];
  }

  res.json({
    nodes,
    edges: [...explicitEdgeList, ...implicitEdgeList],
    milvusActive: process.env.FRAGMINT_MILVUS_ENABLED === 'true',
    stats: {
      totalFragments: nodes.length,
      explicitEdges: explicitEdgeList.length,
      implicitEdges: implicitEdgeList.length,
    },
  });
});
```

#### Performance et scalabilité

**Limites V1** :
- Corpus < 500 fragments approved : tout charger en une requête, layout client
- Corpus 500-2000 : pagination par cluster (charger un subject à la fois)
- Corpus > 2000 : V2, nécessite optimisations spécifiques

**Cache** :
- Edges implicites par entité partagée : recalcul à chaque approbation/édition
- Edges implicites par similarité sémantique : cache de 1h (TTL court car cosine se ré-évalue)
- Edges explicites : pas de cache (déjà en DB)

### 11bis.6 Modes d'accès dans l'UI (architecture mixte)

Le Knowledge Graph est accessible de **trois façons** dans l'UI :

#### Accès 1 — Tab dédié dans la sidebar admin

Position dans la sidebar : juste après Contradictions, avant Users.

```
Sidebar admin :
├── Inbox
├── Metadata
├── Relations
├── Supersedure
├── Contradictions
├── Knowledge Graph   ← TAB DÉDIÉ
├── Users
└── Collections
```

Route : `/admin/graph`

C'est l'**entrée principale** pour explorer le corpus de manière libre. Le
graph s'ouvre par défaut avec tout le corpus visible, l'utilisateur applique
des filtres ensuite.

#### Accès 2 — Bouton contextuel sur la page Fragment

Sur la fiche détail d'un fragment :

```
[Bouton "Voir dans le graph"]
  ↓ ouvre /admin/graph?focus=<fragment_id>
  ↓ le graph s'affiche centré sur ce fragment, voisins visibles
```

#### Accès 3 — Bouton contextuel sur la page Entity (sous-tab Référentiel)

```
[Bouton "Explorer le cluster"]
  ↓ ouvre /admin/graph?entity=<entity_id>
  ↓ le graph affiche les fragments liés à cette entity
```

#### Cohérence des accès

Tous les accès aboutissent au **même composant graph** avec des paramètres
de query différents :

- `/admin/graph` : tout le corpus
- `/admin/graph?focus=<id>` : centré sur un fragment
- `/admin/graph?entity=<id>` : centré sur une entity
- `/admin/graph?subject=<slug>` : centré sur un subject

### 11bis.7 Interactions utilisateur

#### Sélection et navigation

- **Click sur un nœud** : ouvre un panel latéral avec le détail du fragment
- **Double-click** : navigate vers la page fragment (sort du graph)
- **Hover** : tooltip avec titre + subject + maturity
- **Drag** : déplacement libre du nœud (positions sauvegardées en localStorage)
- **Zoom** : molette ou pinch
- **Pan** : drag du fond

#### Filtres

Panneau latéral gauche (collapsible) :

```
Filtres :
├── Subject : [Multi-select]
├── Function : [Multi-select]
├── Type : [Multi-select]
├── Maturity : [Multi-select]
├── Audience : [Multi-select]
└── Entities : [Multi-select avec recherche]

Affichage :
├── ☑ Edges implicites (entités partagées)
├── ☑ Edges implicites (similarité sémantique)
└── ☑ Edges explicites (relations validées)

Layout :
├── ○ Force-directed (par défaut)
├── ○ Hierarchical (subject → fragments)
└── ○ Cluster (groupement par subject)
```

#### Recherche

Barre de recherche en haut : "Chercher un fragment, une entity..."

Tape "SecNumCloud" → highlights tous les fragments mentionnant cette entity
+ centre la vue dessus.

### 11bis.8 Design visuel

#### Code couleur des nœuds (par subject)

Chaque subject a une couleur dédiée (palette pastel pour la lisibilité) :

- twake-mail : bleu
- twake-calendar : vert
- twake-drive : orange
- twake-chat : violet
- linshare : rouge
- lincloud : turquoise
- linto : rose
- openrag : jaune
- linagora-corp : gris foncé
- other : gris clair

La maturity module l'opacité :
- production : 100% opaque
- beta : 80% opaque
- roadmap : 60% opaque avec hachures
- archive : 40% opaque, grisé (en principe pas affiché)

#### Code couleur des edges

**Implicites** :
- Entité partagée : ligne grise fine (1px)
- Similarité sémantique : ligne grise pointillée (1px)

**Explicites** (par type) :
- `details` : bleu, ligne moyenne (2px)
- `exemplified_by` : vert, ligne moyenne (2px)
- `priced_by` : orange, ligne moyenne (2px)

### 11bis.9 Cas d'usage démo Maudet

Pour la démo du 12 juin, le Knowledge Graph est un acte fort.

#### Scénario démo (2 min)

1. **Ouvrir le tab Knowledge Graph** depuis la sidebar
2. **Montrer le corpus complet** : "Voilà l'ensemble des fragments validés.
   Chaque nœud est un fragment, les couleurs représentent les sujets, les
   liens représentent les relations sémantiques."
3. **Cliquer sur l'entity SecNumCloud** dans le panneau de filtres : "Tous
   les fragments mentionnant cette certification remontent. On voit
   immédiatement qu'on a 8 fragments sur SecNumCloud, principalement liés
   à twake-mail."
4. **Cliquer sur un fragment** pour ouvrir son détail : "Et voilà le détail
   du fragment. On peut naviguer vers ses voisins, voir ses relations
   explicites."
5. **Punchline** : "Cette vue permet à l'auteur de comprendre la
   richesse du corpus sans avoir à connaître chaque fragment
   individuellement."

#### Argument clé

> "Le Knowledge Graph est notre 'carte mentale' du contenu. Quand
> un auteur prépare un document, au lieu de fouiller dans une liste de
> fragments à plat, il peut explorer visuellement par sujet, par entité, par
> relation. C'est ce qui transforme un système de retrieval en outil de
> réflexion stratégique."

### 11bis.10 Limites V1 et roadmap

#### Limites V1 acceptées

1. **Pas de timeline temporelle** : impossible de voir "le graph d'il y a 3 mois"
2. **Pas d'export** : pas de PNG/PDF du graph V1
3. **Pas de collaboratif** : un seul utilisateur à la fois, pas de partage d'annotations
4. **Layout par défaut** : positions sauvées en localStorage uniquement
5. **Performance > 500 fragments** : pas optimisé, peut ramer

#### Roadmap V2

- Snapshots temporels (graph à une date donnée via Git checkout)
- Export PNG/PDF/JSON
- Annotations partagées entre utilisateurs
- Recommandations IA ("ces fragments mériteraient une relation explicite")
- Performance > 2000 fragments (chargement lazy, clustering serveur)
- Comparaison de documents : "Voici les fragments utilisés dans le document IRA vs le document CNB"

---


## 12. Auto-supersedure des fragments

### Workflow en 4 étapes

#### Étape 1 : Détection à l'ingestion

À l'ingestion d'un nouveau fragment, on calcule :

- Fragments existants avec même `subject` + même `type`
- Similarité sémantique (cosine sur embeddings) > 0.80
- Date du nouveau > date des candidats

Si match potentiel → création d'une **proposition de supersedure** en statut `pending`.

```sql
CREATE TABLE supersedure_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  new_fragment_id TEXT NOT NULL,
  old_fragment_id TEXT NOT NULL,
  similarity_score REAL,
  llm_judgment TEXT,  -- 'SUPERSEDE' | 'COEXIST' | 'DIFFERENT_TOPIC'
  llm_confidence REAL,
  llm_reasoning TEXT,
  status TEXT DEFAULT 'pending',  -- 'pending' | 'confirmed' | 'rejected' | 'coexist'
  created_at INTEGER,
  resolved_at INTEGER,
  resolved_by TEXT,

  FOREIGN KEY (new_fragment_id) REFERENCES fragments(id),
  FOREIGN KEY (old_fragment_id) REFERENCES fragments(id)
);
```

#### Étape 2 : LLM as judge

Pour chaque proposition, un LLM judge évalue :

```
You are evaluating whether fragment B should replace fragment A.

# Fragment A (existing, dated {date_a})
Title: {title_a}
Content:
{body_a}

# Fragment B (new, dated {date_b})
Title: {title_b}
Content:
{body_b}

# Your task
Evaluate:
1. Does B cover the same topic as A?
2. Does B contain more recent/updated information than A?
3. Are there elements in A that are absent from B (would be lost)?
4. Recommendation:
   - SUPERSEDE: B fully replaces A, A should be archived
   - COEXIST: Both are valid, possibly in different contexts
   - DIFFERENT_TOPIC: They're not actually about the same thing

Output JSON only:
{
  "recommendation": "SUPERSEDE" | "COEXIST" | "DIFFERENT_TOPIC",
  "confidence": 0.0-1.0,
  "reasoning": "Detailed explanation",
  "elements_lost_in_b": ["element 1", "element 2"] or null
}
```

#### Étape 3 : Validation humaine via UI

Vue admin "Remplacements" (technique : "supersedure proposals") avec :

```
Proposition #4 — Twake Mail pricing 2026 → Twake Mail pricing 2025
Similarité : 0.87 | LLM : À remplacer (confiance 0.92)

[Diff côte à côte]                                     [Voir plein écran]
═══════════════════════════════════════════════════════════════════════
Twake Mail pricing 2025         |  Twake Mail pricing 2026
                                 |
Édition Standard : 4€/mois       |  Édition Standard : 4.50€/mois
Édition Pro : 8€/mois            |  Édition Pro : 9€/mois
Édition Enterprise : sur devis   |  Édition Enterprise : sur devis
                                 |  Édition Sovereign : 12€/mois (NEW)

LLM reasoning :
"B contains updated 2026 pricing for the same product tiers as A, plus
a new 'Sovereign' tier. No information from A is lost."

Actions :
[Confirmer le remplacement] [Coexister] [Rejeter] [Éditer B avant confirmation]
```

#### Étape 4 : Application

Selon décision admin :

**Confirmer supersedure** :

```sql
UPDATE fragments SET status = 'archived', superseded_by = ? WHERE id = ?;
UPDATE fragments SET supersedes = ? WHERE id = ?;
UPDATE supersedure_proposals SET status = 'confirmed', resolved_at = ?, resolved_by = ? WHERE id = ?;
```

**Coexister** : la proposition est marquée résolue, les 2 fragments restent actifs.

**Rejeter** : la proposition est supprimée.

### Note sur le naming UI vs code

Pour faciliter la compréhension utilisateur, le terme technique **"supersedure"** est traduit en **"Remplacements"** côté UI :

| Contexte | Terme utilisé |
|----------|---------------|
| Code (DB, endpoints, variables) | `supersedure` |
| Labels UI (FR) | Remplacements |
| Labels UI (EN) | Replacements |
| Badge "SUPERSEDE" en DB | Affiché "À remplacer" en UI |
| Badge "COEXIST" en DB | Affiché "Coexister" en UI |
| Badge "DIFFERENT_TOPIC" en DB | Affiché "Sujet différent" en UI |

Cette séparation est volontaire : on garde la cohérence avec les termes techniques de la littérature (Karpathy, knowledge management) tout en présentant à l'utilisateur des termes compréhensibles.

**Implémentation complète disponible** : voir le package `FRAGMINT_ADMIN_SUPERSEDURE_PACKAGE.md` qui contient le code complet (DB Drizzle, endpoints API, composants React avec diff visuel, hooks) prêt à intégrer.

### Impact sur la recherche

Filtre par défaut dans tous les retrievers :

```sql
WHERE status != 'archived' AND superseded_by IS NULL
```

Toggle "include archives" pour cas spéciaux (négociation, comparaison historique).

### Sur la temporalité

Comme décidé en section 5 (note sur la simplification temporelle), le mécanisme `valid_from` / `valid_until` est **supprimé en V1**. La supersedure devient le mécanisme principal de gestion temporelle, triggered par un événement réel (nouveau contenu) plutôt que par le temps.

---

## 13. Détection sémantique de contradictions

### Trigger

À l'ingestion d'un nouveau fragment OU à la modification d'un fragment existant.

### Sélection des candidats à comparer

Pas la peine de comparer le nouveau fragment à TOUS les autres. On filtre intelligemment :

- Mêmes `subject` (ou subject lié)
- Entités communes (au moins une)
- Top 20 par similarité sémantique

### LLM judge par paire

```
You are comparing two potentially contradictory fragments.

# Fragment A (date {date_a})
{body_a}

# Fragment B (date {date_b})
{body_b}

# Your task
Determine:
1. Is there a factual contradiction between A and B? (yes/no)
2. If yes, what specific claim is contradictory?
3. Type of contradiction:
   - FACTUAL: different numbers, dates, facts
   - SCOPE: one says "always", the other says "sometimes"
   - TEMPORAL: one is more recent and corrects the other
   - CONTEXTUAL: both are true but in different contexts
4. Severity:
   - HIGH: critical fact (pricing, SLA, contractual commitments)
   - MEDIUM: important but not critical (metric, feature description)
   - LOW: minor detail (wording, emphasis)

Output JSON only:
{
  "has_contradiction": true | false,
  "contradictory_claims": {
    "from_a": "exact claim from fragment A",
    "from_b": "exact claim from fragment B"
  } or null,
  "type": "FACTUAL" | "SCOPE" | "TEMPORAL" | "CONTEXTUAL" or null,
  "severity": "HIGH" | "MEDIUM" | "LOW" or null,
  "reasoning": "Explanation"
}
```

### Modèle de données

```sql
CREATE TABLE contradictions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fragment_a_id TEXT NOT NULL,
  fragment_b_id TEXT NOT NULL,
  contradiction_type TEXT,  -- FACTUAL | SCOPE | TEMPORAL | CONTEXTUAL
  severity TEXT,  -- HIGH | MEDIUM | LOW
  claim_a TEXT,
  claim_b TEXT,
  llm_reasoning TEXT,
  status TEXT DEFAULT 'unresolved',  -- 'unresolved' | 'resolved_keep_a' | 'resolved_keep_b' | 'resolved_contextual' | 'resolved_merged' | 'ignored'
  created_at INTEGER,
  resolved_at INTEGER,
  resolved_by TEXT,
  resolution_note TEXT,

  FOREIGN KEY (fragment_a_id) REFERENCES fragments(id),
  FOREIGN KEY (fragment_b_id) REFERENCES fragments(id)
);
```

### UI admin "Contradictions à résoudre"

```
Contradictions détectées : 5 HIGH · 12 MEDIUM · 23 LOW

[HIGH] Twake Mail SLA
═══════════════════════════════════════════════════
Fragment A (2026-01-15) :
"Notre SLA standard garantit 99,5% de disponibilité mensuelle."

Fragment B (2026-04-20) :
"Notre SLA contractualise 99,9% de disponibilité avec dédommagement."

Type : FACTUAL | Sévérité : HIGH

LLM reasoning :
"Both fragments claim to describe Twake Mail SLA but state different
availability targets (99.5% vs 99.9%). This is critical business info."

Actions :
[Garder A] [Garder B] [Marquer contextuel] [Fusionner] [Ignorer]

Note de résolution : ___________________________________________
```

### Actions possibles

**Garder A** :

- B est marqué `status: 'incorrect'`, retiré des sélections
- Trace conservée pour audit

**Garder B** :

- Inverse

**Marquer contextuel** :

- Les 2 fragments restent actifs
- Ajout d'un champ `contextual_validity` expliquant le contexte de chacun
- Le LLM judge prend ça en compte au moment de la sélection

**Fusionner** :

- Création d'un nouveau fragment qui réconcilie les 2
- A et B archivés
- Trace de la fusion conservée

**Ignorer** :

- La contradiction est marquée comme résolue sans action
- Utile pour les faux positifs du LLM judge

### Coût et performance

Pour chaque ingestion :

- Filtrage des candidats : ~50ms (SQL + cosine local)
- LLM judge sur 20 candidats : 20 × 2000 tokens = 40k tokens
- Coût : ~4 centimes par ingestion

Acceptable pour l'usage Linagora (quelques ingestions par jour).

---

## 14. Skills OpenCode (3 skills minimum viable)

### Périmètre

Paul voulait initialement faire la démo principale en OpenCode. **Décision finale** : démo principale en UI, OpenCode en bonus de démo.

**3 skills max** pour ne pas disperser :

### Skill 1 : `/fragmint plan`

Génère un plan structuré à partir d'un brief.

**Usage** :

```
/fragmint plan
```

Claude demande le brief, puis génère un plan structuré similaire à ce que fait l'UI. Itération possible : "ajoute une section sur la sécurité", "déplace 3 avant 2", etc.

**Output** : plan markdown sauvegardé localement, ID du plan retourné.

### Skill 2 : `/fragmint compose`

Récupère les fragments pour un plan et génère les drafts.

**Usage** :

```
/fragmint compose plan_abc123
```

Workflow :

1. Skill récupère le plan via API Fragmint
2. Pour chaque section, appelle l'endpoint de retrieval (mode courant)
3. Présente les fragments candidats avec scores
4. L'utilisateur valide / modifie via Claude Code
5. Génère les drafts de chaque section

**Output** : drafts markdown par section, prêts à être validés.

### Skill 3 : `/fragmint export`

Export final.

**Usage** :

```
/fragmint export doc_abc123 docx
```

Appelle l'API Fragmint pour assembler le doc final dans le format demandé (`docx`, `pptx`, `md`, `pdf`).

**Output** : fichier téléchargé localement.

### Architecture

```
~/.opencode/
├── fragmint.skill/
│   ├── SKILL.md
│   ├── plan.sh
│   ├── compose.sh
│   ├── export.sh
│   └── lib/
│       ├── api-client.ts
│       ├── cache.ts        # cache local des fragments pour économiser tokens
│       └── auth.ts
```

### Cache local

Pour économiser les tokens lors de l'usage OpenCode (qui appelle le LLM en boucle) :

- Cache local de l'index.md (refresh toutes les 5 min)
- Cache local des fragments approved (refresh toutes les 30 min)
- Stockés dans `~/.opencode/fragmint.cache/`

### Authentification

JWT token Fragmint stocké dans `~/.opencode/fragmint.auth`. Renouvelé automatiquement avant expiration.

### Effort estimé

- Skill 1 (plan) : 1 jour
- Skill 2 (compose) : 1 jour
- Skill 3 (export) : 0.5 jour
- Cache et auth : 0.5 jour

**Total : 3 jours**.

---

## 15. Migration LLM via OpenRouter

### Architecture

OpenRouter permet de router les appels LLM vers différents fournisseurs avec une API unifiée.

```typescript
// packages/server/src/llm/client.ts
export interface LLMClient {
  complete(prompt: string, options?: LLMOptions): Promise<string>;
  embed(text: string): Promise<number[]>;
}

class OpenRouterClient implements LLMClient {
  constructor(
    private apiKey: string,
    private model: string = 'anthropic/claude-sonnet-4',
  ) {}

  async complete(prompt: string, options?: LLMOptions): Promise<string> {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        ...options,
      }),
    });
    const data = await response.json();
    return data.choices[0].message.content;
  }

  async embed(text: string): Promise<number[]> {
    // Pour les embeddings on garde Ollama local
    return ollamaEmbed(text);
  }
}
```

### Configuration

```env
LLM_PROVIDER=openrouter  # 'ollama' | 'openrouter' | 'mistral-api'
LLM_MODEL=anthropic/claude-sonnet-4
OPENROUTER_API_KEY=sk-or-v1-...
```

### Discours souverain pour Maudet

**À mentionner explicitement** lors de la démo :

> "Pour la démo, on utilise Claude Sonnet via OpenRouter pour la qualité maximale. En production, le système bascule sur **Mistral Large** via l'API Mistral, qui est française et souveraine. La bascule se fait via une variable d'environnement, le code est agnostique."

### Comparaison des modèles à benchmarker

| Modèle           | Provider                 | Souverain | Qualité   | Coût | Latence |
| ---------------- | ------------------------ | --------- | --------- | ---- | ------- |
| Claude Sonnet 4  | Anthropic via OpenRouter | Non       | Excellent | $$$  | Faible  |
| Claude Haiku 4.5 | Anthropic via OpenRouter | Non       | Très bon  | $    | Faible  |
| Mistral Large    | Mistral AI (FR)          | Oui       | Très bon  | $$   | Faible  |
| GPT-4o           | OpenAI via OpenRouter    | Non       | Excellent | $$$  | Faible  |
| Mistral-nemo:12b | Ollama local             | Oui       | Moyen     | $0   | Moyen   |
| Llama 3.3 70B    | Various                  | Variable  | Bon       | $    | Moyen   |

**Recommandation démo** : Claude Sonnet 4 (qualité)  
**Recommandation dev** : Claude Haiku 4.5 (économique pour itérations)  
**Recommandation prod** : Mistral Large (souveraineté + qualité)  
**Fallback offline** : mistral-nemo:12b (souverain + gratuit)

### Estimation coût mission

- Phase 1 : ré-ingestion de ~50 fragments × 3800 tokens × $3/Mtoken = $0.60
- Tests retrieval : ~100 appels LLM judge × 5000 tokens = $1.50
- Démo répétitions : ~5 cycles complets × $5 = $25
- **Total estimé : $30-50 sur 20 jours**

Raisonnable. Activer le prompt caching côté Anthropic pour économiser ~80% sur les répétitions.

---

## 16. Curation manuelle backend du corpus

### Pourquoi pas dans l'UI

Lors de la réunion, décision claire : **la validation/correction massive des fragments mal classés se fait en backend**, pas via l'UI :

- L'UI serait lente pour modifier 30-50 fragments
- Besoin de batch operations
- C'est du travail "ops" pas "user"
- Le code écrit serait jeté après la mission

### Script TypeScript de curation

```typescript
// scripts/reclassify-fragments.ts

interface FragmentFix {
  id: string;
  subject?: string;
  function?: string;
  type?: string;
  audience?: string[];
  maturity?: string;
  tags?: string[];
  entities?: Record<string, string[]>;
}

const FRAGMENTS_TO_FIX: FragmentFix[] = [
  {
    id: 'abc-123',
    subject: 'twake-mail',
    function: 'commercial',
    type: 'pricing',
    audience: ['decideur', 'juridique'],
    tags: ['tarification', 'engagement', 'sla'],
  },
  {
    id: 'def-456',
    subject: 'linshare',
    function: 'technical',
    type: 'argument',
    entities: {
      certifications: ['SecNumCloud'],
      technologies: ['Apache James'],
    },
  },
  // ... 30-50 fragments
];

async function applyFix(fix: FragmentFix): Promise<void> {
  const response = await fetch(`http://localhost:3210/v1/fragments/${fix.id}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${process.env.FRAGMINT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(fix),
  });
  if (!response.ok) {
    console.error(`Failed to fix ${fix.id}:`, await response.text());
  } else {
    console.log(`✓ Fixed ${fix.id}`);
  }
}

async function main() {
  for (const fix of FRAGMENTS_TO_FIX) {
    await applyFix(fix);
    await new Promise((r) => setTimeout(r, 100)); // throttle
  }
}

main();
```

### Identification des fragments à corriger

Approche manuelle structurée :

1. Parcours rapide de l'UI fragments (filter par `domain=other` et `type=other`)
2. Pour chaque fragment problématique : lecture rapide + décision de la bonne classification
3. Ajout dans le script `FRAGMENTS_TO_FIX`
4. Exécution du script
5. Vérification dans l'UI

**Estimation** : 1-2h de curation attentive pour 30-50 fragments.

### Notes de patterns d'erreur

Pendant la curation, **noter les patterns d'erreur récurrents** pour :

1. Guider la sélection des few-shot examples (sélectionner ceux qui couvrent les patterns difficiles)
2. Alimenter la synthèse stratégique pour Maudet ("limites observées et recommandations")
3. Préparer la roadmap V2

Exemples de patterns observés sur Fragmint actuel :

- "Le LLM met `technical` au lieu de `legal` quand vocabulaire juridique mêlé à technique"
- "Le LLM met `other` au lieu de `twake` quand le nom du produit n'est pas explicitement mentionné"
- "Le LLM confond `argument` et `description` pour les fragments commerciaux"

---

## 17. UI admin via Claude Design (artifacts React)

### Stratégie globale

Pour les nouvelles UIs admin (Metadata, Relations, Remplacements, Contradictions, Knowledge Graph, Users, Collections), passer par **Claude Design** (artifacts React générés par Claude) plutôt que de développer from scratch.

### Architecture page /admin

```
/admin
├── Tabs : [Métadonnées] [Relations] [Remplacements] [Contradictions] [Utilisateurs] [Collections]
└── Knowledge Graph (vue séparée ou sub-tab)
```

### Avantages

- **Rapidité** : artifacts générés en 30 min vs jours de dev
- **Polish** : design moderne par défaut
- **Itération** : ajustements rapides via discussions Claude
- **Réutilisable** : composants intégrables dans l'UI principale

### Packages livrés et à venir

Pour faciliter l'intégration par Claude Code, chaque sous-système admin fait l'objet d'un **package complet** (spec + DB migrations Drizzle + endpoints API + composants React) :

| Package | Statut | Description |
|---------|--------|-------------|
| `FRAGMINT_ADMIN_METADATA_PACKAGE.md` | ✅ Livré + intégré | Tab Métadonnées sous-tab "À valider" : validation Tags/Entities/Domains émergents proposés par le LLM |
| `FRAGMINT_ADMIN_SUPERSEDURE_PACKAGE.md` | ✅ Livré (intégration en cours) | Tab Supersedure : validation des propositions de remplacement avec diff visuel + détection auto à l'ingestion |
| `FRAGMINT_ADMIN_TRUST_BY_SOURCE_PACKAGE.md` | ✅ Livré | Mécanisme transverse : formulaire upload enrichi avec hints, calcul trust_source par métadonnée, queue admin filtrée, page débriefing post-ingestion. **Réduit la charge admin de ~50%.** |
| `FRAGMINT_ADMIN_REFERENTIAL_PACKAGE.md` | 📝 À faire | Sous-tab "Référentiel" dans Metadata : catalogue des items validés (subjects/tags/entities) avec usage_count, actions de maintenance (rename/archive/restore), heatmap de co-occurrence subject × entities |
| `FRAGMINT_ADMIN_INBOX_PACKAGE.md` | 📝 À faire | Tab "Inbox" en tête de sidebar : vue unifiée des tâches en attente, agrège tous les autres packages |
| `FRAGMINT_ADMIN_RELATIONS_PACKAGE.md` | 📝 À faire | Tab Relations : validation des relations explicites typées (`details`, `exemplified_by`, `priced_by`) |
| `FRAGMINT_ADMIN_CONTRADICTIONS_PACKAGE.md` | 📝 À faire | Tab Contradictions : résolution des contradictions sémantiques |
| `FRAGMINT_ADMIN_KNOWLEDGE_GRAPH_PACKAGE.md` | 📝 V1 — à faire | Knowledge graph visuel interactif (react-flow). Accessible via tab dédié dans la sidebar + boutons contextuels depuis fragments et entities. Trois modes selon Milvus (nominal / dégradé / bootstrap). Cf section 11bis du plan. |
| `FRAGMINT_ADMIN_USERS_COLLECTIONS_PACKAGE.md` | 📝 À faire | Gestion utilisateurs + collections |

### Architecture cible de la sidebar admin (V3)

```
/admin
├── Inbox [NOUVEAU - package Inbox]
│   └── Vue unifiée agrégée de toutes les tâches en attente
│
├── Metadata [LIVRÉ + ÉVOLUTION]
│   ├── Toggle "À valider" (livré) — queue de validation filtrée par trust_source
│   └── Toggle "Référentiel" (à faire) — catalogue + maintenance
│
├── Relations [à faire]
├── Supersedure [livré]
├── Contradictions [à faire]
├── Knowledge Graph   [V1 - NOUVEAU]
│   └── Accessible aussi via boutons contextuels :
│       - "Voir dans le graph" depuis fragment detail
│       - "Explorer le cluster" depuis entity detail
├── Users [existant]
└── Collections [existant]
```

### Workflow d'intégration recommandé

1. **Préparation specs** ✅ (Juliette, fin semaine 1)
2. **Package Metadata** ✅ intégré par Claude Code
3. **Package Supersedure** 🔄 en cours d'intégration
4. **Package Trust by Source** 📝 à intégrer après Supersedure (transverse, modifie le flow d'upload)
5. **Package Référentiel** 📝 à intégrer après Trust by Source (s'appuie sur le trust_source pour distinguer human vs llm)
6. **Knowledge Graph** 📝 (V1 — visualisation, exploration corpus)
7. **Packages Relations + Contradictions** 📝 (ordre indifférent)
8. **Package Inbox** 📝 à intégrer en dernier (agrège tous les autres)

### UIs à générer (récap fonctionnel)

#### UI 1 : Tab Métadonnées (livré)

Validation des Tags / Entities / Subjects proposés par le LLM. Actions : approve, rename, merge, convert tag → entity, set as alias, reclassify entity type, reject. Bulk actions disponibles.

#### UI 2 : Knowledge Graph

Visualisation interactive du graphe de fragments.

**Spec attendue** :

- Bibliothèque : cytoscape.js ou react-flow
- Nœuds : un par fragment, colorés par `subject`
- Edges : 2 styles (implicites gris fin, explicites typées en couleur)
- Filtres : par subject, function, entity, status
- Interactions : zoom, pan, click pour détail, hover pour preview
- Layout : force-directed par défaut, hierarchical si demandé
- **Périmètre** : fragments `approved` uniquement (cf section 11)

#### UI 3 : Tab Remplacements (livré)

Vue de validation des propositions de supersedure avec :

- Liste des propositions en `pending`
- Diff côte à côte des 2 fragments
- Alerte "elements may be lost" si LLM détecte des éléments perdus
- Actions : Confirmer le remplacement / Coexister / Rejeter / Éditer B avant confirmation
- Sub-tabs : Tous / Haute confiance / À vérifier

#### UI 4 : Tab Contradictions

Vue de résolution des contradictions détectées.

**Spec attendue** :

- Liste par sévérité (HIGH / MEDIUM / LOW)
- Pour chaque : claims contradictoires extraits, type, reasoning LLM
- Actions : Garder A / Garder B / Marquer contextuel / Fusionner / Ignorer
- Champ de note de résolution

#### UI 5 : Tab Relations

Validation des relations explicites typées (`details`, `exemplified_by`, `priced_by`) proposées par le LLM.

**Spec attendue** :

- Liste des propositions de relations en attente
- Pour chaque : 2 fragments concernés + type de relation + reasoning
- Actions : Confirmer / Rejeter / Modifier le type

#### UI 6 : Tabs Utilisateurs et Collections

Gestion système : CRUD utilisateurs avec rôles, gestion des collections, gestion des API tokens.

#### UI 7 : Vue fragment détaillée enrichie

Refonte de la vue détail d'un fragment avec toutes les nouvelles métadonnées.

**Spec attendue** :

- Header : titre, status, dates
- Tabs : Content, Metadata, Relations, History, Contradictions
- Vue Relations : liste des fragments liés avec type
- Vue Contradictions : alertes si contradictions non résolues

### Documents à préparer pour Claude Design

#### Doc 1 — Architecture des données

Schéma complet des entités et leurs champs (cf section 19).

#### Doc 2 — Captures d'écran UI existante

Pour conserver le style visuel :

- Page liste fragments
- Page détail fragment
- Page validation
- Page composition
- Couleurs/typography Fragmint actuels

#### Doc 3 — Spécifications fonctionnelles par UI

Pour chaque UI, un mini-spec avec :

- Wireframe textuel
- Workflows attendus
- Interactions clés

### Workflow d'intégration

1. **Préparation specs** (Juliette, fin semaine 1)
2. **Génération artifacts** (sessions avec Claude, semaine 2)
3. **Validation visuelle** (Juliette + Paul, semaine 2-3)
4. **Intégration dans l'UI Fragmint via Claude Code** (semaine 3) — utiliser les packages livrés
5. **Polish** (Juliette + Paul, fin semaine 3)

---


## 18. Cas de validation réel : marché public IRA

### Documents du cas IRA

1. **`01_-_Expression_de_besoin_Messagerie__P18__-_V2.docx`** : cahier des charges IRA (369 lignes)
2. **`02_-_plan_cible_de_taille__et_retravaille_.md`** : plan élaboré à la main (73 lignes)
3. **`03_-_fragments_se_lectionne_s_a__la_main_pour_IRA.docx`** : fragments choisis manuellement
4. **`04_-_md_obtenu_a__transformer_en_docx.md`** : doc final markdown (503 lignes)
5. **`05_-_Proposition_IRA_finale.docx`** : document final livré

### Analyse du workflow de l'auteur

L'auteur a passé **plusieurs heures** sur ce document :

1. Lecture et analyse du cahier des charges (1-2h)
2. Élaboration du plan ciblé à la main (1h)
3. Recherche et sélection manuelle des fragments dans la base (2-3h)
4. Itération avec Claude pour générer le doc final (1h)
5. Polish et validation (1h)

**Total estimé : 6-8h de travail expert.**

### Métadonnées implicites observées dans les fragments réutilisés

En analysant les fragments choisis, on identifie :

**Entités clients** : IRA, DGAFP, Sesam-Vitale, État Mauricien, CNB  
**Produits Linagora** : Twake Mail, Twake Calendar, Twake Drive, OBM, LinShare  
**Technologies** : Apache James, JMAP, IMAP, Matrix, CalDAV, LemonLDAP, Cassandra, PostgreSQL, ClamAV, RspamD  
**Certifications** : SecNumCloud, RGPD  
**Partenaires** : Cloud Temple, DINUM, Tchap  
**Régulations** : Cloud Act, FISA, RGPD  
**Métriques** : 5M emails/j, 99.5% SLA, 50% réduction réseau

### Types de contenu réutilisés

- **Description produit** (fonctionnalités Twake Mail) : repris quasi tel quel
- **Référence client** (CNB, Maurice) : adapté au contexte IRA
- **Argument technique** (JMAP vs IMAP) : repris tel quel
- **Argument différenciant** (open source réel sans dual licensing) : repris tel quel
- **Chiffre clé** (5M emails/j) : repris pour appuyer la volumétrie IRA
- **Engagement contractuel** (RPO < 1h, RTO < 4h) : repris du cahier des charges
- **Témoignage** (références sectorielles) : sélectionné selon le secteur public

### Critères de sélection observés

Les fragments ont été sélectionnés selon :

1. **Subject match** : tous les fragments sont sur Twake Mail / Calendar / Drive
2. **Function match** : technique pour la section archi, stratégique pour les arguments
3. **Audience match** : technique pour DSI, decideur pour la synthèse exec
4. **Volumétrie comparable** : fragments mentionnant 1000+ users prioritaires
5. **Certifications attendues** : fragments mentionnant SecNumCloud, RGPD
6. **Hébergement on-premise** : fragments compatibles avec ce mode

### Implications pour Fragmint

Pour reproduire automatiquement ce travail, le système doit :

1. **Comprendre le contexte du cahier des charges** :
   - Extraire les entités attendues (certifications, volumétrie, hébergement)
   - Identifier le secteur (administration publique)
   - Identifier les contraintes calendaires

2. **Sélectionner les fragments avec critères enrichis** :
   - Boost si entités matchent (SecNumCloud, RGPD)
   - Boost si volumétrie comparable
   - Boost si secteur match
   - Filter `maturity = production` (pas de roadmap)

3. **Composer cohéremment** :
   - Enchainer les fragments selon les relations explicites (intro → details → reference)
   - Adapter au contexte IRA (remplacer "Sesam-Vitale 5M emails" par "applicable à votre besoin IRA")

### Métriques de validation

Pour la démo, comparer le doc généré par Fragmint avec le doc final de référence :

- **Similarité de structure** : viser >90% (plan identique)
- **Fragments réutilisés** : viser >75% communs
- **Adaptation contextuelle** : visible dans les passages mentionnant IRA spécifiquement
- **Cohérence factuelle** : zéro contradiction (grâce à la détection)

**Punchline démo** : "L'auteur a passé 6 heures, Fragmint le fait en 20 minutes avec la même qualité."

---

## 19. Schéma de base de données cible

### Migrations à prévoir

```sql
-- ============================================================
-- Migration 001 : Refonte métadonnées fragments
-- ============================================================

-- Renommer domain en subject + ajouter function
ALTER TABLE fragments RENAME COLUMN domain TO subject;
ALTER TABLE fragments ADD COLUMN function TEXT;
ALTER TABLE fragments ADD COLUMN audience TEXT;  -- JSON array
ALTER TABLE fragments ADD COLUMN maturity TEXT DEFAULT 'production';

-- Status enrichi
ALTER TABLE fragments ADD COLUMN superseded_by TEXT REFERENCES fragments(id);
ALTER TABLE fragments ADD COLUMN supersedes TEXT REFERENCES fragments(id);

CREATE INDEX idx_fragments_subject_function ON fragments(subject, function);
CREATE INDEX idx_fragments_maturity ON fragments(maturity);
CREATE INDEX idx_fragments_superseded ON fragments(superseded_by);

-- ============================================================
-- Migration 002 : Entités nommées
-- ============================================================

CREATE TABLE entities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,  -- 'client' | 'product' | 'technology' | 'partner' | 'certification' | 'regulation' | 'metric'
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,  -- lowercase, no special chars pour recherche
  created_at INTEGER NOT NULL,
  validated BOOLEAN DEFAULT 0,  -- 0 = LLM-proposed, 1 = admin-validated

  UNIQUE(type, normalized_name)
);

CREATE INDEX idx_entities_type_name ON entities(type, normalized_name);

CREATE TABLE fragment_entities (
  fragment_id TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  PRIMARY KEY (fragment_id, entity_id),
  FOREIGN KEY (fragment_id) REFERENCES fragments(id) ON DELETE CASCADE,
  FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE
);

-- ============================================================
-- Migration 003 : Relations entre fragments
-- ============================================================

CREATE TABLE fragment_relations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_fragment_id TEXT NOT NULL,
  to_fragment_id TEXT NOT NULL,
  relation_type TEXT NOT NULL CHECK(relation_type IN ('details', 'exemplified_by', 'priced_by')),
  created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  confidence REAL,
  validated_at INTEGER,
  validated_by TEXT,

  FOREIGN KEY (from_fragment_id) REFERENCES fragments(id) ON DELETE CASCADE,
  FOREIGN KEY (to_fragment_id) REFERENCES fragments(id) ON DELETE CASCADE,
  UNIQUE(from_fragment_id, to_fragment_id, relation_type)
);

CREATE INDEX idx_relations_from ON fragment_relations(from_fragment_id);
CREATE INDEX idx_relations_to ON fragment_relations(to_fragment_id);

-- ============================================================
-- Migration 004 : Supersedure proposals
-- ============================================================

CREATE TABLE supersedure_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  new_fragment_id TEXT NOT NULL,
  old_fragment_id TEXT NOT NULL,
  similarity_score REAL,
  llm_judgment TEXT,
  llm_confidence REAL,
  llm_reasoning TEXT,
  elements_lost_in_new TEXT,  -- JSON array
  status TEXT DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  resolved_at INTEGER,
  resolved_by TEXT,

  FOREIGN KEY (new_fragment_id) REFERENCES fragments(id),
  FOREIGN KEY (old_fragment_id) REFERENCES fragments(id)
);

CREATE INDEX idx_supersedure_status ON supersedure_proposals(status);

-- ============================================================
-- Migration 005 : Contradictions
-- ============================================================

CREATE TABLE contradictions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fragment_a_id TEXT NOT NULL,
  fragment_b_id TEXT NOT NULL,
  contradiction_type TEXT,
  severity TEXT,
  claim_a TEXT,
  claim_b TEXT,
  llm_reasoning TEXT,
  status TEXT DEFAULT 'unresolved',
  created_at INTEGER NOT NULL,
  resolved_at INTEGER,
  resolved_by TEXT,
  resolution_note TEXT,

  FOREIGN KEY (fragment_a_id) REFERENCES fragments(id) ON DELETE CASCADE,
  FOREIGN KEY (fragment_b_id) REFERENCES fragments(id) ON DELETE CASCADE
);

CREATE INDEX idx_contradictions_status ON contradictions(status);
CREATE INDEX idx_contradictions_severity ON contradictions(severity);

-- ============================================================
-- Migration 006 : Tags améliorés
-- ============================================================

CREATE TABLE tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  category TEXT,  -- 'technical' | 'commercial' | 'sector' | 'free'
  validated BOOLEAN DEFAULT 0,
  usage_count INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- La table fragment_tags existante peut être conservée mais
-- on ajoute une référence vers la table tags si on veut la centraliser

-- ============================================================
-- Migration 007 : Index metadata
-- ============================================================

CREATE TABLE index_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Exemples de keys :
-- 'last_generated_at', 'total_fragments', 'total_approved', 'schema_version'
```

### Note sur la suppression de valid_from / valid_until

Suite à la décision de simplification temporelle (section 5), les colonnes `valid_from` et `valid_until` sont **conservées pour rétrocompatibilité** mais ne sont plus utilisées activement en V1. Le retrieval ne les considère plus.

Migration optionnelle V2 :
```sql
-- Si on veut nettoyer définitivement
ALTER TABLE fragments DROP COLUMN valid_from;
ALTER TABLE fragments DROP COLUMN valid_until;
```

Pour V1, on laisse les colonnes pour ne pas casser de migrations. Le code les ignore simplement.

### Schéma Fragment cible (TypeScript)

```typescript
interface Fragment {
  id: string;
  title: string;
  body: string;

  // Métadonnées principales (7 axes)
  subject: SubjectEnum; // twake-mail | lincloud | ...
  function: FunctionEnum; // technical | commercial | ...
  type: TypeEnum; // introduction | argument | ...
  audience: AudienceEnum[]; // ['decideur', 'technique']
  maturity: MaturityEnum; // production | beta | roadmap | archive
  lang: string;
  tags: string[];

  // Entités liées (via fragment_entities)
  entities: {
    clients: string[];
    products: string[];
    technologies: string[];
    partners: string[];
    certifications: string[];
    regulations?: string[];
    metrics?: string[];
  };

  // Status
  status: 'draft' | 'reviewed' | 'approved' | 'archived' | 'incorrect';
  superseded_by: string | null;
  supersedes: string | null;

  // Validity (déprécié V1, gardé pour compat)
  valid_from?: Date;
  valid_until?: Date;

  // Timestamps
  created_at: Date;
  updated_at: Date;

  // Source
  source_document_id?: string;
  source_page?: number;

  // Quality
  confidence_score?: number; // 0-1, de la classification LLM
}

interface FragmentRelation {
  id: number;
  from_fragment_id: string;
  to_fragment_id: string;
  relation_type: 'details' | 'exemplified_by' | 'priced_by';
  created_at: Date;
  created_by: string; // 'llm-auto' | 'admin:username'
  confidence?: number;
  validated_at?: Date;
  validated_by?: string;
}
```

---

## 20. Prompts complets pour chaque opération LLM

### 20.1 Classification étape 1 : Subject + Function

```typescript
const CLASSIFY_SUBJECT_FUNCTION_PROMPT = `
You are classifying a content fragment from a document.

# Fragment to classify
Title: {title}
Body:
{body}

# Available subjects (choose ONE)
- twake-mail: Twake Mail messaging product
- twake-calendar: Twake Calendar product
- twake-drive: Twake Drive file sharing
- twake-chat: Twake Chat instant messaging
- linshare: LinShare secure file sharing
- lincloud: LinCloud sovereign cloud platform
- linto: LinTO voice/AI assistant
- openrag: OpenRAG retrieval-augmented generation
- linagora-corp: Linagora as a company (history, references, certifications)
- other: doesn't fit above (suggest a new value)

# Available functions (choose ONE)
- technical: architecture, deployment, integration details
- commercial: offers, pricing, commitments, value proposition
- legal: clauses, compliance, regulatory aspects
- operational: support, SLA, maintenance, procedures
- strategic: vision, positioning, roadmap, partnerships
- reference: client testimonial, case study, success story

# Few-shot examples

## Example 1
Title: "Twake Mail SLA standard"
Body: "Notre SLA standard garantit 99.5% de disponibilité mensuelle..."
Classification: { "subject": "twake-mail", "function": "commercial" }

## Example 2
Title: "Architecture Apache James"
Body: "Le backend utilise le serveur Apache James, dont Linagora est mainteneur..."
Classification: { "subject": "twake-mail", "function": "technical" }

## Example 3
Title: "Référence CNB - 17 000 avocats"
Body: "Le Conseil National des Barreaux utilise notre solution depuis 2023..."
Classification: { "subject": "linagora-corp", "function": "reference" }

# Your task
Classify the fragment by subject AND function.

Output JSON only:
{
  "subject": "subject_value",
  "function": "function_value",
  "confidence": 0.0-1.0,
  "subject_new_proposed": null | "new_subject_name_if_other"
}
`;
```

### 20.2 Classification étape 2 : Type + Entities

```typescript
const CLASSIFY_TYPE_ENTITIES_PROMPT = `
You are classifying the rhetorical type of a fragment AND extracting named entities.

# Fragment
Title: {title}
Subject: {subject_from_step1}
Function: {function_from_step1}
Body:
{body}

# Available types (choose ONE)
- introduction: opening/overview text
- argument: persuasive claim or differentiator
- description: factual product/feature description
- pricing: prices, tariffs, conditions
- clause: contractual or legal clause
- faq: question/answer format
- conclusion: closing statement, synthesis
- bio: author/team biography
- temoignage: client testimonial
- reference-technique: technical specification
- methodology: process or methodology description
- engagement: contractual commitment (SLA, deliverables)
- cas-usage: use case description

# Entity extraction
Extract all named entities mentioned in the fragment, categorized:
- clients: organizations using Linagora products (e.g., "CNB", "État Mauricien")
- products: Linagora or competitor products (e.g., "Twake Mail", "Microsoft Exchange")
- technologies: technical components (e.g., "JMAP", "Cassandra", "Kubernetes")
- partners: companies partnering with Linagora (e.g., "Cloud Temple", "DINUM")
- certifications: security/quality certifications (e.g., "SecNumCloud", "ISO27001")
- regulations: laws, regulations mentioned (e.g., "RGPD", "Cloud Act")

# Few-shot examples

## Example 1
Body: "Twake Mail s'engage sur un SLA de 99.5% mensuel, avec dédommagement..."
{ "type": "engagement", "entities": { "products": ["Twake Mail"] } }

## Example 2
Body: "Le Conseil National des Barreaux (CNB) utilise Twake Mail depuis 2023 pour 17 000 avocats..."
{
  "type": "temoignage",
  "entities": {
    "clients": ["Conseil National des Barreaux", "CNB"],
    "products": ["Twake Mail"]
  }
}

# Your task
Classify the type and extract all entities.

Output JSON only:
{
  "type": "type_value",
  "entities": {
    "clients": [],
    "products": [],
    "technologies": [],
    "partners": [],
    "certifications": [],
    "regulations": []
  },
  "confidence": 0.0-1.0
}
`;
```

### 20.3 Classification étape 3 : Audience + Maturity + Tags

```typescript
const ENRICH_METADATA_PROMPT = `
You are enriching a fragment's metadata with audience targeting, maturity, and tags.

# Fragment context
Title: {title}
Subject: {subject}
Function: {function}
Type: {type}
Body:
{body}

# Audience (choose ALL that apply)
- technique: technical staff (sysadmin, DevOps, architects)
- decideur: decision makers (managers, executives, buyers)
- utilisateur: end users
- juridique: legal/compliance teams

# Maturity (choose ONE)
- production: feature/product currently in production, ready to deploy
- beta: feature/product in beta, available with caveats
- roadmap: feature/product planned but not yet available
- archive: outdated content, kept for historical reference

# Tags
Suggest 3-7 free-form tags that capture key themes not covered by other metadata.
Prefer existing tags from this list when applicable:
{existing_tags_list}

You can also propose NEW tags that don't exist yet.

# Few-shot examples

## Example 1
Subject: twake-mail, Function: commercial, Type: pricing
Body: "Pricing Twake Mail 2026: Standard 4.50€/user/month..."
{
  "audience": ["decideur", "juridique"],
  "maturity": "production",
  "tags": ["tarification", "engagement", "souverain"]
}

# Your task
Enrich the metadata.

Output JSON only:
{
  "audience": [],
  "maturity": "maturity_value",
  "tags": [],
  "new_tags_proposed": []
}
`;
```

### 20.4 Détection de relations

```typescript
const DETECT_RELATIONS_PROMPT = `
You are analyzing a new fragment to detect relationships with existing fragments.

# New fragment
ID: {new_id}
Title: {new_title}
Subject: {subject}
Type: {type}
Body:
{new_body}

# Potentially related fragments
{candidate_fragments_summary}

# Relation types
- "details": the new fragment elaborates/details an existing one (or vice versa)
- "exemplified_by": one fragment makes a claim, the other illustrates with a real example
- "priced_by": one fragment describes a product/feature, the other provides its pricing

# Your task
Detect relationships between the new fragment and existing ones.
Only suggest relations with confidence >= 0.7.

Output JSON only:
{
  "relations": [
    {
      "from": "new_id_or_existing_id",
      "to": "the_other_id",
      "type": "details" | "exemplified_by" | "priced_by",
      "confidence": 0.0-1.0,
      "reason": "Brief explanation"
    }
  ]
}
`;
```

### 20.5 Détection de supersedure

```typescript
const SUPERSEDURE_JUDGE_PROMPT = `
You are evaluating whether fragment B should replace fragment A.

# Fragment A (existing, dated {date_a})
Title: {title_a}
Body:
{body_a}

# Fragment B (new, dated {date_b})
Title: {title_b}
Body:
{body_b}

# Your task
Evaluate:
1. Does B cover the same topic as A?
2. Does B contain more recent/updated information than A?
3. Are there elements in A that are absent from B (would be lost)?
4. Recommendation:
   - SUPERSEDE: B fully replaces A, A should be archived
   - COEXIST: Both are valid, possibly in different contexts
   - DIFFERENT_TOPIC: They're not actually about the same thing

Output JSON only:
{
  "recommendation": "SUPERSEDE" | "COEXIST" | "DIFFERENT_TOPIC",
  "confidence": 0.0-1.0,
  "reasoning": "Detailed explanation",
  "elements_lost_in_b": ["element 1", "element 2"] or null
}
`;
```

### 20.6 Détection de contradictions

```typescript
const CONTRADICTION_JUDGE_PROMPT = `
You are comparing two fragments for potential factual contradictions.

# Fragment A (dated {date_a})
{body_a}

# Fragment B (dated {date_b})
{body_b}

# Your task
Determine:
1. Is there a factual contradiction between A and B?
2. If yes, what specific claims are contradictory?
3. Type of contradiction:
   - FACTUAL: different numbers, dates, facts
   - SCOPE: one says "always", the other says "sometimes"
   - TEMPORAL: one is more recent and corrects the other
   - CONTEXTUAL: both could be true in different contexts
4. Severity:
   - HIGH: critical fact (pricing, SLA, contractual commitments)
   - MEDIUM: important but not critical (metric, feature description)
   - LOW: minor detail (wording, emphasis)

Output JSON only:
{
  "has_contradiction": true | false,
  "contradictory_claims": {
    "from_a": "exact claim from fragment A",
    "from_b": "exact claim from fragment B"
  } or null,
  "type": "FACTUAL" | "SCOPE" | "TEMPORAL" | "CONTEXTUAL" or null,
  "severity": "HIGH" | "MEDIUM" | "LOW" or null,
  "reasoning": "Explanation"
}
`;
```

### 20.7 Phase 1 retrieval (mode agentic-only)

Voir section 9 pour le prompt complet.

### 20.8 Phase 2 retrieval (LLM as judge)

Voir section 9 pour le prompt complet.

### 20.9 Génération de l'index.md

```typescript
const GENERATE_INDEX_PROMPT = `
You are generating a structured index of content fragments for a knowledge base.

# Fragments to index
{fragments_with_metadata}

# Format
Generate a markdown file with this structure:

---
generated_at: {iso_timestamp}
total_fragments: {count}
total_approved: {count_approved}
schema_version: 1
---

# Fragments Index

## By Subject × Function
(group by subject, then function, list approved first then reviewed)

## By Entity
(group by entity type, list fragments mentioning each entity)

## By Status
(currently active approved, superseded, archived)

## Recently Added (last 7 days)

# Your task
Generate the complete index markdown.

For each fragment, include:
- ID (in [brackets])
- Title (bold)
- Type, audience, maturity (italic)
- Entities mentioned (comma-separated)
- Tags
- One-line summary (extracted from body)
`;
```

**Note** : la génération de l'index peut aussi se faire **sans LLM** par un simple template TypeScript qui parcourt les fragments. C'est plus rapide et déterministe. Le LLM intervient seulement pour générer les summaries one-line si manquants.

---


## 21. Stratégie démo finale 12 juin

### Format

**Durée** : 15-20 min de démo + 5-10 min Q&A  
**Audience** : Michel-Marie Maudet (CEO Linagora), possiblement avec Paul présent  
**Lieu** : à confirmer (sur place ou visio)  
**Backup** : vidéo enregistrée de la démo, prête en cas de bug le jour J

### Scénario en 5 actes

#### Acte 1 — Intro contexte (2 min)

> "Bonjour. Voilà l'évolution de Fragmint après ces 4 semaines. Le problème qu'on adresse : les auteurs passent plusieurs heures par document à recomposer du contenu manuellement. L'objectif : faire ça en 20 minutes avec la même qualité, tout en gardant la souveraineté technologique et la maîtrise humaine du processus."

Montrer brièvement la home page Fragmint (stats du corpus).

#### Acte 2 — Ingestion intelligente (3 min)

Upload du cahier des charges IRA. Le système :

1. Extrait les fragments candidats (chunking 30-200 mots, métadonnées 7 axes)
2. Identifie les entités (IRA, DGAFP, Cloud Temple, etc.)
3. Classifie en 7 axes
4. **Détecte une relation potentielle** avec un fragment existant ("Ce nouveau fragment ressemble à celui qu'on a pour le marché Maurice, on suggère une relation `exemplified_by`")
5. **Détecte une contradiction potentielle** ("Attention : vous avez 2 fragments mentionnant des SLA différents pour Twake Mail, lequel est le bon ?")
6. **Détecte une proposition de remplacement** ("Ce fragment pricing 2026 remplace probablement le pricing 2025, on vous propose un diff")

Montrer le panel admin (tabs Métadonnées, Relations, Remplacements, Contradictions) pour valider en 2 clics.

#### Acte 3 — Knowledge graph (2 min)

Ouvrir la vue graphe. Montrer :

- Cluster Twake Mail visualisé (fragments approved uniquement)
- Liens implicites en gris fin (fragments partageant SecNumCloud par exemple)
- Liens explicites en couleur épaisse (intro → details → reference)
- Filtre par entité : "Montre-moi tous les fragments mentionnant SecNumCloud"

**Punchline** : "On peut explorer le corpus comme une carte mentale, pas comme une bibliothèque à plat."

#### Acte 4 — Génération avec les 3 modes (7 min)

Sur la section "Twake Mail" du plan IRA, lancer les 3 modes en parallèle :

**Mode vector-only** :

- "Rapide (200ms) mais générique"
- Affiche 5 fragments, scores de similarité bruts
- 2 fragments sont moyennement pertinents

**Mode agentic-only** :

- "Lent (15s) mais précis"
- Affiche 5 fragments avec **justification LLM** pour chacun
- "J'ai sélectionné ce fragment parce qu'il mentionne explicitement Apache James qui est l'argument technique principal de Twake Mail"
- Démontrer la **compréhension temporelle native** : "Montre-moi les fragments Twake Mail créés ces 2 derniers mois" → le LLM applique le filtre sans qu'on l'ait codé

**Mode hybrid** (recommandé) :

- "Le meilleur des deux (3s)"
- Affiche 5 fragments avec scores combinés
- Les fragments sélectionnés correspondent EXACTEMENT à ceux choisis à la main
- Optionnel : montrer le multi-agent self-consistency sur une section critique (Agent A pertinence factuelle + Agent B cohérence stylistique)

Punchline : "Le système prend les mêmes décisions qu'un expert senior, mais en 30 secondes."

#### Acte 5 — Composition et comparaison (3 min)

1. Lancer la composition complète du doc
2. Comparer côte à côte avec le doc final de référence
3. Montrer la similarité (~95% structure, ~80% fragments)
4. Export DOCX final

Punchline finale : "L'auteur a passé 6 heures. Fragmint le fait en 20 minutes. La validation humaine est conservée à chaque étape pour la qualité."

#### Bonus — Skills OpenCode (1-2 min, si temps)

Démo rapide en split-screen :

- Terminal avec `/fragmint plan` + brief court
- Génération du plan en CLI
- Composition rapide
- Export DOCX

"Pour les équipes développeurs ou les workflows scriptés, le même système est accessible via Claude Code Skills."

### Slides de synthèse stratégique

Après la démo, 5-10 slides :

1. **Récap mission** : ce qui a été livré
2. **Architecture** : les 3 modes, le knowledge graph, les détections automatiques
3. **Démonstration de valeur** : 6h → 20 min, qualité comparable
4. **Souveraineté** : "Pour la démo Claude Sonnet, en prod Mistral Large via API souveraine"
5. **Roadmap V2** : multi-agent self-consistency activé par défaut, time travel via Git, custom notes, scale Milvus
6. **Roadmap V3** : multimodal, fine-tuning Mistral, intégrations CRM

### Plan B en cas de bug

- **Backup vidéo** : démo enregistrée 2-3 jours avant le 12 (mardi 9 juin), prête à lancer
- **Mode dégradé** : si une feature avancée casse (graph, contradictions, multi-agent), continuer sans
- **Discours rassurant** : "Cette feature est en cours de finalisation, vous voyez la version qui marche, voici à quoi ressemblera la version polie"

---

## 22. Risques, mitigations et plan B

### Risque 1 : Scope trop ambitieux

**Probabilité** : Élevée  
**Impact** : Démo bancale le 12 juin

**Mitigations** :

- Feature flags partout pour désactiver chaque feature indépendamment
- Décision claire de scope-cut à la fin de chaque semaine
- "Si une feature n'est pas finie à la fin de la semaine 2, elle sort du scope démo"
- Pas de "je finis dans le weekend" (le weekend = répétitions)
- Phase 1 fondations en premier : si elle déborde, Phase 2 est descopée, pas l'inverse

### Risque 2 : Qualité LLM insuffisante avec Mistral-nemo

**Probabilité** : Moyenne  
**Impact** : Démo peu impressionnante

**Mitigations** :

- Migration vers Claude Sonnet 4 via OpenRouter (décidé)
- Documentation explicite que c'est temporaire pour la démo
- Benchmarks sur cas IRA dès semaine 2

### Risque 3 : Bug critique le jour J

**Probabilité** : Faible mais existante  
**Impact** : Démo ratée

**Mitigations** :

- Vidéo enregistrée 2-3 jours avant
- Répétitions complètes en semaine 3 (3-5 passes)
- Plan B avec dégradation gracieuse de chaque feature
- Paul en backup le jour J

### Risque 4 : Maudet peu convaincu

**Probabilité** : Faible  
**Impact** : Pas de continuation post-mission

**Mitigations** :

- Cas d'usage IRA très concret et reconnaissable
- Métriques chiffrées (6h → 20 min)
- Comparaison directe avec travail humain
- Discours souverain bien préparé (Mistral Large en prod)

### Risque 5 : Disponibilité Paul limitée

**Probabilité** : Variable  
**Impact** : Charge sur Juliette

**Mitigations** :

- Synchros hebdo formalisées
- Découpage clair des responsabilités
- Backup : Juliette peut faire 100% des UI artifacts via Claude Design seule
- Packages admin (Metadata, Remplacements) déjà livrés et prêts à intégrer

### Risque 6 : Sur-engineering sur des détails

**Probabilité** : Élevée (tentation classique)  
**Impact** : Retard sur les fondamentaux

**Mitigations** :

- Définir "good enough" pour chaque feature
- Time-box stricte par feature
- Review en fin de semaine 1 : "qu'est-ce qu'on coupe ?"
- Le chunking est un puits sans fond : ne pas y boucler

### Risque 7 : Multi-agent self-consistency coûte trop cher

**Probabilité** : Moyenne  
**Impact** : Latence démo trop élevée

**Mitigations** :

- Feature flag `FRAGMINT_MULTI_AGENT_JUDGE` désactivé par défaut V1
- Activation sur 1-2 sections critiques seulement pour démo
- Si latence > 30s par section, désactiver totalement et garder pour la roadmap V2

---

## Next Steps (priorités post-Piste B — CR Paul 26 mai)

### 🔴 Must-have V1 (avant démo 12 juin)

| Priorité | Tâche | Effort estimé |
|---------|-------|---------------|
| P0 | **Piste A — Skill `/fragmint` Claude Code/OpenCode** : workflow plan→review→fetch fragments→validate→export, cache index local sur disque | ~2 jours |
| P0 | **Multi-agent self-consistency** : 2 judges parallèles dans `AgenticRetriever` (Agent A pertinence, Agent B cohérence), arbitrage sur désaccord, flag `FRAGMINT_MULTI_AGENT_JUDGE` | ~1 jour |
| P1 | **Config OpenRouter** : basculer `FRAGMINT_LLM_ENDPOINT` + `FRAGMINT_LLM_MODEL` sur OpenRouter + modèle > Mistral Nemo pour la démo | ~30 min |

### ⏸️ Différé post-mission (explicitement hors scope démo)

- Relations explicites typées (LLM)
- Détection de contradictions sémantiques
- Intelligence temporelle prédictive
- Knowledge graph visuel interactif
- **Migration FK SQLite** : recréer les tables `harvest_candidates`, `plan_fragment_usages`, `supersedure_proposals` avec des `FOREIGN KEY ... ON DELETE CASCADE` déclarés (SQLite ne supporte pas `ALTER TABLE ADD CONSTRAINT`). En attendant, les triggers `cascade_delete_fragment`, `cascade_delete_harvest_job`, `cascade_delete_plan` dans `connection.ts` assurent le comportement équivalent. La migration table-recreation est à faire proprement lors d'une refonte du schéma.

---

## 23. Roadmap V2/V3 à présenter à Maudet

### V1 (mission, livrée le 12 juin)

**Architecture** :

- 3 modes retrieval avec feature flag (vector-only, agentic-only, hybrid)
- Pattern Karpathy implémenté
- Mode hybrid retrieve-and-rerank
- Multi-agent self-consistency (**must-have**, 2 judges parallèles par section)

**Métadonnées** :

- 7 axes : subject, function, type, audience, maturity, tags, entities
- Classification hiérarchique 3 étapes
- Few-shot examples par catégorie
- Référentiels admin avec validation des propositions LLM

**Knowledge management** :

- Auto-supersedure avec LLM judge
- Relations implicites mécaniques (co-occurrence)

> Relations explicites typées (LLM), détection de contradictions, intelligence temporelle prédictive → **différés post-mission** (Paul CR 26 mai)

**UI admin** :

- Tab Métadonnées (livré)
- Tab Remplacements (livré)
- Knowledge graph visuel → **différé post-mission**

**Skills** :

- 3 skills OpenCode (plan, compose, export)

### V2 (3-6 mois post-mission)

**Architecture retrieval avancée** :

- Multi-agent self-consistency **activé par défaut** (Agent A pertinence + Agent B cohérence)
- Re-vérification automatique sur désaccords
- 3e agent de réconciliation pour cas complexes
- Métriques de fiabilité par agent (taux de désaccord, accuracy vs validation humaine)
- Réintégration Milvus pour scale > 500 fragments en mode hybrid
- Cache distribué (Redis) pour multi-utilisateurs
- API REST stable v1

**Métadonnées enrichies** :

- 5 types de relations supplémentaires (introduces, implements, requires, contradicts, supersedes)
- Custom notes par l'auteur
- Versioning sémantique des fragments
- Auto-detection d'entités émergentes plus sophistiquée
- Sélection dynamique des few-shot examples (par clustering)

**Temporalité avancée** :

- Time travel queries via Git checkout temporaire (snapshot du corpus à une date)
- Comparaison de documents similaires faits à des dates différentes
- Audit historique du corpus

**Knowledge management avancé** :

- Active learning loop : corrections humaines deviennent few-shot examples
- Lint périodique du corpus (Karpathy-style)
- Suggestions proactives ("ces 3 fragments couvrent le même sujet, fusionner ?")
- Détection sémantique de contradictions à grande échelle

**UI avancée** :

- Multi-utilisateurs avec rôles (reader, contributor, expert, admin)
- Historique et audit complets
- Comparaisons de documents (ce document vs documents similaires)
- Index hiérarchique pour scale (1 index par subject, 1 meta-index)

**Skills étendus** :

- `/fragmint analyze [cahier-des-charges]` : analyse automatique
- `/fragmint compare [doc-a] [doc-b]` : comparaison
- Intégration avec d'autres outils Linagora

### V3 (6-12 mois post-mission)

**Architecture multimodale** :

- Support PDF natif (pas juste DOCX)
- Support images, diagrammes
- Support audio (transcriptions de réunions client)

**IA spécialisée** :

- Fine-tuning Mistral Large sur corpus Linagora si justifié (>5000 fragments validés)
- Modèles spécialisés par fonction (commercial / technique / juridique)
- Génération automatique de variantes (long/court, FR/EN, formel/informel)

**Intégrations enterprise** :

- Connecteurs CRM (Salesforce, HubSpot)
- Connecteurs documentaires (SharePoint, Nextcloud)
- API GraphQL pour intégrations tierces
- SSO entreprise

**Capacités prédictives** :

- "Quel fragment manque dans notre corpus pour ce type de document ?"
- "Ce document a 80% de chances d'atteindre son objectif basé sur notre historique"
- "Voici les éléments à renforcer"

---

## 24. Questions ouvertes à trancher

### Questions techniques

**Q1 — Format de l'index.md**

Le format proposé en section 7 est riche. Faut-il le simplifier pour éviter l'overflow contextuel à grand corpus ?

Options :
- A) Format complet (proposé) : marche jusqu'à ~500 fragments
- B) Format compressé (résumés courts) : marche jusqu'à ~2000 fragments
- C) Index hiérarchique (un index par subject, un meta-index) : scale illimité

**Recommandation** : A pour V1, C pour V2.

**Q2 — Sélection des few-shot examples**

Manuel ou dynamique ?

Options :
- A) Manuel (proposé) : Juliette choisit 3 exemples par catégorie après curation
- B) Dynamique : sélection automatique des plus diversifiés par clustering

**Recommandation** : A pour V1, B pour V2.

**Q3 — Score combiné en mode hybrid**

Quels poids ?

Options :
- A) 40% vector + 60% LLM (proposé)
- B) 50/50
- C) Auto-tunable selon le corpus

**Recommandation** : A pour V1, valider empiriquement, C pour V2.

**Q4 — Stockage entities**

Table dédiée ou inline JSON dans fragments ?

Options :
- A) Table dédiée (proposé) : permet recherche cross-fragments efficace
- B) Inline JSON : plus simple mais moins requêtable

**Recommandation** : A (table dédiée).

**Q5 — Trigger de détection contradictions**

À l'ingestion seulement ou aussi sur lint périodique ?

Options :
- A) Ingestion seulement (proposé V1)
- B) + Lint manuel admin
- C) + Lint automatique périodique (Karpathy-style)

**Recommandation** : A pour V1, C pour V2.

### Questions stratégiques

**Q6 — Démo OpenCode**

Bonus de 1-2 min ou section séparée ?

Options :
- A) Bonus rapide (proposé)
- B) Section dédiée de 3-5 min
- C) Démo principale en OpenCode (proposition initiale Paul, abandonnée)

**Recommandation** : A.

**Q7 — LLM pour la prod**

Mistral Large ou auto-hébergé ?

Options :
- A) Mistral Large API (proposé) : souverain + qualité
- B) Auto-hébergé Mistral 7B/70B : souverain mais qualité moindre
- C) Hybride : API Mistral pour qualité critique, local pour reste

**Recommandation** : A pour V1/V2, C pour V3.

**Q8 — Profondeur démo IRA**

Tout le doc ou focus sur une section ?

Options :
- A) Tout le doc (impressionant mais long)
- B) Focus sur 1-2 sections (proposé, plus didactique)

**Recommandation** : B.

### Questions opérationnelles

**Q9 — Présence Paul à la démo**

Garde ou pas ?

Options :
- A) Paul présent (proposé)
- B) Juliette seule
- C) Paul en backup à distance

**Recommandation** : A. À confirmer avec Paul.

**Q10 — Backup vidéo**

Quand l'enregistrer ?

Options :
- A) 2-3 jours avant (mardi 9 juin)
- B) Veille (mercredi 11 juin)
- C) Le matin même

**Recommandation** : A (marge de sécurité).

### Questions de workflow admin (V3)

**Q11 — Multi-agent self-consistency : périmètre d'activation V1**

Sur quelles sections activer le multi-agent pour la démo ?

Options :
- A) Désactivé partout (sécurité latence)
- B) Activé sur 1-2 sections critiques (proposé)
- C) Activé partout pour la démo (qualité max)

**Recommandation** : B. Activer sur "Architecture technique" et "Engagement commercial" qui sont les sections les plus à risque de mauvais matching.

**Q12 — Trust by Source : niveau de confiance par défaut**

Quel niveau de confiance par défaut donne-t-on à un ingestor non-admin ?

Options :
- A) Trust total : tout ce que l'ingestor pré-remplit est validé direct, sans queue admin
- B) Trust avec audit : pré-remplissage validé direct, mais entries marquées dans un log d'audit consultable
- C) Trust limité : pré-remplissage suggéré au LLM mais passe quand même en queue admin

**Recommandation** : B (décidé). C'est l'équilibre entre vitesse (gain principal) et contrôle (admin peut auditer après coup). Log d'audit = vue avec filtre `entity_type = 'job'` ou `action = 'upload_with_hints'`.

**Q13 — Inbox unifiée : inclusion en V1 mission**

L'inbox agrège tâches en attente. Faut-il l'inclure en V1 ?

Options :
- A) Reportée en V2 (gain limité sur ~50 docs)
- B) Incluse en V1 (gros gain UX, mais dépend de packages pas encore intégrés)

**Recommandation** : B (décidé). Inclure en V1 mais à intégrer en dernier (après tous les autres packages).

**Q14 — Recalcul des signaux qualitatifs : sync vs async**

Quand l'admin modifie un item du référentiel (renomme, archive), les signaux qualitatifs des fragments concernés doivent être recalculés. Sync (immédiat avec modale d'attente) ou async (background) ?

Options :
- A) Sync : modale "Recalcul sur 28 fragments, ~30s", attente avant fermeture
- B) Async : action immédiate, badge "Recalcul en cours" dans header

**Recommandation** : B (décidé). Plus moderne, ne bloque pas le flow admin.

**Q15 — Inbox : design Gmail vs page d'accueil admin**

Architecture de l'inbox dans la sidebar :

Options :
- A) Premier tab de la sidebar, nommé "Inbox"
- B) Page d'accueil de `/admin` (route racine), les autres tabs deviennent secondaires
- C) Nouveau sous-tab dans Metadata

**Recommandation** : A (décidé). Cohérent avec le design Gmail, immédiatement compréhensible.

---

## 25. Workflow admin et Trust by Source

> Cette section consolide les décisions issues de l'analyse approfondie de la charge admin et du mécanisme Trust by Source. Elle complète et clarifie certains points abordés dans les sections 5 (métadonnées), 16 (curation manuelle) et 17 (UI admin).

### 25.1 Panorama de la charge admin

L'admin Fragmint doit gérer 8 types de tâches distinctes. Avant Trust by Source, la charge cumulée sur la mission (50 docs ingérés) est estimée à 29-42h, soit ~20-25% du temps total disponible. C'est trop pour être confortable.

| Tâche | Volume mission | Temps unitaire | Temps cumulé (sans Trust) | Temps cumulé (avec Trust) |
|-------|----------------|----------------|---------------------------|---------------------------|
| 1. Validation métadonnées émergentes | 5-8 propositions/doc | 10-30s | 5-8h | **2-3h** |
| 2. Validation relations explicites | 2-6 propositions/doc | 20-40s | 2-3h | 2-3h |
| 3. Validation remplacements (supersedure) | 1-3 propositions/doc | 30s-2min | 2-3h | 2-3h |
| 4. Résolution contradictions | 5-15 total mission | 1-5 min | 1-2h | 1-2h |
| 5. Validation fragments (workflow draft→approved) | 10-50/doc | 5s-3min | 15-20h | **5-8h** |
| 6. Maintenance référentiel | 1-2 sessions | 30min-1h | 1-2h | 1-2h |
| 7. Gestion doublons exacts | 1-5/doc | 10-30s | ~1h | ~1h |
| 8. Curation manuelle backend (script) | 1-2 sessions | 1-2h | 2-3h | **1h** |
| **TOTAL MISSION** | | | **29-42h** | **15-23h** |

Trust by Source réduit la charge admin de ~50% en transformant les tâches 1, 5 et 8.

### 25.2 Mécanisme Trust by Source

#### Principe fondamental

> **Trust = source.** Une métadonnée mise par un humain est considérée comme vérité. Une métadonnée inférée par le LLM est considérée comme proposition. La queue admin se vide naturellement quand les ingestors connaissent leur doc.

#### 4 niveaux de trust_source

Le champ `trust_source` (nouvelle colonne sur fragments, candidats et référentiels) prend 4 valeurs :

| Niveau | Sens | Statut en DB | Queue admin |
|--------|------|--------------|-------------|
| `human-direct` | Posé explicitement par un humain (admin direct ou ingestor en correction post-classification) | `active` direct | Pas en queue |
| `llm-confirmed` | Le LLM a appliqué un défaut humain doc-level (hint fourni à l'upload) | `active` direct | Pas en queue |
| `llm-deviation` | Le LLM a dévié d'un défaut humain doc-level | `pending` | En queue, priorité moyenne |
| `llm-inferred` | Aucun défaut humain fourni, LLM inféré aveugle | `pending` | En queue, priorité haute |

#### Architecture du flux

```
1. Upload de doc enrichi
   └─ L'ingestor remplit (facultatif) : subject doc-level, entities probables,
      audience, maturity, tags principaux
   └─ Sauvegardé dans harvest_jobs.upload_hints (JSON)

2. Ingestion harvester
   └─ Le LLM utilise les hints comme contexte fort dans son prompt
   └─ Pour chaque métadonnée extraite :
       - Si égale au hint → trust_source = 'llm-confirmed'
       - Si dévie du hint → trust_source = 'llm-deviation'
       - Si pas de hint pour cette métadonnée → trust_source = 'llm-inferred'

3. Queue admin filtrée
   └─ Le tab Metadata "À valider" affiche seulement trust_source IN
      ('llm-deviation', 'llm-inferred')
   └─ trust_source = 'llm-confirmed' → active direct
   └─ trust_source = 'human-direct' → active direct

4. Page de débriefing post-ingestion
   └─ Affiche le bilan : combien direct active, combien en queue
   └─ Lien direct vers la queue filtrée

5. Log d'audit
   └─ Toutes les actions Trust sont tracées (audit_log enrichie avec entity_type + entity_id)
```

#### Implémentation

Voir le package complet `FRAGMINT_ADMIN_TRUST_BY_SOURCE_PACKAGE.md` qui contient :
- Migrations DB additives (ne touche pas l'existant)
- Types TypeScript partagés
- Backend (upload enrichi, calcul trust_sources, queue filtrée)
- Frontend (formulaire upload avec autocomplétion stricte, page débriefing)
- Audit log enrichi
- Alignement avec section 4 V2 (signaux qualitatifs modulés par trust_source)

### 25.3 Formulaire d'upload enrichi

Le formulaire d'upload actuel (file picker + bouton submit) devient un formulaire enrichi avec une section "Aide à la classification" optionnelle :

```
Documents à ingérer : [Dropzone]

┌─ Aide à la classification (facultatif) ─────────────────────┐
│ Si vous connaissez le contenu de ce document, pré-remplissez│
│ les métadonnées principales. Cela accélère la validation.   │
│                                                              │
│ Domaine principal       : [Autocomplete strict ▼]            │
│ Fonction principale     : [Select ▼]                         │
│ Maturity du contenu     : [Select ▼]                         │
│                                                              │
│ [+ Afficher options avancées]                                │
│                                                              │
│ (Si avancées ouvertes :)                                     │
│ Audience cible          : [Multi-checkbox]                   │
│ Tags principaux         : [Multi-autocomplete strict]        │
│ Entités probables       : [Multi-autocomplete par type]      │
└──────────────────────────────────────────────────────────────┘

[Ingérer (N documents)]
```

#### Autocomplétion stricte

Les champs `Domain`, `Tags`, `Entities` utilisent un autocomplétion **strict** : seules les valeurs déjà validées dans le référentiel sont sélectionnables. Si l'ingestor tape "open-source" et que ça n'existe pas, le champ reste vide et un message explique "Cette valeur n'existe pas dans le référentiel".

Cette contrainte évite que l'ingestor crée des variations orthographiques qui pollueraient le référentiel. Si une nouvelle valeur est nécessaire, le LLM la proposera à l'ingestion et passera par la queue admin standard.

### 25.4 Page de débriefing post-ingestion

Après chaque ingestion terminée, l'ingestor est redirigé vers une page de débriefing qui synthétise le bilan :

```
Bilan d'ingestion — Job #abc123
30 fragments extraits

┌─ ✓ Hints pré-remplis utilisés ─────────────────────────┐
│ 80% des métadonnées validées automatiquement grâce à   │
│ vos indications. Vous avez économisé ~12 minutes de    │
│ validation admin.                                       │
└─────────────────────────────────────────────────────────┘

┌─ Fragments ──────────┐  ┌─ Métadonnées ──────────────┐
│ Total       : 30     │  │ Auto-validées : 24         │
│ Clean       : 21     │  │ À reviewer    : 6          │
│ Warnings    : 7      │  │                            │
│ Doublons    : 2      │  │ • 18 humain-direct         │
│                      │  │ • 6 llm-confirmed          │
│ [Valider →]          │  │ • 4 llm-deviation          │
└──────────────────────┘  │ • 2 llm-inferred           │
                          │                            │
                          │ [Valider métadonnées →]    │
                          └────────────────────────────┘

┌─ Nouveautés référentiel ──┐  ┌─ Détections auto ─────┐
│ Nouveaux tags     : 2     │  │ Relations proposées: 3 │
│ Nouvelles entités : 1     │  │ Supersedure        : 1 │
└───────────────────────────┘  │ Contradictions     : 0 │
                                └────────────────────────┘

[Nouvelle ingestion]  [Commencer la validation →]
```

Cette page centralise le contexte post-ingestion et oriente l'ingestor vers les actions à mener. C'est le pattern "page de récap après transaction" classique.

### 25.5 Inbox unifiée

Pour ne pas obliger l'admin à naviguer entre 5 tabs différents pour voir s'il y a du travail, un nouveau tab **"Inbox"** en première position de la sidebar agrège tout :

```
Inbox (23)

📥 Ingestions récentes
  ├─ Proposition_IRA_finale.docx (il y a 2h)
  │  ├─ 8 fragments à valider (3 avec warnings)
  │  ├─ 5 entities émergentes
  │  ├─ 2 relations proposées
  │  └─ [Tout traiter →]
  │
  └─ Argumentaire_Twake.docx (hier)
     ├─ 12 fragments à valider
     └─ [Tout traiter →]

⚠ En attente depuis plus de 7 jours
  └─ 2 contradictions HIGH non résolues
     [Résoudre →]

🔧 Maintenance suggérée
  └─ 3 entities probablement à fusionner
     (Apache James, ApacheJames, Apache-James)
     [Examiner →]
```

L'inbox **dépend** des autres packages (Metadata, Supersedure, Relations, Contradictions). Elle est donc le dernier package à intégrer, en fin de mission (semaine 3-4).

Détail technique : l'endpoint `GET /v1/admin/inbox/stats` est déjà préparé dans le package Trust by Source. L'inbox elle-même fait l'objet du package `FRAGMINT_ADMIN_INBOX_PACKAGE.md`.

### 25.6 Log d'audit et trust_source

La table `audit_log` existante est enrichie avec 2 colonnes (`entity_type` + `entity_id`) pour tracer les opérations non-fragments. Toutes les actions Trust sont loggées :

- `upload_with_hints` / `upload_without_hints` (à l'upload)
- `tag_proposed` / `tag_approved` / `tag_renamed` / `tag_rejected`
- `entity_proposed` / `entity_approved` / `entity_merged` / `entity_rejected`
- `metadata_corrected_by_human` (quand un humain corrige une métadonnée d'un candidat pendant la review)

L'admin peut consulter ces logs via `GET /v1/admin/audit-log` avec filtres (entity_type, user_id, période).

Métrique clé visible : **taux d'adoption des hints** (pourcentage d'uploads avec hints fournis). Un taux faible signale un problème d'UX ou d'éducation utilisateur.

### 25.7 Bulk actions et raccourcis clavier

Pour rendre la validation fluide, surtout sur la tâche 5 (validation fragments) qui est la plus volumineuse :

- **Checkboxes** sur chaque candidat avec actions de groupe (Accept/Reject all selected)
- **Raccourcis clavier** : A (Accept), R (Reject), E (Edit), N (Next), P (Previous), J/K (navigation vim-style)
- **Mode rapide** : "Accept all clean" en un clic (tous les fragments sans warnings ni doublons)
- **Vue compacte** : un fragment par ligne avec preview, scan visuel rapide

Ces raffinements sont à intégrer dans les packages existants (Metadata, Supersedure) en plus du nouveau code Trust by Source.

### 25.8 Distinction humain expert vs humain novice

Pour la mission V1, on considère tous les utilisateurs comme égaux (un seul rôle, trust complet). En V2, distinguer :

- **Contributor** : peut ingérer et pré-remplir, mais ses valeurs vont en queue admin (trust faible)
- **Editor** : peut ingérer et pré-remplir, ses valeurs sont active direct (trust fort)
- **Admin** : pareil + accès maintenance référentiel

Pour la mission, simplification : tous les utilisateurs sont des Editors par défaut. Système de rôles en V2 (cf section 23 roadmap).

### 25.9 Roadmap Trust by Source

**V1 (mission)** :
- ✅ Décision Option B validée (trust avec audit log)
- 📝 Package Trust by Source à intégrer après Supersedure
- 📝 Page de débriefing post-ingestion
- 📝 Audit log enrichi avec entity_type + entity_id

**V2 (3-6 mois post-mission)** :
- Système de rôles différenciés (contributor, editor, admin)
- Presets de hints par utilisateur (sauvegarde des hints fréquents)
- Trust rétroactif (admin promeut un lot de fragments de llm-inferred à human-direct)
- Métriques de drift (détecter quand le LLM dévie systématiquement sur certains patterns)

**V3 (vision)** :
- Active learning : les corrections humaines deviennent few-shot examples du LLM
- Multi-tenancy avec rôles par collection
- API d'ingestion programmatique avec hints (pour intégrations CRM)

### 25.10 Le Knowledge Graph dans le workflow admin

Le Knowledge Graph n'est **pas** une tâche admin récurrente. C'est un **outil
d'exploration et de réflexion** à utiliser ponctuellement.

#### Quand l'admin l'utilise

**Cas 1 — Audit du corpus** (mensuel, optionnel) :
- "Quelles sont les zones du corpus sous-représentées ?"
- "Combien d'entities sont en faible usage ?"
- "Y a-t-il des clusters isolés sans connexion au reste ?"

**Cas 2 — Préparation d'un document stratégique** (avant rédaction) :
- "Quels fragments parlent de SecNumCloud + Twake Mail ?"
- "Quelles relations explicites peuvent enrichir le document ?"
- L'auteur part de l'entity cible et explore visuellement.

**Cas 3 — Démo client ou direction** :
- Projeter le graph montre la richesse et la structure du corpus
- Argument fort : "Voici notre patrimoine documentaire structuré"

**Cas 4 — Onboarding d'un nouvel auteur** :
- Comprendre l'étendue du corpus en 10 minutes au lieu de plusieurs jours
- Voir les patterns sans lire chaque fragment

#### Fréquence d'utilisation estimée

- Admin senior : 1-2 sessions par mois (~30 min chacune)
- Auteur préparant un document : ponctuel, 5-10 min
- Démo / présentation : ad hoc

#### Pas de charge admin récurrente

Le graph se construit automatiquement à partir des validations effectuées
dans les autres tabs. Pas de validation spécifique au graph lui-même. C'est
pourquoi il n'apparaît pas dans le panorama des 8 tâches admin (cf 25.1).

---

## Annexes

### Annexe A — Lien gist Karpathy

https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f

### Annexe B — Implémentations communautaires citées

- theafh/ai-modules : https://github.com/theafh/ai-modules/tree/main/plugins/knowledge_management
- wikova.com (jianghailong-xy) : https://wikova.com
- TrueHOOHA/LLM-Wiki-Skilled : https://github.com/TrueHOOHA/LLM-Wiki-Skilled
- nohmitaina (nowissan) : https://nohmitaina.com/
- Origin (7xuanlu) : https://github.com/7xuanlu/origin
- memex-lab/memex : https://github.com/memex-lab/memex

### Annexe C — Documents cas IRA fournis

Stockés dans le projet, dossier `mission/cas-ira/` :

1. `01_-_Expression_de_besoin_Messagerie__P18__-_V2.docx` : cahier des charges
2. `02_-_plan_cible_de_taille__et_retravaille_.md` : plan élaboré manuellement
3. `03_-_fragments_se_lectionne_s_a__la_main_pour_IRA.docx` : fragments choisis
4. `04_-_md_obtenu_a__transformer_en_docx.md` : doc final markdown
5. `05_-_Proposition_IRA_finale.docx` : document final livré

### Annexe D — Bugs et notes héritées

Voir `.claude/mission/BUGS.md` et `.claude/notes/limitations-and-evolutions.md` dans le repo.

### Annexe E — Packages admin livrés et à venir

Pour faciliter l'intégration par Claude Code, des packages complets ont été livrés :

| Package | Statut | Description | Dépendances |
|---------|--------|-------------|-------------|
| `FRAGMINT_ADMIN_METADATA_PACKAGE.md` | ✅ Livré + intégré | Tab Metadata sous-tab "À valider" | Aucune |
| `FRAGMINT_ADMIN_SUPERSEDURE_PACKAGE.md` | ✅ Livré (intégration en cours) | Tab Supersedure avec diff visuel | Metadata |
| `FRAGMINT_ADMIN_TRUST_BY_SOURCE_PACKAGE.md` | ✅ Livré | Mécanisme transverse trust_source, formulaire upload enrichi, page débriefing | Metadata, Supersedure |
| `SECTION_4_TAUX_CONFIANCE_V2.md` | ✅ Livré | Remplacement section 4 Partie 1 (signaux qualitatifs en 3 niveaux) | Aucune |
| `FRAGMINT_ADMIN_REFERENTIAL_PACKAGE.md` | 📝 À faire | Sous-tab Metadata "Référentiel" : catalogue items validés + maintenance | Trust by Source |
| `FRAGMINT_ADMIN_INBOX_PACKAGE.md` | 📝 À faire | Tab Inbox en tête de sidebar | Tous les autres packages |
| `FRAGMINT_ADMIN_RELATIONS_PACKAGE.md` | 📝 À faire | Tab Relations | Trust by Source |
| `FRAGMINT_ADMIN_CONTRADICTIONS_PACKAGE.md` | 📝 À faire | Tab Contradictions | Trust by Source |
| `FRAGMINT_ADMIN_KNOWLEDGE_GRAPH_PACKAGE.md` | 📝 V1 mission | Knowledge graph visuel : tab dédié + accès contextuels depuis fragment et entity | Milvus recommandé (fallback gracieux si off) |
| `FRAGMINT_ADMIN_USERS_COLLECTIONS_PACKAGE.md` | 📝 À faire | Users + Collections | Aucune |

### Ordre d'intégration recommandé pour la mission

1. ✅ Metadata (livré et intégré)
2. 🔄 Supersedure (en cours)
3. **Trust by Source** (transverse, modifie le flow upload)
4. **Section 4 V2** (taux de confiance, indépendant)
5. Référentiel (s'appuie sur trust_source)
6. **Knowledge Graph** (V1 — visualisation, exploration corpus)
7. Relations + Contradictions (ordre indifférent)
8. Inbox (agrège tous les autres, à faire en dernier)

### Annexe F — Composer-service hardcoded format bug

Référence Bug #16 : `composer-service.ts:252` hardcodes format `'docx'` par défaut (`request.output?.format ?? 'docx'`) → mismatch pour tous templates non-DOCX (slides/xlsx/reveal). Fix : remplacer `?? 'docx'` par `?? yaml.output_format`.

À traiter dans le scope du refactor, pas critique pour la démo mais bon hygiène.

---

## Récapitulatif des évolutions du plan

### V1 → V2 (analyse approfondie des notes Paul)

| Modification | Section impactée |
|--------------|------------------|
| 1. Confirmation des 3 modes vs bool simple (avec justification) | Section 4 (note ajoutée) |
| 2. Pattern multi-agent self-consistency pour LLM judge | Section 9 (nouvelle sous-section) |
| 3. Relations à 2 niveaux (implicites + explicites) + scope approved | Section 11 (refonte complète) |
| 4. Suppression valid_from / valid_until (kill V1) | Section 5 + Section 19 |
| 5. Intelligence temporelle au retrieval (filtres + prédictif) | Section 8 (nouvelle sous-section) |
| 6. Maturity détaillée avec exemples concrets et distinctions | Section 5 (axe 6 refondu) |
| 7. Roadmap V2 multi-agent activé par défaut | Section 23 |
| 8. Référencement des packages admin livrés | Section 17 + Annexe E |
| 9. Naming supersedure (code) vs Remplacements (UI) | Section 12 |
| 10. Justification audience comme axe distinct (pas tag) | Section 5 (axe 5) |

### V2 → V3 (workflow admin et Trust by Source)

| Modification | Section impactée |
|--------------|------------------|
| 1. Refonte complète Section 4 Partie 1 (3 bugs distincts, 3 niveaux d'implémentation, LLM-as-judge avec rubrique pass/partial/fail) | Section 4 Partie 1 |
| 2. Distinction critique confiance ingestion vs confiance retrieval | Section 4 Partie 1 |
| 3. Approches rejetées documentées (fréquence metadata, score LLM amélioré) | Section 4 Partie 1 |
| 4. Mise à jour des packages livrés (ajout Trust by Source, Référentiel, Inbox) | Section 17 + Annexe E |
| 5. Ajout architecture cible sidebar admin avec Inbox en tête | Section 17 |
| 6. Ajout Q11-Q15 (multi-agent activation, Trust niveau confiance, Inbox V1, recalcul sync vs async, Inbox design) | Section 24 |
| 7. Nouvelle Section 25 complète : Workflow admin et Trust by Source | Section 25 (nouvelle) |
| 8. Panorama de la charge admin (8 tâches, 29-42h sans Trust → 15-23h avec Trust) | Section 25.1 |
| 9. Mécanisme Trust by Source à 4 niveaux | Section 25.2 |
| 10. Formulaire upload enrichi + autocomplétion stricte | Section 25.3 |
| 11. Page de débriefing post-ingestion | Section 25.4 |
| 12. Inbox unifiée en tête sidebar | Section 25.5 |
| 13. Log d'audit enrichi avec entity_type + entity_id | Section 25.6 |
| 14. Bulk actions et raccourcis clavier | Section 25.7 |
| 15. Distinction humain expert vs novice (système rôles V2) | Section 25.8 |
| 16. Roadmap Trust by Source (V1 / V2 / V3) | Section 25.9 |
| 17. Documentation complète du Knowledge Graph (3 modes selon Milvus, accès contextuels, périmètre approved uniquement, cas d'usage démo) | Section 11bis (nouvelle) |
| 18. Knowledge Graph passe de "à faire" à "V1 mission" dans la roadmap | Section 17 + Annexe E |
| 19. Knowledge Graph dans le workflow admin (outil d'exploration, pas tâche récurrente) | Section 25.10 |

### Décisions explicitement abandonnées (V3)

- Approche "fréquence metadata" pour la confiance d'ingestion (récompense l'inertie, pénalise la nouveauté)
- Score LLM amélioré par prompt seul (overconfidence systématique documentée par la recherche)
- Inbox en V2 (au final incluse en V1)
- Recalcul sync des signaux après modification référentiel (au final async)
- Toggle graph auteur vs admin → un seul graph, fragments approved uniquement
- Section dédiée "Traçabilité et historique" V1 → mécanismes existants suffisent
- Time travel rétrospectif en V1 → reporté V2
- Timeline temporelle dans le graph V1 (voir graph d'il y a 3 mois) → V2
- Export PNG/PDF du graph V1 → V2
- Annotations collaboratives V1 → V2

---

---

## Pipeline agentique (Phase 3 — après Trust by Source et Supersedure stabilisés)

> **Document de référence** : `.claude/mission/PIPELINE.md`
>
> Voici le design de la pipeline agentique, à implémenter quand Trust by Source et Supersedure sont stabilisés.

### Contexte

La pipeline agentique adapte le pattern Karpathy (LLM-Wiki) à Fragmint : au lieu d'un RAG à la requête, le LLM navigue une table des matières compressée (~10K tokens pour 500 fragments), puis charge les fragments complets à la demande. Deux agents en parallèle : Agent A (pré-sélection gros grain depuis l'index) + Agent B (validation fragment par fragment).

L'interface principale est Claude Code via des skills MCP — pas l'UI web.

### Les 8 phases d'implémentation

| Phase | Chantier | Durée estimée |
|-------|----------|---------------|
| 1 | Backend index — `GET /v1/index` sert la table des matières en markdown | 1-2j |
| 2 | Endpoint fragments individuels — `GET /v1/fragments/:id` + search + références | 0.5j |
| 3 | Convention IDs lisibles — `[TM-arg-001]` au lieu des UUIDs | 0.5j |
| 4 | Serveur MCP — `@fragmint/mcp-server` avec `get_index`, `get_fragment`, `search_fragments`, `list_*`, `generate_document` | 2-3j |
| 5 | Schema `fragmint.md` — fichier qui transforme Claude Code en agent Fragmint discipliné | 0.5j |
| 6 | Pipeline 2 agents — prompts Agent A + B, parallélisation, consolidation | 2-3j |
| 7 | Génération document final — `POST /v1/compose/generate` → pptx / docx / md / pdf | 2-3j |
| 8 | Test IRA end-to-end — composition complète sur le cas IRA, comparaison avec doc de référence | 1j |

**Total estimé : 10-13 jours**. Phase 1 peut démarrer en parallèle de la finalisation de Trust by Source / Supersedure (chantiers indépendants).

### Décisions structurantes

- LLM puissant via OpenRouter (Claude Sonnet ou GPT-4) — pas Mistral
- IDs lisibles `[SUBJECT-TYPE-NUM]` pour que le LLM référence sans ambiguïté
- Stockage local `~/.fragmint/` pour le cache index + fragments (perf + coût tokens)
- Génération de documents côté backend (templates centralisés)
- Pas de Knowledge Graph visuel en V1, pas de relations explicites en V1

### Critères de succès (démo Maudet)

- Composition end-to-end sur le cas IRA en < 90s
- Doc final (pptx) ouvrable et présentable
- Sélection de fragments contextuellement pertinente (ex : CNB → fragments avec entity CNB)
- Zéro hallucination visible

→ **Détail complet** : `.claude/mission/PIPELINE.md`

---

**Fin du document.**

Ce document V2 est la **référence unique** pour Claude Code lors de l'évolution de Fragmint pour la démo du 12 juin 2026. Il remplace toutes les versions précédentes.

Pour démarrer :
1. **Phase 1** (Partie 1, sections 1-7) : référentiels admin + chunking + métadonnées + taux de confiance
2. **Phase 2** (Partie 2, sections 4-20) : architecture 3 modes + index Karpathy + relations + supersedure + contradictions
3. **Phase 3** : pipeline agentique — voir section ci-dessus + `.claude/mission/PIPELINE.md`
4. **Démo** (Partie 2, section 21) : stratégie démo 5 actes
5. **Roadmap** (Partie 2, section 23) : V2/V3 à présenter à Maudet
