# Document de référence Fragmint — Mission Phase 2

## Linagora — Démo : 10 juin 2026

> **Statut** : document de référence interne — décrit le comportement réel du code au 9 juin 2026.
> Toutes les affirmations sont vérifiées dans les fichiers source correspondants.

---

## Section 0 — Genèse et contexte

### 0.1 — Le point de départ : l'observation des praticiens

Fragmint n'est pas un produit conçu théoriquement. Il est issu d'une observation concrète du workflow des praticiens experts en réponse à appel d'offres au sein de Linagora.

Lors d'un hackathon Linagora, nous avons étudié la manière dont **Benjamin Bellamy** et **Benjamin André** structurent leurs réponses à appel d'offres :

- Identification d'un patrimoine documentaire (propales passées, mémoires techniques, références clients)
- Réutilisation manuelle de fragments éprouvés, adaptés au contexte du nouveau client
- Validation systématique de chaque fragment retenu avant intégration
- Composition par assemblage de fragments + reformulation contextuelle

Ce workflow est efficace mais entièrement manuel. Il dépend de la mémoire et de l'expertise individuelles. Il n'est pas scalable au-delà du périmètre de quelques experts.

### 0.2 — De l'observation au produit

L'intuition fondatrice de Fragmint est que ce workflow peut être systématisé sans en perdre la rigueur. Trois principes clés issus de l'observation :

1. **Le fragment comme unité de travail** : pas le document entier, pas la phrase isolée. Un fragment est une unité éditoriale autonome, contextualisée, réutilisable.

2. **La validation humaine comme garde-fou** : aucun fragment ne devient utilisable sans approbation. C'est cette validation qui transforme un texte brut en patrimoine fiable.

3. **L'humain dans la boucle à chaque étape critique** : ingestion validée, retrieval validé, composition validée. Le LLM accélère le travail, il ne remplace pas le jugement.

### 0.3 — La philosophie "human in the loop"

Fragmint inverse le paradigme habituel des outils LLM. La plupart des produits cherchent à automatiser au maximum et à minimiser les interruptions utilisateur. Fragmint fait l'inverse : il **structure les moments d'intervention humaine** pour qu'ils soient efficaces et nécessaires.

Trois points de validation explicite dans le workflow :

- **Après ingestion** : l'utilisateur valide les fragments candidats produits par le harvester
- **Après génération du plan** : l'utilisateur peut éditer la structure proposée par le LLM
- **Après retrieval** : l'utilisateur valide, ajoute, retire les fragments avant la composition

Cette approche est plus exigeante en temps utilisateur qu'un outil "tout automatique". Elle est aussi plus fiable, plus traçable, et plus alignée avec les exigences des cas d'usage critiques (propales, PAS, conformité).

### 0.4 — Liens avec d'autres initiatives Linagora

L'approche observée chez Benjamin Bellamy et Benjamin André a également inspiré d'autres initiatives au sein de Linagora :

- **pas-completer** (Patrick Bellamy et Benjamin Bellamy) : outil dédié à la complétion des Plans d'Assurance Sécurité (PAS), basé sur une philosophie similaire de réutilisation de fragments validés.

Fragmint et pas-completer partagent une même intuition fondatrice : grounding strict sur un patrimoine validé, assistance LLM sans remplacement du jugement humain. Les deux outils sont complémentaires, et une convergence d'architecture est envisagée (cf. Section 5.3.6).

### 0.5 — Contexte institutionnel

Fragmint est un système de gestion documentaire à IA souveraine développé par Linagora. La présente mission de 20 jours (contrat `20260506-Contrat application-001-SST-ENGEL Juliette`, démarrée le 6 mai 2026) a pour objectif de stabiliser le POC, construire une bibliothèque de fragments sur un corpus Linagora réel, et démontrer la composition documentaire contextualisée.

Responsable technique : Michel-Marie Maudet (suivi commits en temps réel, `github.com/mmaudet/fragmint`).
Support technique : Paul Tran-Van (contexte architectural, accès datasets, décisions de débloquage).

### 0.6 — Périmètre Phase 2

La Phase 2 couvre l'architecture cible du retrieval et de la composition. Elle succède à la Phase 1 (fondations : chunking, métadonnées, confiance, référentiels admin). Les livrables formels du contrat sont :

| #   | Livrable                                                             | Format              |
| --- | -------------------------------------------------------------------- | ------------------- |
| 1   | Liste des bugs identifiés et corrections appliquées                  | `BUGS.md` + commits |
| 2   | Bibliothèque de fragments générée à partir d'un corpus Linagora réel | Vault Git           |
| 3   | Démonstration de composition documentaire contextualisée             | Pipeline + exemples |
| 4   | Prototype Skill(s) Fragmint pour opencode                            | Skill + démo        |
| 5   | Note de synthèse sur les évolutions et limites                       | `docs/mission/`     |

### 0.7 — Décisions architecturales structurantes

Décisions prises avec Paul Tran-Van durant la Phase 2 :

- 3 modes de retrieval coexistants et basculables à chaud (vector-only, hybrid, agentic-only)
- Multi-agent self-consistency pour le mode agentic (2 agents parallèles, score final = **moyenne**)
- Simplification temporelle : pas de gestion des relations implicites entre fragments pour la démo
- Distinction relations implicites/explicites reportée à une phase ultérieure
- Infrastructure IA : `ai.linagora.com` (Mistral-Small-3.2-24B-Instruct-2506-FP8 + Qwen3-Embedding-0.6B 1024D)

---

## Section 1 — Présentation de Fragmint et valeur apportée

### 1.1 — Qu'est-ce que Fragmint ?

Fragmint est un système de bibliothèque documentaire à IA souveraine. Il permet à une organisation de capitaliser sur ses documents existants sous forme de _fragments_ réutilisables — blocs de contenu typés et classés — et de composer de nouveaux documents à partir de cette bibliothèque.

Trois propriétés fondamentales :

- **Souveraineté** : tout le traitement IA (embeddings, LLM) s'exécute sur l'infrastructure Linagora (`ai.linagora.com`) ou en local via Ollama. Aucune dépendance à un service IA tiers.
- **Traçabilité** : chaque fragment connaît sa source (document d'origine, section, page), son historique complet via Git, et son compteur d'utilisation incrémenté à chaque réutilisation dans un plan.
- **Maîtrise de la qualité** : workflow de validation explicite `draft` → `reviewed` → `approved` ; groundedness check automatique sur les drafts générés.

### 1.2 — Les trois flux fonctionnels

**COMPOSE — Composition de document**

L'utilisateur décrit en langage naturel le document à produire (type, public cible, contraintes). Le système :

1. Génère un plan de sections adapté au corpus disponible (`buildCorpusSummary` interroge la distribution réelle des domaines/types avant de proposer des sections)
2. Retrouve les fragments pertinents par section (mode vector, hybrid ou agentic selon la configuration)
3. Génère un draft de rédaction par section à partir des fragments sélectionnés
4. Exporte le document final en DOCX, PPTX, Marp (HTML), Reveal.js (HTML) ou Markdown

**SEARCH — Recherche dans la bibliothèque**

Requête en langage naturel → embedding cosinus (Milvus 1024D) ou fallback SQLite LIKE → re-classement qualité → résultats avec score traçable (`score_breakdown` : méthode, score vecteur, rang LLM, score RRF).

**HARVEST — Ingestion de documents sources**

Upload d'un DOCX, PDF ou Markdown → découpage sémantique par sections → filtre de qualité (junkiness score) → classification domaine/type/langue/confiance par LLM → déduplication contre la bibliothèque existante → file de validation humaine.

### 1.3 — Cas d'usage Linagora

**Réponse à appel d'offres** : l'équipe commerciale décrit le projet cible, Fragmint retrouve arguments différenciants, références clients, fiches produit et engagements SLA depuis le corpus Linagora, génère un plan structuré, exporte en DOCX prêt à finaliser.

**Compte rendu de réunion** : les notes brutes sont uploadées via Harvest, découpées en fragments (décisions, actions, points techniques), classées et versionnées. Les prochaines réunions réutilisent les points d'avancement antérieurs.

**Présentation produit** : à partir du corpus de fiches produit et de références clients, génération d'une présentation Marp ou Reveal.js avec thème Linagora (couleur `#2B579A`, police Calibri).

**Fragment polymorphe** : un engagement SLA stocké une fois peut apparaître dans un document comme ligne de tableau, comme phrase argumentaire dans l'introduction, ou comme donnée chiffrée dans un résumé — sans duplication de la donnée source.

### 1.4 — Architecture en un mot

```
Git (vérité historique)
  └── SQLite (lecture rapide, Drizzle ORM)
        └── Milvus (index vectoriel, optionnel)
              └── Retriever (vector | hybrid | agentic)
                    └── PlanAssembler (génération + groundedness)
                          └── Export (DOCX | PPTX | Marp | Reveal | MD)
```

Tous les services sont exposés via API Fastify 5 (`/v1/...`) avec validation Zod. Un serveur MCP expose 9 outils pour intégration directe dans un agent OpenCode.

---

## Section 2 — Pipeline d'ingestion (Harvest)

### 2.1 — Vue d'ensemble

Quand un utilisateur uploade un document (DOCX, PDF, Markdown), le pipeline d'ingestion le découpe automatiquement en blocs de contenu réutilisables, les classe (domaine, type, langue), détecte les doublons éventuels et les met en file d'attente pour qu'un humain les valide avant qu'ils entrent dans la bibliothèque. Rien n'entre dans la bibliothèque sans validation humaine explicite.

```
Upload (DOCX/PDF/MD) + hints optionnels (domain?, tags?)
  → Pandoc            → conversion en Markdown
  → SemanticChunker   → découpage par sections
  → IsJunky           → filtre les blocs vides/separateurs
  → ExtractTables     → détection des tableaux structurés
  → LLM classify      → domain / type / lang / confidence + new_proposals
  → ApplyHints        → force-application des hints utilisateur
  → computeTrustSources → marque chaque métadonnée : LLM ou humain
  → insertNewProposals → met en file d'attente les nouvelles métadonnées
  → DeduplicateL1L2   → doublon exact ou quasi-exact (synchrone)
  → DeduplicateL3     → doublon sémantique via Milvus (asynchrone)
  → harvestCandidates → stocké en SQLite, statut 'pending'
```

### 2.2 — Découpage sémantique (`harvest-chunker.ts`)

L'idée est de produire un fragment par "idée cohérente", ni trop petite (titre seul) ni trop grande (section de 10 pages). Le découpage suit la structure logique du document source plutôt que de couper arbitrairement à un nombre de tokens.

**Algorithme** (`semanticChunk()`) :

1. Découpe par en-têtes ATX (`# Titre`, `## Titre`) et sections numérotées Pandoc (`1\. Titre`, `1.1 Titre`)
2. Chaque section H1 produit son propre chunk pour préserver le champ `source_section`
3. Les sous-sections H2/H3 sont fusionnées dans leur parent H1 jusqu'à `SECTION_MAX_CHARS = 2000` chars
4. Si une section dépasse 2000 chars, elle est découpée aux frontières de paragraphes (`\n\n`) avec un chevauchement de 300 chars — pour que les fragments voisins partagent un peu de contexte
5. Les sections < 500 chars sont fusionnées à leur voisine (évite les fragments "titre seul sans contenu")
6. Filtre final : chunks sans contenu de paragraphe (uniquement des titres) sont supprimés

**Traçabilité source** : le nom de l'en-tête parent est propagé sur chaque chunk et stocké comme `source_section` — on sait toujours de quelle section d'origine provient chaque fragment.

### 2.3 — Filtre de qualité (`junkiness-filter.ts`)

Avant d'envoyer un bloc au LLM pour classification (qui coûte du temps et des tokens), on filtre les blocs qui n'ont clairement pas de valeur documentaire : pages de table des matières, lignes séparatrices, textes de 5 caractères, etc.

`junkinessScore()` calcule un score 0–1 (plus élevé = plus junky) à partir de 4 signaux :

| Signal                 | Ce qui est détecté                             | Contribution             |
| ---------------------- | ---------------------------------------------- | ------------------------ |
| Longueur               | Texte < 30 chars                               | Jusqu'à 1.0              |
| Ratio séparateurs      | Fraction de chars `[-=_.+*#~^…]` dans le texte | Normalisé sur seuil 0.30 |
| Ligne séparatrice pure | Texte composé uniquement de séparateurs        | Signal fort × 0.9        |
| TOC / Annexe           | Patterns "table des matières", "annexe X"      | Signal fort × 0.7        |

Un bloc est éliminé si son score atteint le seuil `0.5` (configurable). Cette étape est purement locale, aucun appel LLM.

### 2.4 — Extraction de tableaux structurés (`harvest-table-extractor.ts`)

Les tableaux dans les documents (SLA, grilles tarifaires, listes de références clients) contiennent des données structurées qui ont une valeur de réutilisation élevée. Fragmint les traite séparément du contenu prose via un pipeline dédié.

#### Le choix de conception : 1 fragment = 1 ligne

La décision fondamentale est de représenter chaque ligne d'un tableau comme un fragment indépendant plutôt que de stocker le tableau entier en bloc. Avantages : chaque ligne est réutilisable individuellement dans n'importe quel contexte (une ligne SLA dans une intro, une référence client dans un argumentaire), et la bibliothèque peut assembler un tableau à la carte (filtrer les lignes SLA de niveau Gold uniquement). Inconvénient : une ligne isolée sans son contexte de tableau est sémantiquement pauvre — le body est court, l'embedding peu discriminant.

#### Les 4 schémas de payload et leur inférence

Le pipeline identifie le schéma du tableau par correspondance de mots-clés sur les en-têtes (`payload-inference.ts`). Chaque schéma mappe vers un type de fragment éditorial :

| Schéma            | Mots-clés d'en-tête détectés                              | Type fragment | Exemple body généré                                              |
| ----------------- | --------------------------------------------------------- | ------------- | ---------------------------------------------------------------- |
| `pricing-line-v1` | libellé, quantité, prix, pu, total, montant, tarif        | `pricing`     | "Services professionnels — 40 × 150 €"                           |
| `sla-row-v1`      | sla, niveau, prise en charge, résolution, pénalité, délai | `engagement`  | "Niveau Critique : prise en charge sous 2h, résolution sous 8h." |
| `reference-v1`    | client, projet, année, référence, technologie             | `reference`   | "CNB — Déploiement Twake Mail (2023) · Apache James"             |
| `generic-row-v1`  | (fallback — aucun schéma reconnu)                         | `pricing`     | "statut: actif \| durée: 30 jours"                               |

**Ce mapping schéma→type est hardcodé** (`SCHEMA_TYPE_MAP` dans `harvest-table-extractor.ts`). Le LLM de classification n'intervient pas pour les tableaux — le domaine est assigné directement depuis le hint d'upload (ou le premier domaine existant), sans inférence LLM. Des tags de base sont ajoutés automatiquement selon le schéma : `sla-row-v1` → `['source:tableau', 'sla', 'engagement']`.

#### Ce que produit le pipeline pour chaque tableau

Pour un tableau SLA à 5 lignes (Critique / Majeur / Modéré / Mineur / Négligeable) :

- 5 fragments de type `engagement`, payload_schema `sla-row-v1`
- 1 collection `fragment_collections` "Engagements SLA" avec les 5 IDs membres
- Chaque fragment a un `body` généré par `toBody()` (environ 10-15 mots) et un `payload` JSON de la ligne

#### Le body généré est intentionnellement court

La fonction `toBody()` de chaque schéma produit une phrase concise et lisible : "Niveau Gold : prise en charge sous 4h, résolution sous 8h. Pénalité : 5%." C'est lisible pour un humain — mais pour l'embedding vectoriel, ce texte de 12 mots est insuffisant. La similarité cosinus d'un body aussi court avec une requête de retrieval est faible et peu fiable. **C'est la limitation principale des fragments-tableau** (voir Section 3.3 et Section 5.3.3).

### 2.5 — Classification LLM et gestion des métadonnées nouvelles

Le LLM classe chaque bloc avec les informations suivantes : domaine produit, type de contenu, langue, titre court, score de confiance (0–1), et les tags qu'il juge pertinents. Pour cela, il reçoit la liste des domaines et types déjà connus en base.

**Domaines pré-seedés au démarrage** (`seeds/linagora-domains.ts`) — 14 domaines Linagora avec descriptions guidant le LLM : `linshare`, `twake`, `twake-mail`, `open-paas`, `linphone`, `linid`, `matrix`, `rocket-chat`, `nextcloud`, `owncloud`, `sogo`, `ia-souveraine`, `open-source`, `cybersecurity`, `other`.

**Que se passe-t-il si le LLM propose un domaine ou un tag qui n'existe pas encore ?**

Le LLM peut retourner des propositions préfixées `NEW:` (ex : `NEW:lincloud-federation`). Ces propositions ne sont pas créées directement en tant que métadonnées actives — elles sont mises en file d'attente admin avec le statut `pending` (`insertNewProposals()` dans `harvest-hint-processor.ts`). Un administrateur doit valider ou rejeter chaque proposition avant qu'elle devienne utilisable dans les filtres de recherche.

Exception : si la source de confiance est `human-direct` ou `llm-confirmed` (voir section 2.6 ci-dessous), la proposition est directement créée avec le statut `active` sans passer par la queue.

Règle de non-écrasement : si le tag ou domaine proposé existe déjà dans la base (quel que soit son statut : pending, active, rejected), `onConflictDoNothing` s'applique — le LLM ne peut pas modifier une métadonnée humainement arbitrée.

**Conséquences concrètes du statut d'un tag :**

Le statut dans le référentiel `fragmentTags` détermine principalement si le LLM connaît ce tag ou non lors des prochaines ingestions. Les fragments déjà taggés, eux, continuent à fonctionner normalement quelle que soit l'évolution du statut.

| Contexte                            | `active`                                  | `pending`                                          | `rejected`             |
| ----------------------------------- | ----------------------------------------- | -------------------------------------------------- | ---------------------- |
| LLM de classification (ingestion)   | ✅ Visible — peut être proposé            | ❌ Invisible                                       | ❌ Invisible           |
| Pool A (détection dans section)     | ✅ Si présent sur des fragments existants | ✅ Idem — lu sur les fragments, pas le référentiel | ✅ Idem                |
| Dropdowns de recherche / filtres UI | ✅ Proposé                                | ❌ Absent des listes                               | ❌ Absent des listes   |
| Fragments déjà porteurs de ce tag   | ✅ Trouvables                             | ✅ Toujours trouvables                             | ✅ Toujours trouvables |

En pratique : un tag `pending` ne sera plus _suggéré_ lors de nouvelles ingestions, mais les fragments qui le portent déjà restent pleinement utilisables. Il attend une décision admin (valider → `active`, ou refuser → `rejected`). Un tag `rejected` peut être restauré en `pending` si un humain l'utilise explicitement comme hint lors d'un upload (`flushHintReferentials` — l'intention humaine prime sur le rejet antérieur).

### 2.6 — Hints utilisateur et notion de confiance (humain vs. LLM)

#### Qu'est-ce qu'un hint ?

Au moment de l'upload, l'utilisateur peut fournir des _hints_ : un domaine (`domain`) et/ou des tags (`tags[]`) qu'il sait pertinents pour le document. Ce sont des informations humaines, pas des suggestions IA. Exemple : "ce document parle de LinShare, taguer les fragments avec `client:canut`".

Les hints sont définis par `UploadHints = { domain?: string, tags?: string[] }` (`schema/trust-source.ts`).

#### Comment les hints sont appliqués (`applyUploadHintsInPlace`)

L'application est sélective — un hint n'est pas forcé en bloc sur tout le document :

- **Tags** : pour chaque tag hint, le pipeline vérifie si le body du bloc mentionne le mot-clé du tag (ex : pour `client:canut`, le mot-clé est `canut`). Si oui → tag forcé sur ce bloc. Les blocs qui ne mentionnent pas le mot-clé ne sont pas taggés.

- **Domain** : l'override domain ne se déclenche que si trois conditions sont simultanément vraies :
  1. Le hint domain est un domaine _nouveau_ (pas encore dans les référentiels)
  2. Le LLM a classé le bloc dans `"other"` (il n'a pas de meilleure réponse)
  3. Le body du bloc contient le mot-clé du domaine

  Si le LLM a déjà classé correctement (ex : `twake`), le hint domain n'écrase pas. Cela évite de forcer un label générique sur des fragments qui parlent d'autre chose.

#### La notion de trustSource : qui a décidé cette métadonnée ?

Chaque champ de métadonnée (domain, tags) porte une `trustSource` qui indique son origine. Il y a 4 valeurs possibles (`TrustSource` dans `schema/trust-source.ts`) :

| Valeur          | Signification                                                                  |
| --------------- | ------------------------------------------------------------------------------ |
| `llm-inferred`  | Pas de hint — le LLM a décidé seul                                             |
| `llm-confirmed` | Il y avait un hint ET le LLM est d'accord avec lui                             |
| `llm-deviation` | Il y avait un hint mais le LLM a choisi autre chose                            |
| `human-direct`  | Correction manuelle explicite par un admin — jamais positionné automatiquement |

`determineTrustSource(hint, llmValue)` calcule cette valeur champ par champ. `overallTrustSource()` retourne le "pire" trust source parmi tous les champs d'un bloc (llm-deviation > llm-inferred > llm-confirmed > human-direct) — c'est ce score global qui s'affiche dans l'UI de validation.

**Impact sur les nouvelles propositions** : si `trustSource` est `human-direct` ou `llm-confirmed`, la nouvelle métadonnée est directement activée (`status: 'active'`). Si c'est `llm-inferred` ou `llm-deviation`, elle passe en attente admin (`status: 'pending'`).

**Après le pipeline** (`flushHintReferentials`) : les hint tags effectivement appliqués à au moins un fragment sont upsertés dans le référentiel avec `trustSource: 'human-direct'`. Si un tag hint avait été précédemment rejeté par un admin, il est restauré en `pending` — l'intention humaine explicite prime sur le rejet antérieur.

### 2.7 — Déduplication en cascade (3 niveaux)

Le but est d'éviter d'enrichir la bibliothèque avec des fragments quasi-identiques à des fragments déjà existants, même si la formulation a légèrement changé (ce qui arrive fréquemment quand un document est mis à jour ou qu'un LLM a reformulé une idée).

**Niveau L1 — Hash exact** : normalisation lowercase + collapse whitespace → comparaison de chaînes. Détecte les doublons parfaits entre fragments du même job d'ingestion.

**Niveau L2 — Shingles Jaccard** (`dedupe/shingles.ts`) : une "shingle" est un groupe de 3 mots consécutifs. On calcule la similarité de Jaccard entre les deux ensembles de shingles. Seuil : 0.70 par défaut. Filtre préalable : même domaine/type/lang pour éviter les faux positifs. Permet de détecter les reformulations avec ~15–20% de variation de vocabulaire.

**Niveau L3 — Cosinus Milvus** (`dedupe/dedup-pipeline.ts`) : comparaison par vecteur d'embedding contre les fragments déjà approuvés en bibliothèque. Seuil : 0.65. Asynchrone — retourne les blocs inchangés si Milvus est indisponible. Détecte les paraphrases sémantiques même avec un vocabulaire très différent.

Le champ `duplicate_method` (`'hash'` | `'shingles'` | `'cosine'`) est stocké sur le candidat pour traçabilité.

### 2.8 — LLM-as-judge qualité lors de l'ingestion (`quality-judge.ts`)

Après la déduplication, chaque candidat non-doublon passe par un juge LLM qui évalue sa qualité intrinsèque en tant que fragment réutilisable. C'est différent de la classification : le LLM ne demande pas "quel domaine ?" mais "ce fragment est-il bon ?"

Le juge évalue 3 dimensions (`JudgeResult`) :

| Dimension                       | Ce que le LLM vérifie                                                                                                                                        | Verdict                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------- |
| **Réutilisabilité**             | Le fragment est-il auto-suffisant ? Pas de "comme mentionné ci-dessus", pas de pronoms sans antécédent, pas de "de plus" qui supposent un contexte antérieur | `pass` / `partial` / `fail` |
| **Cohérence sémantique**        | Le fragment exprime-t-il UNE seule idée lisible en isolation ? Pas deux sujets distincts mélangés                                                            | `pass` / `partial` / `fail` |
| **Précision de classification** | Le domaine, le type et les tags assignés correspondent-ils au contenu réel ?                                                                                 | `pass` / `partial` / `fail` |

**Résultat** : `overall_recommendation: 'accept' | 'review' | 'reject'` + une phrase de raison.

**Lien avec le référentiel** : le juge reçoit la liste des domaines validés, des types validés, et des tags actifs du référentiel. Si les métadonnées assignées par le LLM de classification sont incorrectes ou approximatives, le juge peut suggérer des corrections (`suggested_metadata`) en utilisant uniquement des valeurs existant dans le référentiel — ce qui garantit la cohérence avec la bibliothèque existante.

**Quand le juge ne s'exécute pas** : `shouldRunJudge(hasDuplicate)` — si le candidat est un doublon d'un fragment existant, le juge est sauté (pas utile d'évaluer ce qui sera de toute façon dupliqué).

Le résultat est stocké dans `harvestCandidates.judge_result` (JSON) et visible dans l'UI de validation — l'humain voit à la fois le score de confiance LLM (classification) et la recommandation du juge (qualité), ce qui lui permet de prioriser sa validation.

### 2.9 — Taux de confiance et statut de validation

Le champ `confidence` (0–1) est produit par le LLM lors de la classification. Il exprime la certitude du LLM sur ses propres choix de métadonnées : un fragment sur un produit Linagora clairement identifié avec des tags reconnus aura une confiance haute ; un fragment générique dont le domaine est ambigu aura une confiance basse.

Règle d'affichage dans l'UI de validation (calculée par `getMetadataStatus()`) :

- `confidence ≥ 0.85` et aucune nouvelle proposition de tag → **auto-validated** (vert) — l'admin peut faire confiance, validation rapide
- `confidence ≥ 0.6` et ≤ 2 nouvelles propositions → **needs-review** (orange) — mérite un coup d'œil
- Sinon → **requires-review** (rouge) — le LLM n'est pas sûr, attention requise

---

## Section 3 — Interface de validation Harvest

### 3.1 — Workflow de validation

Après exécution du pipeline (`POST /v1/harvest/jobs`), les candidats sont disponibles dans la table `harvestCandidates` avec statut `pending`. L'UI admin (`/admin/harvest`) liste les candidats par job.

Pour chaque candidat, le validateur peut :

- **Approuver** : crée un fragment en statut `draft` dans la bibliothèque (incrémente via `fragmentService.create()`)
- **Rejeter** : marque le candidat comme `rejected` (non créé)
- **Éditer** : modifier inline domaine, type, langue, tags, titre, corps avant approbation
- **Approbation en masse** : bulk approve sur une collection entière (accessible depuis la vue collection)

### 3.2 — Édition des métadonnées par le contributeur

L'UI expose deux niveaux d'édition :

- **Fragment individuel** : drawer (`fragment-detail-drawer.tsx`) pour éditer body, domaine, type, tags, titres
- **Vue collections** (`collections-view.tsx`) : gestion des collections structurées (fragments avec `payload_schema`)

Le validateur expert peut ajuster les métadonnées produites par le LLM avant d'approuver. Les propositions de nouveaux tags (`new_proposals.tags`) sont affichées séparément des tags existants pour guider l'arbitrage.

### 3.3 — Limitations connues au 9 juin 2026

**Bug #37 — Fragments invisibles après approbation** : le pipeline crée les fragments avec statut `draft`, mais la page de validation filtre par défaut sur `reviewed`. Les fragments fraîchement approuvés n'apparaissent pas dans la liste de validation — ils sont bien créés mais il faut changer le filtre manuellement pour les voir.

**Bug #29 — Seuil de confiance non fonctionnel** : le paramètre `min_confidence` envoyé à `runPipeline()` est accepté mais n'est pas utilisé pour filtrer les candidats. Tous les candidats passent quels que soient leur score.

**Bug #30 — Harvest trop lent** : sur des documents longs (> 50 pages), la classification LLM séquentielle chunk-par-chunk prend plusieurs minutes. Pas de parallélisation du step LLM.

**Bug #12 — Édition harvester** : l'édition inline des métadonnées d'un candidat avant approbation présente des incohérences de sauvegarde dans certains cas.

**Limitation — Retrieval des fragments-tableau dépendant des mots-clés** : les fragments issus de tableaux ont des bodies très courts (8-15 mots générés par `toBody()`). La similarité cosinus seule ne suffit pas à les retrouver. En pratique, le retrieval fonctionne via le Pool A (forced candidates par tag détecté dans le titre de section) — mais cela suppose que le rédacteur du plan inclue des termes précis dans les titres ou descriptions de sections ("engagements SLA", "grille tarifaire"). Si le titre de la section est générique ("Conditions de service"), les fragments-tableau ne remonteront pas. Il n'existe pas de mode de recherche structuré sur le `payload` (ex : "chercher toutes les lignes SLA où niveau = Critique").

---

## Section 3.5 — Vue d'ensemble : le LLM-as-judge dans Fragmint

Le patron LLM-as-judge revient à 4 endroits différents dans le système. À chaque fois, le principe est le même : au lieu de calculer une métrique déterministe, on demande à un LLM d'émettre un jugement motivé. Cela permet d'évaluer des dimensions qualitatives (pertinence contextuelle, cohérence, fidélité) qui résistent aux métriques classiques.

| Instance                 | Quand                                           | Rôle                                                                                                                                                                               | Fichier                          |
| ------------------------ | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| **Quality judge**        | Ingestion, après dédup                          | Évalue la qualité intrinsèque du fragment : réutilisabilité, cohérence, précision des métadonnées. Peut suggérer des corrections de type/domaine/tags en référence au référentiel. | `services/quality-judge.ts`      |
| **Hybrid batch judge**   | Retrieval (mode hybrid), 1 appel par section    | Note chaque fragment 0-10 pour sa pertinence à la section, en tenant compte du contexte du plan (`spec_context`). Alimente le classement RRF.                                      | `retrieval/hybrid-retriever.ts`  |
| **Agentic batch scorer** | Retrieval (mode agentic), Phase 2               | Double évaluation parallèle (températures 0.2 et 0.4), score moyen. Détecte l'ambiguïté via l'écart entre les deux agents.                                                         | `retrieval/agentic-retriever.ts` |
| **Groundedness checker** | Composition, après génération de chaque section | Vérifie que le draft ne contient pas d'affirmations non sourcées dans les fragments. Retourne des flags avec niveau de risque (high/medium/low).                                   | `services/plan-assembler.ts`     |

**Ce qui distingue ces 4 instances :**

- **Quality judge** : juge _le fragment lui-même_, indépendamment de tout plan. Question : "ce bloc est-il un bon fragment de bibliothèque ?"
- **Hybrid/Agentic judge** : juge _la pertinence d'un fragment pour une section précise_. Question : "ce fragment est-il utile ici, dans ce document ?"
- **Groundedness checker** : juge _le texte généré_, en le comparant aux sources. Question : "est-ce que le draft dit des choses que les fragments ne disent pas ?"

Les 4 sont asynchrones par rapport au chemin critique utilisateur — le quality judge ne bloque pas la validation, les juges de retrieval s'exécutent avant que l'utilisateur sélectionne, le groundedness check se lance après que le draft est retourné.

**Lien avec le référentiel (quality judge uniquement)** : c'est le seul judge qui connaît le référentiel. Il reçoit la liste des domaines, types et tags validés, ce qui lui permet de suggérer des métadonnées cohérentes avec ce qui existe déjà dans la bibliothèque — et d'alerter quand la classification automatique a produit une valeur hors-référentiel.

---

## Section 4 — Architecture technique du retrieval et de la composition

### 4.A — Vue d'ensemble : trois modes de retrieval

Pour trouver les fragments pertinents pour chaque section d'un plan, Fragmint dispose de trois stratégies ("modes") qui représentent un compromis vitesse / qualité / coût LLM. Les trois coexistent dans le code et sont basculables à chaud sans redémarrage.

| Mode           | Résumé                                                 | Coût LLM           |
| -------------- | ------------------------------------------------------ | ------------------ |
| `vector-only`  | Similarité cosinus pure, aucun LLM                     | Aucun              |
| `hybrid`       | Cosinus + 1 appel LLM juge par section                 | 1 appel/section    |
| `agentic-only` | 3 phases LLM (sélection, évaluation, self-consistency) | 3–5 appels/section |

Tous implémentent la même interface `FragmentRetriever.searchForSection(query, limit)` — le reste du code (PlanAssembler, MCP, routes) ne sait pas quel mode est actif. Le mode actif est configuré via `FRAGMINT_RETRIEVAL_MODE` ou modifiable à chaud par `POST /v1/admin/retrieval/mode`.

### 4.A.1 — Filtres : comment le plan oriente la recherche

Avant tout appel au retriever, `PlanService` construit une `SectionQuery` qui encapsule tout ce que le retriever doit savoir sur cette section. Les **filtres** (`PlanFilters`) sont le mécanisme par lequel les contraintes du plan sont transmises.

`PlanFilters` contient quatre champs (schéma Zod `plan.ts`) :

| Champ    | Type       | Rôle                                                       |
| -------- | ---------- | ---------------------------------------------------------- |
| `domain` | `string[]` | Limite aux fragments d'un ou plusieurs domaines            |
| `lang`   | `string`   | Langue des fragments (`fr`, `en`…) — filtre dur            |
| `type`   | `string`   | Type de contenu souhaité (`argument`, `reference`…)        |
| `tags`   | `string[]` | Tags requis — enrichit la requête vectorielle et le Pool A |

Ces filtres sont définis au niveau du plan entier, et chaque section peut avoir un `filters_override` qui les surcharge localement (ex : une section en anglais dans un plan en français).

**Comment les filtres voyagent dans le pipeline :**

1. `buildCorpusSummary(filters)` : avant de générer le plan, le LLM reçoit un résumé des fragments disponibles _dans le périmètre des filtres_ — il ne propose donc pas de sections sur des domaines absents du corpus.

2. `runSectionSearch(section, filters, ...)` construit l'`enrichedText` : `titre section + description + extrait pertinent du spec_prompt (1500 chars)`. C'est ce texte enrichi qui est vectorisé et envoyé à Milvus.

3. Les filtres `lang` et `type` sont des **filtres durs** pour VectorRetriever (clause WHERE en SQL/Milvus). Pour HybridRetriever et AgenticRetriever, ils sont aussi injectés en prose dans le texte de requête ("fragments in French about twake") via `enrichQueryWithFilters()` — ce sont des **filtres doux** pour le LLM.

4. **Pool A** (`computePoolA`) : les tags et domaines présents dans le titre/description de la section sont détectés par correspondance de mots-clés, et les fragments portant ces tags sont forcés dans le pool de recherche — indépendamment du score vectoriel.

**Pool A en détail (`computePoolA`) :**

Les tags namespaced (`produit:twake-workplace`) sont prioritaires sur les bare tags (`migration`) : ils remplissent les slots en premier. Les tags détectés font l'objet de deux requêtes SQLite : `searchByTags(namespacedTags)` puis `searchByTags(bareTags)` pour les slots restants. Les domaines sont détectés uniquement dans le _titre_ de la section (pas la description) pour éviter les faux positifs.

**Filtre global à l'issue du retrieval :** les résultats dont le score est < `SECTION_SCORE_THRESHOLD = 0.2` sont éliminés (sauf fragments provenant du Pool A, qui passent quelle que soit leur valeur cosinus).

**Déduplication inter-sections (`dedupCandidatesAcrossSections`) :** un même fragment ne peut apparaître que dans une seule section. Attribution par meilleur score ; si l'écart est ≤ 0.15, l'affinité de type tranche (ex : un fragment `reference` va préférentiellement à la section dont `inferred_type` est `reference`). Une table de compatibilité `INFERRED_TYPE_FRAGMENT_MAP` définit les types "proches" (ex : `introduction` accepte `argument`, `use-case`, `engagement`).

**Niveau de confiance de section (`section_confidence`) :**

Après retrieval, chaque section reçoit un indicateur de qualité calculé par `computeSectionConfidence(candidates)` :

- `good` : meilleur score LLM ≥ 9 (ou cosinus ≥ 0.80 en mode vector-only)
- `partial` : meilleur score LLM ≥ 7 (ou cosinus ≥ 0.65)
- `poor` : sous ces seuils
- `empty` : aucun candidat trouvé

Ce niveau est affiché dans l'UI pour guider l'utilisateur sur les sections qui méritent une vérification manuelle.

---

### 4.A.2 — Les 12 types éditoriaux

Chaque fragment porte un **type éditorial** qui décrit sa fonction rhétorique — pas son domaine ou sa langue, mais ce qu'il _fait_ dans un document : argumenter, référencer, s'engager contractuellement, etc. Ce type guide le LLM qui génère le plan ("quel type de contenu ai-je besoin pour cette section ?"), influe sur le retrieval, et arbitre les cas d'ex æquo lors de la déduplication inter-sections.

12 types sont disponibles dans le référentiel (`fragment_types` en DB) :

| Type           | Rôle dans un document                                            |
| -------------- | ---------------------------------------------------------------- |
| `introduction` | Mise en contexte, présentation du sujet ou de l'organisation     |
| `argument`     | Point de valeur, différenciateur, argument de vente              |
| `use-case`     | Cas d'usage client concret, exemple d'utilisation réelle         |
| `methodology`  | Description d'une approche, d'un processus, d'une méthode        |
| `engagement`   | Engagement contractuel, promesse, commitment SLA ou commercial   |
| `reference`    | Référence client nommée, déploiement existant, preuve sociale    |
| `testimonial`  | Citation client, verbatim, retour d'expérience direct            |
| `pricing`      | Ligne tarifaire, grille de prix, modèle économique               |
| `faq`          | Question-réponse, objection traitée                              |
| `conclusion`   | Synthèse, appel à l'action, clôture de document                  |
| `bio`          | Présentation d'une personne ou d'une équipe                      |
| `clause`       | Clause contractuelle, condition générale, exigence de conformité |

**Inférence du type à l'ingestion** : le LLM de classification choisit le type dans ce référentiel lors de l'ingestion. Il peut proposer `NEW:<type>` si aucun type existant ne convient — cette proposition passe en `pending` dans `fragment_types` jusqu'à validation admin.

**Rôle du type au retrieval** : en mode agentic, un fragment dont le type correspond exactement au `inferred_type` de la section reçoit un boost ×2.5 sur son score en Phase 2 (`agentic-retriever.ts`). En mode hybrid, le type est injecté dans le contexte du prompt LLM sans constituer un filtre dur.

**`INFERRED_TYPE_FRAGMENT_MAP` — la table d'affinité** (`plan-service.ts:48`) : ce n'est pas un classement au retrieval mais un **tiebreaker de déduplication inter-sections**. Quand un même fragment obtient des scores proches (gap < 0.15) pour deux sections différentes, son type tranche l'attribution :

- Correspondance exacte → affinité 1.0 (attribution prioritaire)
- Type "proche" dans la map → affinité 0.7
- Pas de relation → affinité 0.0

| Section `inferred_type` | Types de fragments compatibles (affinité 0.7) |
| ----------------------- | --------------------------------------------- |
| `introduction`          | `argument`, `use-case`, `engagement`          |
| `reference`             | `testimonial`, `bio`, `use-case`              |
| `pricing`               | `argument`, `clause`                          |
| `faq`                   | `argument`, `use-case`                        |
| `testimonial`           | `reference`, `bio`                            |

**Cas des fragments-tableau** : les fragments issus de tableaux structurés (avec `payload_schema`) reçoivent leur type du LLM de classification comme n'importe quel autre fragment. Un tableau de tarifs → `pricing` ; une grille SLA → `engagement` ou `clause` ; une liste de références → `reference`. Le `payload_schema` (ex : `pricing-line-v1`) décrit la structure des données, indépendamment du type éditorial.

---

### 4.B — Modes en détail

#### 4.B.1 — `vector-only`

Le mode le plus simple et le plus rapide. Le texte de la section est transformé en vecteur d'embedding, et on cherche les fragments dont le vecteur est le plus proche dans l'espace sémantique. Aucun LLM n'intervient — c'est de la géométrie pure. Suffit quand le corpus est bien structuré et les sections clairement formulées.

**Mécanique :**

1. `SearchService.search()` avec `quality_min: 'approved'`, filtres durs `lang`, `type`, `collectionSlug`
2. Score cosinus Milvus 1024D, puis re-ranking : multiplicateurs qualité (`approved` ×1.0, `reviewed` ×0.95, `draft` ×0.80) + boost fraîcheur + momentum d'usage
3. Seuil de rejet : fragments avec cosinus < `0.20` éliminés
4. Fallback automatique : si Milvus est inactif → SQLite LIKE sur le titre/body, `score: null` (jamais une valeur fictive), `score_breakdown.method = 'sqlite_like'`

Pool A ignoré en mode vector-only : les `forced_candidates` ne sont pas intégrés.

---

#### 4.B.2 — `hybrid`

Le mode intermédiaire : on commence par une recherche vectorielle rapide (comme `vector-only`), puis on demande à un LLM de noter les candidats en tenant compte du contexte du document. L'idée est de corriger les limites du cosinus pur : deux textes peuvent être sémantiquement proches (cosinus élevé) sans que l'un soit vraiment utile _pour ce document précis_. Le LLM juge la pertinence contextuelle, pas juste la similarité formelle.

**5 étapes (`hybrid-retriever.ts`, 304 lignes) :**

**Étape 1 — Pêche large par vecteur** : on récupère `max(limit × 4, 8)` candidats vecteur — délibérément large pour donner matière au LLM. Les filtres doux (domaines, tags) sont injectés en prose dans le texte de requête.

**Étape 1b — Fusion Pool A** : les fragments forcés (issus de tags/domaines détectés dans la section) qui ne figurent pas dans les résultats vecteur sont ajoutés. L'ensemble forme le pool de jugement complet.

**Étape 2 — LLM-as-judge batch** : un seul appel LLM (2e instance du patron LLM-as-judge — voir Section 3.5) pour noter tous les candidats de 0 à 10. Le contexte du plan (`spec_context`, 300 chars) est inclus dans le prompt pour que le LLM juge "pour ce document" et non en absolu. Les candidats sont présentés avec leur domaine mais sans leur type (éviter que le LLM juge par correspondance formelle plutôt que par contenu). Format de réponse attendu : `{"id-fragment": 9, ...}`.

**Étape 3 — Deux classements parallèles** :

- `list1` : classement par score cosinus (ce que dit Milvus)
- `list2` : classement par note LLM décroissante (ce que dit le juge)

**Étape 4 — Fusion RRF (Reciprocal Rank Fusion)** : au lieu de moyenner les scores bruts (qui sont sur des échelles différentes), on fusionne par les _rangs_. La formule de Cormack 2009 combine les positions de chaque fragment dans les deux classements :

```
Score RRF(fragment) = w_vecteur / (60 + rang_vecteur) + w_llm / (60 + rang_llm)
```

La constante `60` adoucit l'effet du rang 1. Les poids `[3, 7]` (preset `literature`) donnent 30% au classement vecteur et 70% au classement LLM — le LLM est jugé plus fiable que le cosinus pur. Le résultat est normalisé en [0,1].

**Étape 5 — Nettoyage et score final** :

- Fragments absents de la réponse LLM → éliminés (rejet implicite), sauf si le LLM a été tronqué
- _Détection de truncation_ : si le LLM n'a scoré < 90% des candidats, on suppose qu'il a manqué de contexte — les fragments non-scorés sont conservés avec leur rang vecteur seulement
- `llmFloor = 3` : tout fragment scoré < 3 par le LLM est rejeté
- Score final : `normalizedRRF × (score_llm / 10)` — le score RRF est "pesé" par la qualité LLM

`score_breakdown` : `{ method: 'hybrid_rrf', vector_score, vector_rank, llm_score, llm_rank, rrf_score, rrf_k, final_score }`.
`retrieval_source` : `'vector'` | `'tag'` | `'both'` — indique si le fragment vient du pool vecteur, du Pool A, ou des deux.

---

#### 4.B.3 — `agentic-only`

Le mode le plus sophistiqué. Au lieu de se contenter d'un classement vectoriel ou d'un jugement global, le retriever agentique raisonne explicitement : il lit l'index, choisit quels fragments méritent d'être évalués, les note avec deux agents indépendants et compare leurs avis. C'est plus lent (3–5 appels LLM par section), mais c'est le seul mode qui peut naviguer intelligemment dans un grand corpus et choisir des fragments très spécifiques qui n'auraient pas de forte similarité cosinus.

**3 phases (`agentic-retriever.ts`, 510 lignes) :**

**Phase 0 — Navigation dans le corpus (conditionnelle)** : si le corpus dépasse 200 fragments _et_ qu'aucun filtre domaine n'est actif, un premier LLM lit un "table des matières" du corpus (pas le contenu complet — juste les domaines et types disponibles) et sélectionne les combinaisons `domain:type` pertinentes pour ce plan. Cela évite d'envoyer un index de 500 fragments en Phase 1. Si le corpus est petit ou déjà filtré par domaine, cette phase est sautée.

**Phase 1 — Sélection des candidats** : le LLM lit l'index complet des fragments filtrés (format markdown avec IDs lisibles, ex: `TM-arg-001`) et choisit lesquels il veut évaluer plus finement. Il retourne un tableau JSON d'IDs. Un `buildReadableIdMap()` traduit ces IDs lisibles en UUIDs internes.

**Phase 1b — Fusion Pool A** : les fragments forcés (tags/domaines) non sélectionnés en Phase 1 sont ajoutés au pool.

**Phase 2 — Double évaluation avec self-consistency** : chaque fragment est noté de 0 à 10, par batches de 25 (`BATCH_JUDGE_SIZE`). La _self-consistency_ lance **deux appels LLM en parallèle** à des températures différentes (0.2 et 0.4) pour vérifier que le jugement est stable. Le score final est la **moyenne** des deux notes normalisées. Si les deux notes diffèrent de plus de 0.3, un avertissement `STRONG_DISAGREEMENT` est loggé — signe que le fragment est ambigu pour ce contexte.

Cas de panne : si un seul agent répond, son score est utilisé seul. Si les deux échouent, les candidats sont retournés dans l'ordre Phase 1 sans note.

Fragments avec score normalisé < 0.3 sont éliminés. Boost ×2.5 sur les fragments dont le type correspond exactement au `inferred_type` de la section.

**Exécution parallèle inter-sections** : `searchForSectionsBatch()` exécute Phase 0 pour **toutes** les sections, puis Phase 1 pour toutes, puis Phase 2 pour toutes — et non section par section. Le chemin critique est 3 rounds quelle que soit la longueur du plan.

`score_breakdown` : `{ method: 'agentic', llm_score, consistency_delta }` — `consistency_delta` = écart entre les deux agents.

---

#### 4.B.4 — Pool A : candidats forcés par tags/domaine

`PlanService.computePoolA()` analyse le texte de chaque section, détecte les tags et domaines explicitement mentionnés, puis interroge la bibliothèque via `searchByTags()` et `searchByDomain()`. Les fragments trouvés sont passés dans `SectionQuery.forced_candidates`.

En mode hybrid : Pool A est jugé par le LLM au même titre que le Pool B vecteur ; les fragments forcés entrent dans `list2` (ordre LLM) mais pas dans `list1` (ordre vecteur, car pas de score cosinus pour eux).

En mode agentic : Pool A est injecté entre Phase 1 et Phase 2, jugé par le batch LLM avec tous les candidats.

`PlanService.dedupCandidatesAcrossSections()` déduplique ensuite les candidats entre sections (`DEDUP_CLEAR_GAP = 0.15`, tie-breaker par alignement de type).

---

#### 4.B.5 — Score breakdown

Tous les modes retournent un champ `score_breakdown` (type `ScoreBreakdown` dans `fragment-retriever.ts`) rendu dans un Tooltip par le composant `<ScoreBreakdown>` de l'UI :

| Mode          | Champs présents                                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------------- |
| `vector`      | `method: 'vector'`, `vector_score` (cosinus capé 1.0)                                                               |
| `sqlite_like` | `method: 'sqlite_like'` (pas de score, classement par usage)                                                        |
| `hybrid_rrf`  | `method: 'hybrid_rrf'`, `vector_score`, `vector_rank`, `llm_score`, `llm_rank`, `rrf_score`, `rrf_k`, `final_score` |
| `agentic`     | `method: 'agentic'`, `llm_score`, `consistency_delta`                                                               |

`llm_score` et `final_score` sont `undefined` (jamais `null` ni `0`) quand le juge LLM a échoué — pas de score neutre fictif.

---

#### 4.B.6 — Comparaison empirique des 3 modes

Les tests ont été effectués sur un vault LinShare réel : plan AO pour une collectivité de 5 000 agents, 6 sections, corpus de 120 puis 146 fragments approuvés. Tests réalisés les 27 et 28 mai 2026 (`EVALS.md`).

**Résumé : quand utiliser quel mode ?**

| Condition                                         | Mode recommandé  | Raison                                                      |
| ------------------------------------------------- | ---------------- | ----------------------------------------------------------- |
| Vault domain-cohérent (< 200 frags, 1-2 produits) | **agentic-only** | Raisonnement explicite, précision supérieure                |
| Vault multi-domaines dense (> 500 frags)          | **hybrid**       | Le LLM reranking démêle les domaines que le cosinus confond |
| Sections techniques à vocabulaire flou            | **hybrid**       | Remonte des fragments à cosinus 45–46% que vector rate      |
| Démo rapide ou pas de LLM disponible              | **vector-only**  | Zéro appel LLM, acceptable sur vault bien structuré         |

---

**Test 1 — Plan AO LinShare, 6 sections, vault ~120 fragments (2026-05-27 v1)**

| Section                | Agentic                        | Vector                          | Hybrid                        |
| ---------------------- | ------------------------------ | ------------------------------- | ----------------------------- |
| Présentation LinShare  | ✅ LinShare-spécifique (0.90)  | ❌ AppFlowy + séparateur (0.69) | ❌ RGPD en #1 (0.78)          |
| Sécurité & chiffrement | ✅ chiffrement LinShare (0.90) | ⚠️ Twake ECS générique (0.60)   | ⚠️ Twake ECS générique (0.60) |
| Conformité RGPD        | ✅ fragment RGPD exact (0.90)  | ✅ RGPD exact (0.80)            | ✅ RGPD exact (0.86)          |
| Références clients     | ✅ déploiements nommés (0.90)  | ❌ description LPS (0.68)       | ❌ description LPS (0.57)     |
| Plan de migration      | ✅ (réversibilité tangent)     | ❌ exit strategy confondue      | ⚠️ exit strategy confondue    |
| SLA                    | ⚠️ séparateur en #1 ❌ (bug)   | ⚠️ SLA générique (0.75)         | ✅ SLA précis (0.83)          |

**Ce qu'on observe** : le vector-only souffre du _domain drift_ — le vault contenait ~60% de fragments Twake/ECS avec un vocabulaire proche (souveraineté, RGPD, sécurité), qui noyait les fragments LinShare-spécifiques. L'agentic comprend l'intent ("présentation LinShare" = chercher des fragments qui parlent _de_ LinShare, pas de la souveraineté en général). La section SLA agentic avait un bug (fragment séparateur `--------` indexé — corrigé par `isSeparatorBlock()`).

---

**Test 2 — Après réindexation Milvus complète, vault 146 fragments (2026-05-27 v2)**

| Section               | Agentic                                    | Hybrid                        | Vector                                 |
| --------------------- | ------------------------------------------ | ----------------------------- | -------------------------------------- |
| Présentation LinShare | ✅✅✅ 3 fragments LinShare directs (0.90) | ✅✅⚠️ #3 = ref client (0.78) | ✅✅⚠️ #3 = ref client (0.78)          |
| Références clients    | ✅✅✅ CHU/IDF/Ministère nommés (0.90)     | ✅✅✅ Ministère/CHU/overview | ⚠️✅✅ overview générique en #1 (0.88) |
| SLA                   | ✅✅✅ SLA LinShare précis                 | ✅✅✅ SLA LinShare précis    | ✅✅✅ SLA LinShare précis             |
| Migration             | ⚠️ doublon #1 et #3 (même fragment)        | ✅⚠️⚠️                        | ✅⚠️⚠️                                 |

**Enseignement** : après réindexation, hybrid ≈ vector sur un vault cohérent. Le LLM reranking confirme l'ordre cosinus existant — il n'apporte presque rien quand les 20 candidats Milvus préfiltrés sont tous du bon domaine. **L'utilité de hybrid se révèle sur les sections à vocabulaire technique flou** (voir Test 3 ci-dessous).

---

**Test 3 — Non-régression post-fixes, 3 sections × 3 modes (2026-05-28)**

Vault : 146 fragments, LLM floor=3 actif.

**Section "Références clients"** — là où hybrid gagne sur les rangs

| Rang | Vector                           | Hybrid + floor=3                                           | Agentic                       |
| ---- | -------------------------------- | ---------------------------------------------------------- | ----------------------------- |
| 1    | 84% — _150 org._ ✅              | 98% — Ministère Agri ✅ (llm=9)                            | 90% — Admin. pénitentiaire ✅ |
| 2    | 75% — _présentation_ ❌          | 98% — _150 org._ ✅ (llm=8)                                | 90% — CHU Bordeaux ✅         |
| 3    | 75% — Ministère Agri ✅          | 96% — CHU Bordeaux ✅ cosinus=68% (llm=9)                  | 90% — Conseil Régional IDF ✅ |
| 4    | 71% — _alt. souveraine_ ❌       | 95% — _présentation_ ❌ (llm=2 → **éliminé par floor**)    | 90% — Ministère Agri ✅       |
| 5    | CHU 69%, Conseil 62% **absents** | 94% — _alt. souveraine_ ❌ (llm=4 → **éliminé par floor**) | 90% — _150 org._ ✅           |

**Section "Architecture technique"** — le cas d'usage signature du mode hybrid

| Rang | Vector                             | Hybrid + floor=3                                              | Agentic                            |
| ---- | ---------------------------------- | ------------------------------------------------------------- | ---------------------------------- |
| 1    | 54% — Env. technique ✅            | 98% — Démarche déploiement ✅ (llm=8)                         | 90% — Architecture 4 composants ✅ |
| 2    | 53% — Démarche déploiement ✅      | 96% — Env. technique ✅ (llm=6)                               | 80% — Démarche déploiement ✅      |
| 3    | 51% — Architecture 4 composants ✅ | 96% — **Adaptabilité déploiement** ✅ cosinus=**46%** (llm=9) | 80% — Chiffrement niveaux ✅       |
| 4    | 48% — Descr. technique ✅          | 95% — Architecture 4 composants ✅ (llm=7)                    | 80% — Migration propriétaire ✅    |
| 5    | **48% — APT (menace cyber) ❌**    | 93% — **Approche méthodologique** ✅ cosinus=**45%** (llm=9)  | 80% — Réversibilité ✅             |

**Ce qu'on observe** : sur la section "Architecture technique", vector-only n'a que des scores 45–54% — la sémantique est floue, le modèle hésite. Hybrid remonte deux fragments que vector ne trouve jamais (_Adaptabilité déploiement_ à 46% de cosinus, _Approche méthodologique_ à 45%) parce que le LLM comprend leur pertinence (llm=9 sur les deux). Il élimine aussi le faux positif sur les menaces APT (fragment cyber classé pertinent par le vecteur, rejeté par le LLM). **C'est l'argument démo le plus fort pour hybrid.**

**Narrative démo (archive EVALS.md) :**

> "Sur l'architecture technique, vector-only donne des scores de 45–54% — la sémantique est floue. Hybrid remonte deux fragments à 45–46% de cosinus que vector rate, parce que le LLM comprend qu'ils sont pertinents malgré une faible similarité textuelle. Et il élimine un faux positif sur les menaces cyber. C'est la valeur du LLM dans le retrieval."

---

**Scores agentic "plats" — pourquoi et comment les interpréter**

Les scores agentic sont compressés entre 0.7 et 0.9 — peu discriminants en apparence. Ce n'est pas un bug. La Phase 1 pré-sélectionne déjà les fragments pertinents ; Phase 2 note une population déjà filtrée. Tous les fragments dans la liste ont été jugés "bons" — d'où la concentration haute.

Narrative démo : _"Les scores sont homogènes car Phase 1 pré-sélectionne ; la valeur est dans la qualité des fragments et le raisonnement explicite, pas dans la dispersion du score."_

En pratique : pour le `section_confidence` et le tiebreaker de déduplication inter-sections, les scores vector/hybrid (continus 0.45–0.90) sont plus discriminants que les scores agentic. C'est pourquoi `SECTION_SCORE_THRESHOLD = 0.2` est calibré pour vector/hybrid — en agentic, le seuil pertinent serait ~0.7.

---

#### 4.B.6.7 — Historique des 8 correctifs majeurs (Phase 2)

| #     | Problème                                                                                                                                                                                                                                            | Correctif                                                                                                                                    | Résultat                                                                                        |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Fix 1 | **Formule linéaire non-homogène (hybrid)** — `0.4×cosinus + 0.6×(llm/10)` combinait deux distributions incomparables (Milvus cosinus ∈ [0.6, 0.95] vs LLM entier 0-10).                                                                             | Remplacement par RRF (Cormack 2009) : `Σ w_i / (k + rank_i)`, k=60, preset `literature` [3,7].                                               | Classement distribution-agnostique ; fragment LLM-top mais vecteur-moyen correctement promu.    |
| Fix 2 | **`score: 0.6` fictif (SQLite fallback)** — les résultats SQLite LIKE apparaissaient "modérément pertinents" dans l'UI et dans les calculs.                                                                                                         | `score: null` retourné par SQLite ; `reRankResults()` protégé contre null ; UI affiche "Non scoré".                                          | Signal honnête ; `score_breakdown.method: 'sqlite_like'` distinct de tous les modes vectoriels. |
| Fix 3 | **UUID mapping bug (agentic Phase 1)** — le LLM retournait des readable_ids (`TM-arg-001`) mais `fragmentService.getById(readable_id)` retournait null → 0 fragments en Phase 2.                                                                    | `buildReadableIdMap()` dans `index-service.ts` + traduction readable_id→UUID en fin de Phase 1.                                              | Mode agentic fonctionnel en production (était silencieusement vide).                            |
| Fix 4 | **Rejet implicite silencieux (hybrid)** — fragments absents de la réponse LLM gardaient un score neutre (5) au lieu d'être rejetés.                                                                                                                 | Fragments absents → rejetés (sauf `isTruncated`). `llmFloor = 3` : rejet des scores LLM < 3.                                                 | Élimination des fragments hors-sujet ; floor configurable.                                      |
| Fix 5 | **Détection de truncation absente (hybrid)** — quand le LLM atteignait sa limite de contexte, les fragments oubliés étaient rejetés silencieusement (confondu avec "pas pertinent").                                                                | `isTruncated = llmScoreMap.size / allCandidates.length < 0.9` → conservation des fragments non-scorés.                                       | Plus de perte de fragments pertinents par artefact de fenêtre de contexte.                      |
| Fix 6 | **Jugement hors-contexte document (hybrid + agentic)** — sans contexte de plan, le LLM jugeait la pertinence intrinsèque indépendamment du document cible (ex : "RGPD" classé #1 pour "Présentation LinShare"). Confirmé en eval 2026-05-27, Bug 2. | `spec_context: query.spec_prompt.slice(0, 300)` injecté dans le prompt de jugement `batchJudge`.                                             | Jugements pertinents au contexte du document cible.                                             |
| Fix 7 | **Domain override systématique (harvest)** — un `hint_domain` écrasait le domaine de TOUS les fragments du document, y compris ceux sur des produits différents.                                                                                    | Suppression de l'override global ; `hint_domain` reformulé comme "orientation — apply where relevant".                                       | Classement multi-produit correct dans un même document.                                         |
| Fix 8 | **Shingles k=3 remplace unigrams (supersedure + harvest)** — la détection de doublons utilisait des unigrams insuffisants pour les reformulations LLM (~15-20% de variation de mots).                                                               | Shingles k=3 (`generateShingles()`, `jaccardSimilarity()` dans `dedupe/shingles.ts`) ; cascade 3 niveaux ; seuil supersedure abaissé à 0.20. | Détection des reformulations LLM ; `duplicate_method` stocké pour transparence.                 |

---

### 4.C — Génération de section et vérification de groundedness

**Pipeline de génération** (`PlanAssembler.generateSection()`, `plan-assembler.ts`) :

1. Chargement des corps complets de fragments via `fragmentService.getById()` — les `selected[]` ne contiennent que `body_excerpt` (~200 chars)
2. Construction des messages via `buildSectionMessages()` (`plan-prompts.ts`) avec : titre/description section, corps fragments, langue, `plan_title`, `spec_prompt`, `writer_prompt_override`, `reference_docs`
3. Appel LLM → `generated_markdown`
4. Sauvegarde immédiate en DB + retour HTTP — **le draft est disponible sans attendre le groundedness check**
5. Incrémentation du compteur `uses` sur chaque fragment utilisé (table `planFragmentUsages` + `fragments.uses`)

**Génération parallèle** (`generateAllSections()`) : sémaphore `makeSemaphore(llmConcurrency ?? 3)`, toutes les sections en parallèle, puis `assemble()`. Re-fetch avant écriture pour éviter la race condition entre sections générées simultanément.

**Assemblage** (`assemble()`) : frontmatter YAML (`title:`), puis pour chaque section : `# ${s.title}` + `generated_markdown`. Suppression du heading dupliqué : si la première ligne du `generated_markdown` est un heading (`#`-`######`) dont le texte correspond au titre de la section (case-insensitive), cette ligne est supprimée.

**Groundedness check — LLM-as-judge sur le draft (asynchrone)** : c'est le quatrième judge du système (voir Section 3.5). Il s'exécute après que le draft est retourné à l'utilisateur — il ne bloque pas l'affichage. `scheduleGroundednessCheck()` déclenche via `void` (fire-and-forget), contrôlé par `groundSemaphore`. Appel LLM à `temperature: 0` (déterministe, conservateur). Re-fetch du plan avant update pour éviter les race conditions entre sections générées en parallèle. `parseGroundednessFlags()` extrait le premier tableau JSON via regex, valide avec Zod, retourne `[]` en cas d'erreur de parsing.

**Quatre niveaux de risque** :
| Niveau | Critère | Exemple |
|--------|---------|---------|
| `high` | Fait précis ou engagement non sourcé dans les fragments | Chiffre inventé, SLA non mentionné |
| `medium` | Reformulation qui change le sens | "peut" → "doit", omission d'une restriction |
| `low` | Ajout éditorial générique | Transitions rhétoriques, formules de politesse |

**UI** : point coloré dans la sidebar par section (rouge / orange / jaune selon risque le plus élevé) ; `GroundednessPanel` sous la textarea de rédaction, non bloquant.

**Formats d'export** :
| Format | Méthode | Dépendance |
|--------|---------|-----------|
| Markdown | `exportMarkdown()` | Aucune |
| DOCX | `exportDocx()` | Pandoc + template Word de référence optionnel |
| PPTX | `exportPptx()` | Pandoc |
| Marp HTML | `exportSlides()` | `renderMarpFromString()`, thème `default`/`gaia`/`uncover`/`linagora` |
| Reveal.js HTML | `exportReveal()` | CDN reveal.js@5 (en-ligne), thème `white` ou `linagora` |

Thème `linagora` : couleur `#2B579A`, police Calibri, `border-top: 3px solid #2B579A` (slides).

---

### 4.D — Génération du plan avec conscience du corpus

Quand un utilisateur demande à Fragmint de générer un plan à partir d'un spec ("je veux une propale pour le Conseil des Barreaux, sections : présentation Linagora, argumentaire produit, engagements SLA"), le système ne laisse pas le LLM inventer librement. Il consulte d'abord ce qui existe vraiment dans la bibliothèque, puis instruit le LLM de ne proposer que des sections qu'il pourra effectivement remplir.

**`buildCorpusSummary(filters)`** (`plan-service.ts`) : avant l'appel LLM, une requête SQL compte les fragments approuvés par domaine et par type. Si le corpus contient < 20 fragments approuvés, le résumé n'est pas généré (pas assez de matière). Sinon, le LLM reçoit un bloc comme :

```
Available corpus (145 approved fragments):
Domains: linshare (42), twake (38), linagora-corp (21), other (44)
Types (with domain coverage):
  argument (58): linshare (24), twake (19), other (15)
  reference (31): linshare (12), twake (10), linagora-corp (9)
  ...
Structured data sources: table_id="sla_engagements" (5 rows, schema=..., source=offre-linshare)
```

Avec ce résumé, le LLM sait qu'il ne doit pas proposer de section "Témoignages clients sector santé" si la bibliothèque n'en a aucun. Les filtres du plan (`domain`, `tags`) sont appliqués à ce résumé — si le plan est filtré sur `domain: linshare`, le LLM ne voit que les fragments LinShare.

**Type de section : comment il est inféré**

Le LLM de génération de plan inclut dans chaque section qu'il propose une ligne `**Type:** <slug>` (ex : `**Type:** reference`). Ce marqueur est parsé immédiatement par `extractType()` dans `plan-section-parser.ts` pour pré-remplir `section.inferred_type`. Si le LLM oublie ce marqueur, `inferSectionTypes()` est appelé en fallback (autre appel LLM).

Le `inferred_type` sert ensuite au retrieval (boost ×2.5 pour correspondance exacte en mode agentic, filtre doux en hybrid), et au tiebreaker de déduplication inter-sections.

**Sanitisation** : `sanitizeSections()` force `conclusion` en dernière position et plafonne à 13 sections maximum.

**Mode template** : `createFromTemplate()` crée un plan directement à statut `plan_validated` avec des sections pré-définies — sans passer par la génération LLM. Utile pour les structures documentaires fixes (contrats-cadres, réponses à cahier des charges normalisé). Non encore exposé dans l'UI, accessible via API (`POST /v1/plans/from-template`).

---

## Section 5 — Perspectives et évolutions

### 5.1 — Skill OpenCode (livraison Phase 2)

L'intégration OpenCode est livrée et commitée sur la branche `mission-phase-2` :

- `opencode.json` à la racine du projet : configuration MCP → `node packages/mcp/dist/index.js`
- Token lu depuis la variable d'environnement `FRAGMINT_TOKEN` (pas de secret hardcodé)
- `docs/opencode/SKILL.md` : documentation du workflow pour l'agent OpenCode

Le Skill enseigne à l'agent le workflow complet :

1. `plan_create` → créer un plan avec spec en langage naturel
2. `plan_generate` → générer le plan de sections (corpus-aware)
3. `plan_section_search` → retrieval de fragments par section
4. `plan_export` → export final (format au choix)

Outils complémentaires exposés via MCP : `fragment_search`, `get_index`, `list_subjects`, `document_compose` (mode template).

### 5.2 — Mode template et composition structurée

Le mode template (`createFromTemplate()`) permet de composer un document à partir d'un plan de sections entièrement prédéfini, sans génération LLM du plan. Un plan créé depuis un template démarre directement au statut `plan_validated` — le retrieval et la composition peuvent être lancés immédiatement. Cas d'usage : contrats-cadres, réponses à appels d'offres avec structure imposée, rapports récurrents.

**Ce qui est implémenté** : `POST /v1/plans/from-template` accepte un `template_id` et crée un plan avec les sections prédéfinies (`planTemplates.sections_json` en DB). Non encore exposé dans l'UI Web — accessible via API uniquement.

**Ce qui manque** : le builder de templates (créer un template réutilisable depuis un plan existant validé) n'est pas implémenté. De même, un template peut définir une section "Grille tarifaire" ou "Engagements SLA" mais **ne peut pas lier cette section à une collection structurée spécifique** ni indiquer que le retrieval doit cibler des fragments avec `payload_schema = sla-row-v1`. En l'état, le rédacteur doit formuler explicitement ces contraintes dans le titre ou la description de section pour que le Pool A les détecte. Une version plus riche des templates permettrait de pré-spécifier : `{ "section": "SLA", "inferred_type": "engagement", "forced_collection": "sla_engagements_linshare" }` — ce qui garantirait que les fragments-tableau pertinents remontent sans dépendre des mots-clés du rédacteur.

### 5.3 — Évolutions envisagées

#### 5.3.1 — Relations inter-fragments

La Phase 2 a simplifié en n'implémentant pas les relations implicites entre fragments (supersedure temporelle, traductions, versions). Le schéma SQLite inclut déjà `translation_of` et `parent_id` mais sans UI d'exploration.

Évolution envisagée : graphe de relations inter-fragments dans l'UI admin, détection automatique de supersedure lors de l'approbation d'un fragment (fragment plus récent + cosinus > 0.85 → proposition de remplacement).

#### 5.3.2 — Intégration Fragmint / pas-completer (POC)

_Note : pas-completer est l'outil de Patrick Bellamy (séparé de Fragmint)._

Le document de recherche `.claude/PRPs/research/2026-06-05-fragmint-pas-completer-integration.md` identifie 6 abstractions directement mutualisables :

| Abstraction Fragmint                       | Rôle dans pas-completer                                                                 |
| ------------------------------------------ | --------------------------------------------------------------------------------------- |
| `FragmentRetriever.searchForSection()`     | Retrieval des exigences auxquelles répond un fragment                                   |
| `SearchFilters` (type, domain, lang, tags) | Filtrage de la bibliothèque par nature d'exigence                                       |
| `payload` + `payload_schema`               | Stockage structuré : `{ requirement_id, status, declaration }` sans migration de schéma |
| `harvestCandidates`                        | Modélise l'état intermédiaire que pas-completer gère en Excel                           |
| `reRankResults()`                          | Re-classement des réponses à exigences par pertinence                                   |
| Collections                                | Groupement par lot d'exigences (ex : "exigences PASSI", "exigences EBIOS")              |

Architecture POC proposée : pas-completer envoie une exigence comme `SectionQuery.text` + `SectionQuery.filters.type = 'compliance'` → `FragmentRetriever.searchForSection()` → réponses classées avec `score_breakdown`. Les réponses acceptées sont stockées comme fragments avec `payload.requirement_id` et `payload.status`.

Limitation principale : pas-completer requiert une interface tabulaire (exigences × réponses) que l'UI Fragmint actuelle ne gère pas nativement.

#### 5.3.3 — Repenser le stockage et le retrieval des lignes de tableau

Le modèle actuel "1 fragment = 1 ligne de tableau" est un choix délibéré, mais discutable. Il mérite d'être reposé à mesure que les cas d'usage réels se précisent.

**Pourquoi ce choix a du sens** : la granularité ligne permet de réutiliser une seule référence client ou un seul niveau SLA dans n'importe quel contexte documentaire, sans embarquer l'intégralité du tableau. Le système peut aussi assembler un tableau à la carte (filtrer les lignes Gold uniquement, exclure les lignes obsolètes).

**Pourquoi ce choix pose problème** :

- **Body trop court pour l'embedding** : un body de 12 mots ne produit pas un vecteur sémantiquement riche. Le retrieval cosinus dégénère — toutes les lignes d'un même tableau ont des vecteurs proches les uns des autres et du tableau entier, rendant le classement aléatoire.
- **Dépendance aux mots-clés du rédacteur** : le retrieval via Pool A fonctionne si le titre de section contient "SLA" ou "tarification" — mais c'est une contrainte implicite, pas documentée, qui surprend les utilisateurs.
- **Schéma→type hardcodé** : `generic-row-v1` mappe vers le type `pricing` même quand le tableau n'a rien à voir avec du pricing. Toute table non reconnue hérite de ce type par défaut.
- **Pas de requête structurée** : il n'est pas possible de chercher "toutes les lignes SLA avec pénalité > 5%" — la recherche s'effectue uniquement sur le body texte, pas sur les champs JSON du payload.

**Trois pistes d'évolution** :

1. **Enrichir le body à l'ingestion** : au lieu de générer seulement "Niveau Critique : prise en charge sous 2h", enrichir avec le contexte de la collection ("Grille SLA LinShare — ") et les colonnes principales. Un body de 40-60 mots avec contexte produit un embedding plus discriminant.

2. **Mode retrieval structuré via SQL** : pour les sections dont le type est `engagement` ou `pricing`, ajouter une requête SQL directe sur le champ `payload` en complément de la recherche vectorielle. Exemple : `WHERE payload_schema = 'sla-row-v1' AND json_extract(payload, '$.niveau') LIKE '%Critique%'`. Cela ne dépend pas de l'embedding.

3. **Revenir à un modèle tableau-entier** : stocker le tableau entier comme un seul fragment (body = représentation textuelle complète du tableau), et utiliser les lignes individuelles comme metadata enrichie. Plus simple à retriever, moins granulaire à la composition.

#### 5.3.4 — Milvus en production

Milvus est désactivé par défaut (`FRAGMINT_MILVUS_ENABLED=false`) — la démo utilise le fallback SQLite LIKE. Le score cosinus réel (Qwen3-Embedding-0.6B, 1024D) améliore significativement la pertinence des modes vector-only et hybrid.

Prochaine étape : activer Milvus sur l'environnement de démo (`docker-compose.yml` inclut déjà etcd + minio + milvus), indexer le corpus, comparer les métriques avec et sans Milvus.

#### 5.3.5 — Contrôle fin du périmètre de collection

Un plan a un champ `collection_slug` nullable. Si `null`, le retrieval cherche dans toutes les collections accessibles — c'est le comportement par défaut en dev/démo. Si une valeur est définie (`collection_slug = 'linshare'`), le retrieval est scopé à cette collection uniquement.

Ce qui n'existe pas encore : la possibilité de sélectionner un sous-ensemble précis de collections (ex : corpus commun Linagora + corpus confidentiel client, mais pas les corpus d'autres équipes). En l'état, c'est tout-ou-rien. Évolution envisagée : un plan pourrait spécifier `allowed_collections: ['linagora-common', 'client-canut']` avec des règles de permissions différenciées par collection.

#### 5.3.6 — Intégration dans un éditeur de document

La valeur de Fragmint est maximale quand il s'insère dans le workflow naturel des rédacteurs, plutôt que de fonctionner comme un outil parallèle. L'intégration envisagée avec un éditeur de type OnlyOffice ou LibreOffice permettrait deux modes d'usage :

- **Mode suggéré** : l'utilisateur écrit librement, Fragmint analyse le contexte du paragraphe en cours et suggère des fragments pertinents dans un panneau latéral. L'utilisateur insère d'un clic.
- **Mode guidé** : Fragmint pilote la structure (sections prédéfinies par un plan), l'utilisateur écrit et valide section par section. Adapté aux documents fortement normés (PAS, réponses à appels d'offres avec cahier des charges imposé).

L'API Fragmint expose déjà tous les endpoints nécessaires (`/v1/plans`, `/v1/plans/:id/search`, MCP tools) — l'intégration éditeur serait une couche frontend sans modification du backend.

#### 5.3.7 — Architecture commune avec OpenRAG

_Note : cette perspective est à discuter avec Paul Tran-Van et Michel-Marie Maudet — pas une décision actée._

Fragmint est aujourd'hui un système complet (ingestion + stockage + retrieval + composition). Une évolution possible serait de repositionner Fragmint comme **couche d'orchestration éditoriale** sur un backbone de retrieval mutualisé (OpenRAG), plutôt que de maintenir en parallèle deux stacks de retrieval au sein de Linagora.

Dans ce modèle :

- OpenRAG fournit le retrieval éprouvé et l'infrastructure vectorielle (embeddings, index, cache)
- Fragmint apporte la couche métier : types éditoriaux, validation humaine, plans structurés, composition, export
- pas-completer et d'autres frontaux spécialisés s'appuient sur le même backbone

L'intérêt : éviter la duplication d'infrastructure IA, mutualiser la maintenance des modèles d'embedding, et converger vers une seule source de vérité pour les fragments validés. La contrainte : le modèle de données Fragmint (vault Git, SQLite, payload_schema, types éditoriaux) est suffisamment spécifique pour qu'une migration ne soit pas triviale.

#### 5.3.8 — Sujets ouverts à arbitrer

Ces questions n'ont pas de réponse tranchée au 10 juin 2026. Elles méritent un échange lors de la démo :

- **Roadmap commercialisation** : Fragmint reste-t-il un outil interne Linagora ou est-il envisagé comme produit autonome ? La réponse conditionne les priorités de robustesse et d'UX.
- **Positionnement vis-à-vis de pas-completer** : intégration profonde (pas-completer utilise Fragmint comme backend), complémentarité (deux outils distincts partageant des fragments), ou convergence (un seul outil capable des deux cas d'usage) ?
- **Budget LLM et choix du modèle** : la démo utilise Mistral-Small-3.2-24B via `ai.linagora.com`. En production large volume, le coût par génération de plan (~30 appels LLM en mode agentic) devient significatif. Quel seuil d'acceptabilité ?
- **Suite de la mission après le 10 juin** : maintien en condition opérationnelle, transfert de compétences, ou poursuite du développement ?

---

## Annexes

### Annexe A — Algorithmes de scoring

#### A.1 — RRF (Reciprocal Rank Fusion)

Formule implémentée dans `retrieval/rrf.ts` :

```
RRF(d) = Σ_{i} w_i / (k + rank_i(d))
```

- `k = 60` (constante Cormack 2009 — adoucit l'effet du rang 1)
- `w_i` : poids par liste (preset `literature` = [3, 7] → 30% vecteur, 70% LLM)
- `rank_i(d)` : rang 1-based du fragment `d` dans la liste `i` (absent → contribution nulle)

Normalisation : `normalizeRrfScore(rrf_score, weights, k) = rrf_score / maxRrf`
où `maxRrf = Σ w_i / (k + 1)` (score d'un fragment hypothétique #1 dans toutes les listes).

Presets disponibles :
| Preset | Poids [vecteur, LLM] | Cas d'usage |
|--------|---------------------|-------------|
| `balanced` | [1, 1] | Test, debug |
| `vector-heavy` | [2, 1] | Corpus sans LLM judge fiable |
| `llm-heavy` | [1, 2] | Confiance haute dans le LLM judge |
| `literature` | [3, 7] | Défaut recommandé |

#### A.2 — Shingles Jaccard

Implémenté dans `services/dedupe/shingles.ts`, zéro dépendance npm :

```
generateShingles(text, k=3) → Set<string>
  normalisation : lowercase, strip non-alphanums, split par mots
  shingle = k mots consécutifs jointés par espace

jaccardSimilarity(A, B) = |A∩B| / |A∪B|
```

Seuils utilisés :
| Contexte | Seuil | Fichier |
|---------|-------|---------|
| Dédup L2 harvest | 0.70 | `harvester-pipeline.ts` |
| Supersedure pre-filter | 0.20 | `supersedure-detector.ts` |
| Dédup L1 titre | 0.80 | `dedupe/dedup-pipeline.ts` |

#### A.3 — Re-ranking qualité (vector-only)

Appliqué après le score cosinus Milvus dans `search-service.ts` :

```
score_final = cosinus × quality_multiplier × freshness_boost × usage_momentum
quality_multiplier : approved=1.0, reviewed=0.95, draft=0.80
freshness_boost : décroissance exponentielle sur valid_until
usage_momentum : logarithmique sur fragment.uses
```

---

### Annexe B — Matrice des formats d'export

| Format         | Méthode            | Dépendance externe                     | Tables natives              | Slides | Thème Linagora             |
| -------------- | ------------------ | -------------------------------------- | --------------------------- | ------ | -------------------------- |
| Markdown       | `exportMarkdown()` | Aucune                                 | Non (Markdown)              | Non    | N/A                        |
| DOCX           | `exportDocx()`     | Pandoc + `docxReferencePath` optionnel | Oui (Word natif)            | Non    | Via template Word          |
| PPTX           | `exportPptx()`     | Pandoc                                 | Non (Pandoc → PPTX basique) | Oui    | Non                        |
| Marp HTML      | `exportSlides()`   | `renderMarpFromString()`               | Non                         | Oui    | Oui (`#2B579A`, Calibri)   |
| Reveal.js HTML | `exportReveal()`   | CDN jsdelivr (reveal.js@5)             | Non                         | Oui    | Oui (`border-top #2B579A`) |

> **Note Reveal.js** : le HTML généré référence le CDN `cdn.jsdelivr.net/npm/reveal.js@5`. En environnement hors-ligne, remplacer par un chemin local.

---

### Annexe C — Variables d'environnement clés

| Variable                           | Défaut                      | Description                                 |
| ---------------------------------- | --------------------------- | ------------------------------------------- |
| `FRAGMINT_STORE_PATH`              | `./example-vault`           | Chemin du vault Git                         |
| `FRAGMINT_LLM_ENDPOINT`            | `http://localhost:11434/v1` | URL base LLM (OpenAI-compatible)            |
| `FRAGMINT_EMBEDDING_ENDPOINT`      | `http://localhost:11434/v1` | URL base embeddings                         |
| `FRAGMINT_LLM_MODEL`               | `mistral-nemo:12b`          | Modèle LLM                                  |
| `FRAGMINT_EMBEDDING_MODEL`         | `nomic-embed-text-v2-moe`   | Modèle d'embedding                          |
| `FRAGMINT_MILVUS_ENABLED`          | `false`                     | Active Milvus                               |
| `FRAGMINT_PORT`                    | `3333`                      | Port API                                    |
| `FRAGMINT_RETRIEVAL_MODE`          | `vector-only`               | Mode retrieval par défaut                   |
| `FRAGMINT_LLM_CONCURRENCY`         | `3`                         | Concurrence LLM (génération + groundedness) |
| `FRAGMINT_DUPE_SHINGLES_THRESHOLD` | `0.70`                      | Seuil dédup shingles harvest                |

Configuration complète : `packages/server/src/config.ts`.

---

### Annexe D — Outils MCP exposés

Le serveur MCP (`packages/mcp/src/index.ts`) expose 9 outils via stdin/stdout :

| Outil                 | Description                                      |
| --------------------- | ------------------------------------------------ |
| `fragment_search`     | Recherche sémantique dans la bibliothèque        |
| `fragment_get`        | Récupère un fragment par ID                      |
| `get_index`           | Retourne l'index markdown complet (readable_ids) |
| `list_subjects`       | Liste les domaines/types disponibles             |
| `plan_create`         | Crée un nouveau plan                             |
| `plan_generate`       | Génère les sections (corpus-aware)               |
| `plan_section_search` | Retrieval de fragments pour une section          |
| `plan_export`         | Exporte le plan assemblé                         |
| `document_compose`    | Composition depuis un template                   |

Token d'authentification : variable d'environnement `FRAGMINT_TOKEN` dans `opencode.json`.

---

### Annexe E — Schéma des tables clés (`db/schema.ts`)

#### E.1 — `fragments` (bibliothèque approuvée)

| Colonne                      | Type    | Description                                                   |
| ---------------------------- | ------- | ------------------------------------------------------------- |
| `id`                         | TEXT PK | UUID du fragment                                              |
| `type`                       | TEXT    | Type éditorial (`argument`, `reference`, etc.)                |
| `domain`                     | TEXT    | Domaine produit (`linshare`, `twake`, etc.)                   |
| `lang`                       | TEXT    | Langue (`fr`, `en`)                                           |
| `quality`                    | TEXT    | Statut workflow : `draft` → `reviewed` → `approved`           |
| `author`                     | TEXT    | Auteur de la dernière modification                            |
| `title`                      | TEXT    | Titre court (dérivé du body ou saisi manuellement)            |
| `body_excerpt`               | TEXT    | Extrait (~200 chars) pour preview et embedding                |
| `body`                       | TEXT    | Corps complet (full text pour Milvus et génération)           |
| `uses`                       | INT     | Compteur de réutilisations dans des plans générés             |
| `readable_id`                | TEXT    | ID lisible `<DOMAIN>-<type>-<seq>` (ex: `LIN-arg-042`)        |
| `git_hash`                   | TEXT    | Hash du commit Git lors de l'approbation                      |
| `file_path`                  | TEXT    | Chemin `.md` dans le vault Git                                |
| `collection_slug`            | TEXT    | Collection d'appartenance (namespace Milvus)                  |
| `origin`                     | TEXT    | Origine : `harvest` ou `manual`                               |
| `harvest_confidence`         | REAL    | Score de confiance LLM à l'ingestion                          |
| `payload`                    | TEXT    | JSON des données structurées (fragments-lignes)               |
| `payload_schema`             | TEXT    | Identifiant de schéma (`pricing-line-v1`, `sla-row-v1`, etc.) |
| `source_position`            | INT     | Rang dans le document source (`(chunk+1)×10000 + block`)      |
| `parent_id`                  | TEXT    | Fragment parent (relations hiérarchiques)                     |
| `translation_of`             | TEXT    | Référence si traduction d'un autre fragment                   |
| `superseded_by`              | TEXT    | ID du fragment qui remplace celui-ci                          |
| `supersedes`                 | TEXT    | ID du fragment que celui-ci remplace                          |
| `valid_from` / `valid_until` | TEXT    | Fenêtre de validité temporelle (optionnel)                    |
| `tags`                       | TEXT    | JSON array des tags (`["client:canut", "sla"]`)               |

#### E.2 — `harvest_candidates` (file de validation)

Les fragments candidats issus du pipeline d'ingestion, avant approbation humaine.

| Colonne                      | Type    | Description                                            |
| ---------------------------- | ------- | ------------------------------------------------------ |
| `id`                         | TEXT PK | UUID du candidat                                       |
| `job_id`                     | TEXT    | Référence au job d'ingestion                           |
| `body`                       | TEXT    | Corps complet                                          |
| `type` / `domain` / `lang`   | TEXT    | Métadonnées inférées par LLM                           |
| `confidence`                 | REAL    | Score de confiance LLM (0–1)                           |
| `status`                     | TEXT    | `pending` → `accepted` ou `rejected`                   |
| `source_section`             | TEXT    | En-tête de section source dans le document original    |
| `duplicate_of`               | TEXT    | ID du fragment dupliqué si détecté                     |
| `duplicate_method`           | TEXT    | `hash`, `shingles`, ou `cosine`                        |
| `trust_sources_json`         | TEXT    | JSON : source de confiance par champ (hint vs LLM)     |
| `judge_result`               | TEXT    | JSON : résultat du LLM-as-judge qualité (3 dimensions) |
| `new_proposals`              | TEXT    | JSON : nouvelles métadonnées proposées par le LLM      |
| `payload` / `payload_schema` | TEXT    | Données structurées (fragments-tableau)                |
| `doc_position`               | INT     | Ordre dans le document source                          |

#### E.3 — `fragment_collections` (groupes structurés)

Ensemble de fragments issus d'un même tableau source.

| Colonne           | Type    | Description                                            |
| ----------------- | ------- | ------------------------------------------------------ |
| `id`              | TEXT PK | UUID de la collection                                  |
| `title`           | TEXT    | Nom de la collection (ex : "Engagements SLA LinShare") |
| `payload_schema`  | TEXT    | Schéma commun aux lignes membres                       |
| `member_ids`      | TEXT    | JSON array des IDs fragments (ordonnés)                |
| `source_document` | TEXT    | Fichier source d'origine                               |
| `collection_slug` | TEXT    | Namespace de collection (workspace)                    |

#### E.4 — `plans` (plans de composition)

| Colonne           | Type    | Description                                                                         |
| ----------------- | ------- | ----------------------------------------------------------------------------------- |
| `id`              | TEXT PK | `plan_<UUID>`                                                                       |
| `title`           | TEXT    | Titre du plan                                                                       |
| `owner`           | TEXT    | Login du créateur                                                                   |
| `collection_slug` | TEXT    | Collection dans laquelle puiser                                                     |
| `status`          | TEXT    | `draft` → `plan_generated` → `plan_validated` → `fragments_validated` → `completed` |
| `state_json`      | TEXT    | JSON complet : spec_prompt, filters, sections[], selected[], drafts, groundedness   |

Le champ `state_json` serialise toute l'architecture du plan : sections avec `inferred_type`, `candidates[]` (résultats retrieval avec `score_breakdown`), `selected[]` (fragments validés par l'humain), `generated_markdown`, `groundedness_flags`.

#### E.5 — `plan_templates` (modèles réutilisables)

| Colonne         | Type    | Description                                                              |
| --------------- | ------- | ------------------------------------------------------------------------ |
| `id`            | TEXT PK | UUID                                                                     |
| `name`          | TEXT    | Nom du template                                                          |
| `version`       | TEXT    | Version sémantique (`1.0.0`)                                             |
| `status`        | TEXT    | `active` ou `archived`                                                   |
| `sections_json` | TEXT    | JSON array des sections pré-définies (titre, description, inferred_type) |

#### E.6 — Référentiels de métadonnées

Trois tables partagent la même structure : `fragment_types`, `fragment_domains`, `fragment_tags`.

| Colonne        | Description                                                                        |
| -------------- | ---------------------------------------------------------------------------------- |
| `slug`         | PK — identifiant canonique (ex: `argument`, `linshare`, `client:canut`)            |
| `label`        | Libellé lisible                                                                    |
| `status`       | `active` (visible au LLM) / `pending` (en attente admin) / `rejected` / `archived` |
| `trust_source` | Origine : `human-direct`, `llm-confirmed`, `llm-inferred`, `llm-deviation`         |
| `usage_count`  | Nombre de fragments portant cette valeur                                           |
| `proposed_by`  | `admin` ou `harvest-hint`                                                          |

---

_Document généré le 9 juin 2026 — branche `mission-phase-2`_
_Basé sur l'analyse du code source et des plans de conception Superpowers_
