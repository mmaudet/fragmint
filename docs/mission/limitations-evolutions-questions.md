# Fragmint — Limitations, Évolutions et Questions ouvertes

> Notes accumulées pendant la mission de stabilisation (J1–J20).
> Alimentera Section 4 ("Limites actuelles") et Section 5 ("Évolutions recommandées")
> de la note de synthèse finale.
> Les questions ouvertes nécessitent une décision de mmaudet / Juliette avant d'être traitées.

---

## HARVESTER

### H0 — Roadmap optimisation vitesse et qualité du harvester (2026-05-12)

#### Vitesse — Quick wins (~1h30, gain combiné 8-12x)

**Contexte** : document 30 pages → 5-10 min d'ingestion. Bloquant pour la démo et le corpus Linagora (~50 docs). La parallélisation `Promise.all` a été essayée et revertée (Ollama séquentiel par défaut — voir bug #30).

**Action 1 — Multi-classification batched (1h, gain 5-10x)**
Modifier le prompt `classify()` pour accepter une liste de N candidats et retourner un JSON array. Batch de 5-10 candidats par appel LLM.
- Neutre sur la qualité (même modèle, même contexte)
- Amortit le coût fixe de chaque appel sur N candidats
- Risque : valider le format JSON array avec le modèle utilisé (OpenRouter vs Ollama)

**Action 2 — Modèle plus petit pour classify (30 min, gain 3-5x)**
Garder `mistral-nemo:12b` pour `segment()`. Tester `qwen2.5:7b-instruct` pour `classify()` — **déjà installé localement**, aucun `ollama pull` nécessaire. Candidat suivant si insuffisant : `qwen2.5:3b` (à puller).
- ⚠️ Ne pas activer avant golden dataset — même un modèle 7B peut aggraver le pattern "technical fourre-tout" sur des documents Linagora complexes

**Résultat combiné attendu** : document AURA (24 candidats) : 5-10 min → 30-60 sec.

#### Qualité — Quick wins (~1h30, gain mesurable sur classifications)

**Action 3 — Définitions enrichies dans le prompt classify (30 min)**
Aujourd'hui : liste sèche des 12 types. Demain : une ligne par type.
```
introduction: présente un contexte, un sujet ou une entité (entreprise, produit, projet)
argument: défend une position, justifie un choix, démontre une valeur client
cas-usage: décrit comment un produit résout un problème concret, avec exemple
methodology: décrit une démarche en étapes chronologiques ou un processus projet
reference-technique: documentation technique, certifications, normes, architecture
engagement: SLA, garantie contractuelle, engagement de service, niveau de support
```
Réduit le pattern "technical/methodology fourre-tout" observé sur 7 tests.

**Action 4 — Few-shot examples dans le prompt classify (1h)**
Ajouter 2-3 exemples concrets tirés des cas d'échec des 8 tests :
- "Capacité de partage et chiffrement (50 Go, AES-256, tarif 4,50€)" → `argument/technical` (pas `pricing` malgré la mention tarifaire)
- "Conformément au RGPD, les données personnelles sont traitées..." → `clause/legal`
- "Phase 1 : audit de l'existant. Phase 2 : migration. Phase 3 : formation." → `methodology/commercial`

#### Trade-off vitesse / qualité

| Levier | Vitesse | Qualité |
|--------|---------|---------|
| Modèle plus petit (classify) | +++ | -- (à mesurer) |
| Batching multi-classification | +++ | ~ neutre |
| Définitions enrichies | - (prompt plus long) | +++ |
| Few-shot examples | - (prompt plus long) | +++ |
| Golden dataset | ~ | ~ (mesure, pas amélioration) |

**Décision** : batching (neutre qualité) + définitions + few-shots (améliore qualité). L'allongement du prompt est amorti par le batching. Modèle plus petit : après validation golden dataset uniquement.

**Ordre d'implémentation** :
1. Définitions enrichies — 30 min, zéro risque
2. Batching classify — 1h, neutre qualité
3. Few-shot examples — 1h, sur les échecs persistants post-1
4. Golden dataset — en parallèle des 3 actions, prérequis pour valider le modèle plus petit
5. Modèle plus petit — seulement après seuil qualité validé sur golden dataset

#### Évolutions V2 (synthèse)
- Two-phase ingestion : phase 1 rapide visible, phase 2 async enrichissement
- Progress bar : polling `GET /v1/harvest/:jobId` toutes les 2s avec `progress.percentage`
- Skip `segment()` pour docs très structurés (H1/H2 explicites → bypass LLM)
- Cache embeddings : `hash(body)` → vector, évite recalcul sur ré-ingestion
- Streaming pipeline : gain ~30% vitesse perçue, effort 4-6h — mentionner en synthèse seulement
- GPU local : matériel, hors scope code mission

---

### H1 — Taxonomie de classification hardcodée (bug #11)

**État** : fix Phase A en place (`harvester-taxonomy.ts`), 7 domaines, 8 types, liste fermée.

**Limitation** : ajouter un domaine = modifier le code + redéployer. Taxonomie globale, pas différenciée par collection.

**Évolution V2** : externaliser dans le schema de collection (`allowed_domains`, `allowed_types`). L'owner gère sa taxonomie via UI. Pas de nouveau rôle — réutilise `owner`/`admin` existants. Effort : 1-2j dev + 0.5j cadrage mmaudet.

---

### H2 — Limites résiduelles de classification post-fix #11

**Test du 2026-05-10** : 7 candidats sur proposition-lyon-test.docx, classification diversifiée. Bug #11 résolu (~80% de précision).

**Anomalies observées** :
1. **Confusion type/domain** — "Tarification" → `pricing/commercial` au lieu de `pricing/lincloud`. Le LLM ne distingue pas toujours la fonction (type) du sujet (domain).
2. **Classification sans contexte de section** — "Engagements et garanties" → `pricing/technical` au lieu de `clause/legal`. Fragment lu isolément sans contexte de section parente.
3. **Segmentation titre vs contenu** — "Proposition Commerciale" extrait comme fragment isolé (juste métadonnées), aurait dû être fusionné avec l'introduction.
4. **Confiance auto-rapportée non calibrée (bug #29)** — le LLM retourne systématiquement 0.95 parce qu'avec la liste fermée + catch-all `other`, il a toujours une réponse valide. Le curseur "Confiance minimum" dans l'UI est sans effet. Stats consolidées sur 7 tests (~70 candidats) : 95% dans ~85% des cas, 90% dans ~10%, 85% dans ~3%, 80% dans ~2% (1 seul fragment, test 5), jamais sous 80%. Le filtre à 65% (par défaut) et le compteur "Faible confiance" sont sans effet en pratique.

Deux approches de fix étudiées :
- **P1 — Calibration par critères** : enrichir le prompt `classify()` avec des définitions multi-niveaux (1.0 = match exact mot-clé, 0.75 = hésitation entre deux options, 0.5 = usage de `other`). Risque : gpt-oss-120b peut ignorer les instructions complexes et continuer à mettre 0.95.
- **P2 — Deux candidats** : demander au LLM son choix primaire ET son alternative. Calculer la confiance finale comme `primary.confidence - alternative.confidence`. Mesure mécanique de l'hésitation, plus robuste que l'auto-rapport.

Approche recommandée : P1 + P2 combinés. Mais l'implémentation correcte nécessite de tester le comportement du modèle réel, de vérifier que le format JSON plus complexe ne casse pas, et de mettre à jour les tests unitaires. Voir bug #29 pour le checklist complet.

**Évolutions** :
- **E1** (2-3h) — Prompt enrichi avec définitions : `"type = fonction du fragment. domain = sujet auquel il se rapporte."`
- **E2** (2-3h) — Passer le titre de section parent au LLM pour le contexte
- **E3** (1j) — Améliorer le chunking pour fusionner titres et premier paragraphe
- **E4** (V3) — Confiance réellement variable via logprobs ou calibration explicite

**Priorité** : E1 et E2 si temps Phase 2. E3 et E4 hors scope mission.

---

### H2b — Test 2 : recettes-mamie-suzanne.docx (2026-05-10)

**Setup** : fix #11 appliqué (taxonomie hardcodée). DB contenant ~7 fragments lincloud du test 1.

**Résultats bruts** : 2 candidats extraits (4-7 attendus pour 2 recettes complètes avec ingrédients + étapes + conseils).

| Fragment | Type | Domaine | Confiance |
|---|---|---|---|
| La ratatouille provençale traditionnelle | methodology | other | 95% |
| La tarte tatin | methodology | technical | 95% |

**Bug #11 : CONFIRMÉ FIXÉ** — aucun fragment forcé en `lincloud`. Le catch-all `other` est attribué correctement pour la ratatouille.

**Nouvelles limitations identifiées** :

**Limitation A — Granularité adaptative, pas fixe** *(révisée 2026-05-10, test 5)*
Observation initiale (tests 1-4, documents courts) : 1 fragment par H1, sous-sections fusionnées.
Observation sur doc long (test 5, proposition-aura-complete.docx, ~30 pages) : 24 fragments extraits sur 10 H1 + ~30 H2. Le harvester descend au niveau H2 quand les sections H1 sont longues.
Hypothèse révisée : la granularité dépend de la longueur des sections, pas d'une règle fixe. Les sections > seuil (~6000 chars de chunk) sont décomposées au niveau suivant.
Implication : pour le corpus Linagora réel (propositions longues), la granularité sera probablement satisfaisante. La limitation se manifeste surtout sur les documents courts ou peu structurés.

**Limitation B — Stabilité de classification faible**
Deux recettes du même document reçoivent des domaines différents (`other` vs `technical`). Le LLM ne produit pas des résultats déterministes sur des inputs proches.
Cause probable : `temperature: 0.2` + absence de contexte du document parent.
Évolution V2 (1h) : réduire temperature à 0.0 ou 0.1 pour la classification. Ou enrichir le prompt avec "autres fragments du même document classés en X — pour cohérence intra-document".

**Limitation C — Types et domaines utilisés comme fourre-tout** *(renforcée tests 5 et 7)*
Sur recettes (tests 2-3) : `methodology` utilisé pour toute séquence d'étapes (54% des fragments).
Sur proposition commerciale (test 5) : `technical` utilisé pour 75% des fragments d'un document de vente.
Sur note de réflexion stratégique (test 7, mêlant légal, économique, géopolitique) : `technical` utilisé pour 85% des fragments — y compris "Évolutions réglementaires" (NIS2, DORA, IA Act), "Initiatives européennes", "Ecosystem of Partners", "Human Dimension of Transition".

**Stats consolidées sur 7 tests :**
- Test 1 (proposition Lyon) : 0% technical (avant fix #11 — tout était lincloud)
- Tests 2-3 (recettes, kubernetes) : technical bien utilisé pour du contenu réellement technique
- Test 5 (proposition AURA longue) : 75% technical sur doc commercial
- Test 7 (note réflexion souveraineté) : 85% technical sur doc stratégique/légal/géopolitique

Pattern confirmé : le LLM utilise `technical` comme catch-all pour tout vocabulaire spécialisé hors taxonomie business courante. `methodology` idem pour toute séquence d'étapes.
Cause : prompt `classify()` sans définitions ni exemples différenciant "domaine du contenu" (technique) vs "contexte du document" (stratégique, légal, commercial).
Évolution V2 (2-3h) : enrichir le prompt `classify()` avec des règles explicites :
- `methodology` = phases d'un processus chronologique projet uniquement
- `technical` = contenu décrivant une architecture, un composant ou une intégration technique
- `commercial` = propositions de valeur, arguments de vente, contexte client
- `legal` = réglementation, conformité, contrats, RGPD, NIS2
- `other` = contenu hors-scope des catégories ci-dessus

**Limitation F — Titres générés en anglais malgré contenu français** *(renforcée test 7)*
Sur proposition-aura-complete.docx (test 5) : "Workplace Approach", "Three Fundamental Principles of Our Methodology", "Economic Benefits and Return on Investment".
Sur memo-sans-structure.docx (test 7) : 5 fragments sur 13 avec titre EN + body FR — "Current Open Models", "Client Feedback on Migration", "Budgetary Considerations", "Ecosystem of Partners", "Human Dimension of Transition".
Cas plus grave sur test 7 : 3 fragments avec body intégralement en anglais ("Challenges in Transition", "Opportunity for European Cloud and Collaborative Software Actors", "Call for Action") malgré `lang: fr` — le LLM a potentiellement traduit le contenu (bug #31).
Fix appliqué et validé (bug #31, 2026-05-10) : prompt `segment()` réécrit avec règles explicites — body = copie verbatim, titre = même langue que le body. Validé sur FR (memo-sans-structure : 0/15 titres EN) et EN (kubernetes-best-practices : 9/9 titres EN, aucune sur-correction).

**Périmètre** : ces limitations sont non-bloquantes pour la démo (le corpus Linagora ne contient pas de recettes). À documenter dans la note de synthèse.

---

### H2c — Test 3 : kubernetes-best-practices.docx (2026-05-10)

**Setup** : fix #11 appliqué. DB : 7 fragments lincloud (test 1) + 2 recettes (test 2).

**Résultats bruts** : 4 candidats extraits, 0 doublons, 0 faible confiance. Tous : `methodology/technical`, langue `en`.

**Validations** :
- ✅ Détection de langue FR/EN fonctionne
- ✅ Domaine `technical` correctement attribué (pas de dérive vers `lincloud`)
- ✅ Pas de faux positifs doublons avec les corpus précédents

**Renforcement Limitation A — segmentation grossière (état avant fix #31)** :
Le document contenait 4 sections H1 + 6 sous-sections H2 (10 unités logiques). Le harvester avait produit 4 fragments — 1 par H1, sous-sections fusionnées.

**Mise à jour post-fix #31 (prompt segment() restructuré)** :
Même document re-harvesté après le fix → 9 fragments au niveau H2 ("Resource Requests and Limits", "Quality of Service Classes", "Pod Anti-Affinity", etc.). Amélioration notable : la granularité est désormais au niveau H2, ce qui donne des fragments plus ciblés et réutilisables dans les slots. La Limitation A reste réelle sur les documents très courts ou très peu structurés (voir test 7), mais atténuée sur les documents avec une vraie hiérarchie H2.

Pour le corpus Linagora : une proposition avec H1 "Solution proposée" + 5 H2 produira probablement 5 fragments (1 par H2), ce qui est le bon niveau de granularité pour les slots de composition.

**Nouvelle observation — sur-utilisation de `type: methodology`** :
Pattern sur 3 tests : test 1 → 1/7 en methodology, test 2 → 2/2, test 3 → 4/4. Total : 7/13 (54%) des fragments classés `methodology`. Les types `argument` et `cas-usage` sont sous-utilisés.
Le LLM utilise `methodology` comme fourre-tout pour tout contenu structuré en étapes ou bonnes pratiques.
Cause : prompt `classify()` sans exemples ni règles de désambiguïsation entre types proches.

**Évolution V2 (2-3h) — enrichir le prompt `classify()` avec des règles explicites** :
- `methodology` = phases d'un processus chronologique (déploiement, migration, cycle de vie projet)
- `cas-usage` = caractéristiques statiques d'un produit, concept ou composant, exemple concret
- `argument` = raison de choisir, justification, bénéfice client
- `engagement` = SLA, garantie, contenu hors-scope des autres types

Cette évolution est prioritaire sur E1/E2 si du temps est disponible en Phase 2 — le taux de 54% en `methodology` dégrade la précision des slots de composition.

---

### H2d — Test 7 : memo-sans-structure.docx (2026-05-10)

**Setup** : doc FR intégralement sans structure H1/H2, note de réflexion stratégique sur la souveraineté numérique (légal, économique, géopolitique, technique mélangés).

**Résultats** : 13 fragments extraits, 0 doublon, 0 faible confiance.

**Validations** :
- ✅ Granularité correcte malgré l'absence de structure (13 fragments cohérents)
- ✅ Titres pertinents et descriptifs
- ✅ Langue détectée correctement (`fr` partout)
- ✅ Quelques classifications correctes : `legal` pour "Domination des hyperscalers", `other` pour "Budgetary Considerations"
- ✅ Pas de doublon faux positif

**Anomalies** :
- **Limitation C renforcée** : 85% des fragments en `technical` sur un doc à dominante légale/géopolitique/économique
- **Bug #31 observé ici, fixé ensuite** : 5 titres EN sur body FR, 3 bodies potentiellement traduits en anglais — fix validé sur tests FR et EN ultérieurs (voir Limitation F)
- **Bug #29 confirmé** : 10/13 à 95%, 3 à 90%, 1 à 85%, aucun sous 80%

---

### H2e — Test 8 : faq-redondante.docx (2026-05-12)

**Setup** : FAQ commerciale LinShare Pro, 6 questions explicites format "Q : ... / R : ...", avec redondances intentionnelles (tarif 4,50 € mentionné 3×, "ministères régaliens" répété, "30 jours d'évaluation" répété). Premier test post-réalignement taxonomie (fix bug #11).

**Résultats bruts** : 7 candidats, 0 doublon, 0 faible confiance, 7 valides.

| Fragment | Type | Domaine |
|---|---|---|
| Qu'est-ce que LinShare Pro ? | bio | technical |
| Capacité de partage et chiffrement | pricing | commercial |
| Tarification de LinShare Pro | pricing | pricing |
| Fonctionnalités principales | cas-usage | technical |
| Certifications de LinShare Pro | reference-technique | technical |
| Souscription à LinShare Pro | faq | technical |
| Délais de déploiement | methodology | technical |

**Validations** :
- ✅ 5 nouveaux types utilisés : `bio`, `cas-usage`, `reference-technique`, `faq`, `pricing` — fix bug #11 confirmé opérationnel
- ✅ `faq` correctement identifié pour le pattern question-réponse "Souscription"
- ✅ `reference-technique` excellent pour les certifications
- ✅ 0 doublon sur redondances intentionnelles — comportement attendu (seuil 0.80 textuel, pas sémantique)
- ✅ Titres en français, body verbatim — fix #31 tient

**Classifications discutables** :
- `bio` pour "Qu'est-ce que LinShare Pro ?" — le LLM utilise `bio` comme "présentation d'entité produit". `bio` était probablement prévu pour les biographies de personnes. Défendable mais hors usage prévu.
- `cas-usage` pour "Fonctionnalités principales" — faute de `description` dans la taxonomie, le LLM choisit le type le plus proche. Renforce la question H4b sur `description`.
- `pricing` pour "Capacité de partage et chiffrement" — erreur : fragment sur les fonctionnalités techniques (50 Go, AES-256) classé `pricing` à cause d'une mention secondaire du tarif. Le LLM se laisse piéger par un signal minoritaire dans le texte.
- `pricing/pricing` (type + domain identiques) — cohérent mais sémantiquement redondant.

**Limitation C renforcée** : `technical` utilisé pour 6/7 fragments d'un document commercial. Pattern persistant sur tous les tests.

---

### H2f — Nouvelle limitation : aplatissement des formats structurés (FAQ, tableaux, listes)

**Observation (test 8, faq-redondante.docx)** :

Le document source était structuré en 6 questions explicites format "Q : … / R : …". Après ingestion, les 7 fragments sont des paragraphes narratifs autonomes. La structure question-réponse originale est perdue.

- ✅ Cohérent avec l'approche "fragments réutilisables" — un fragment doit pouvoir s'insérer dans n'importe quel template sans supposer un contexte Q/R
- ❌ Perte d'information : on ne sait plus que c'était une FAQ, ni quelle était la question associée à chaque réponse

**Conséquence pratique** : un template FAQ generé depuis ces fragments ne peut pas reconstruire les paires Q+R. Pour générer une vraie FAQ, il faudrait stocker le couple (question, réponse) plutôt que la réponse seule.

**Généralisable** à d'autres formats structurés : tableaux (voir H7), listes de bullet points numérotées, étapes de processus avec numérotation.

**Évolution V2** : pour le type `faq`, stocker la question dans les métadonnées du fragment (champ `question: string`). Le composer pourrait alors injecter `fragment.question` + `fragment.body` dans un template FAQ. Effort : 1-2j (schema + harvester + composer + templates).

---

### H3 — Détection de doublons (bug #4)

**État** : CONFIRMÉ FONCTIONNEL (2026-05-10). Testé sur plusieurs réingestions — doublons correctement flaggés via Milvus (seuil > 0.80). Bug #4 supprimé du tracker.

---

### H4 — Édition des candidats manquante dans l'UI (bug #12)

**État** : OPEN. UI propose seulement Accepter/Rejeter. Impossible de corriger domain, type ou titre avant de valider. L'API supporte `modified[]` mais l'UI ne l'utilise pas.

**Impact démo** : fragments mal classés (H2) doivent être corrigés via `curl PUT` après coup — friction importante.

**Évolution** : ajouter un mode édition sur chaque carte candidat. Effort : 3-4h.

---

### H4b — Question de design : types `description` et `other` dans FRAGMENT_TYPES ?

**Contexte** : `FRAGMENT_TYPES` (schéma canonique de mmaudet) contient 12 types sans `description` ni `other`. Notre bug #11 fix avait introduit ces deux types dans `HARVESTER_TYPES` — désalignement avec le schéma canonique découvert quand la fix SQLite a exposé les fragments récoltés (ZodError au reindex).

**Fix appliqué** : `HARVESTER_TYPES` réaligné sur `FRAGMENT_TYPES`. Les 24 fragments du vault (`description` × 23, `other` × 1) retyped en `argument` / `introduction`.

**Question ouverte pour Paul/mmaudet** :
1. Le type `description` (caractéristiques statiques d'un produit) est-il utile dans le schéma ? `cas-usage` couvre-t-il ce besoin ?
2. Un type catch-all `other` est-il voulu dans `FRAGMENT_TYPES` ? (actuellement le LLM ne peut pas classer "hors taxonomie")

**Décision requise par** : mmaudet / Paul

---

### H5 — Background job harvester : pseudo-asynchrone, pas de queue persistante

**Architecture actuelle** : le harvester démarre la pipeline via `setImmediate()` dans le même process Node.js. Le `jobId` est retourné immédiatement, le statut est stocké en SQLite (`harvest_jobs`).

**Limitations** :

1. **Job perdu au restart** — `setImmediate` s'exécute dans l'event loop du process courant. Si le serveur redémarre pendant qu'un job est en cours (`status: 'processing'`), la pipeline est tuée. Le job reste bloqué en `processing` indéfiniment dans la DB — l'utilisateur ne peut pas le reprendre ni savoir qu'il a échoué.

2. **Pas de limite de concurrence** — plusieurs uploads simultanés déclenchent plusieurs pipelines en parallèle dans le même event loop. Sur un serveur avec Ollama local, l'API LLM est saturée et les temps de classification explosent.

3. **Pas de retry automatique** — une erreur LLM transitoire (timeout, réseau) échoue le job entier sans tentative de reprise partielle.

**Impact démo** : faible si un seul utilisateur fait les uploads manuellement. Risque si deux documents sont uploadés en parallèle ou si le serveur redémarre pendant un upload long (30+ candidats).

**Évolution V2** : remplacer `setImmediate` par une queue persistante (BullMQ + Redis, ou queue SQLite maison). À la startup, détecter les jobs `processing` orphelins et les passer en `failed`. Effort : 1-2j.

**Fichier concerné** : `packages/server/src/services/harvester-service.ts` lignes 93-98

---

### H6 — Formats de fichiers supportés (évolution V2)

**État actuel** : le harvester accepte uniquement `.docx`. C'est la limite du POC initial, pas un bug.

**Évolution V2** : étendre le support via pandoc (nativement : ODT, HTML, Markdown, TXT) et poppler (PDF, extraction texte brut). Effort estimé : 2-3h.
- `harvest-routes.ts` : accepter les extensions supportées
- `harvester-service.ts` : détecter le format depuis l'extension, passer le bon `--from` à pandoc
- `Dockerfile` : ajouter `poppler-utils` pour le PDF

**Limitation PDF** : pandoc lit les PDF via poppler (texte brut uniquement). Mise en forme, tableaux et images perdus. Qualité variable selon le PDF source.

---

## COMPOSER

### C1 — Résolution de slots non contextualisée — sélection sémantique manquante (Phase 3 — REQUIS)

**État** : bug #17 fixé — `resolveSlot()` utilise Milvus sémantique avec fallback SQL. Mais le contexte de composition n'influence pas quels fragments sont sélectionnés.

**Double problème** :

1. **Pas de champ d'intention dans l'UI** — le Compositeur n'a aucun champ texte libre pour exprimer l'intention de la composition. Les champs `client`, `date`, `reference` sont des métadonnées de rendu, pas du contexte sémantique. Il n'existe nulle part où écrire "proposition pour un client bancaire, migration email 500 utilisateurs".

2. **Contexte ignoré dans la sélection** — même si les champs existants étaient utilisés, la requête Milvus ignore tout le contexte (ligne 571 de `composer-service.ts`) :
```typescript
const query = [slot.type, domain].filter(Boolean).join(' ');
// → "argument commercial" — identique quelle que soit la composition
```

**Livrable Phase 3** (MISSION.md) : *"Allow composition adaptation to a provided context (e.g., 'presentation for client X', 'commercial proposal on subject Y')"*.

**Décision log 2026-05-07** : *"LLM-as-a-ranker pattern for composer"* — explicitement prévu pour cette mission.

---

**Étape A — Requête Milvus enrichie avec le contexte (prérequis, ~2h)**

Enrichir la requête de recherche avec les valeurs de `context` :
```typescript
const contextHint = Object.entries(context)
  .filter(([k, v]) => k !== 'date' && typeof v === 'string')
  .map(([_, v]) => v).join(' ');
const query = [slot.type, domain, contextHint].filter(Boolean).join(' ');
// → "argument commercial Airbus logistique 500 utilisateurs"
```
Avantage : Milvus reçoit une requête sémantiquement plus proche du vrai besoin. Pas d'appel LLM supplémentaire.
Limite : la similarité cosinus ne raisonne pas — elle ne comprend pas pourquoi l'argument sécurité est plus pertinent pour Airbus que l'argument coût.

---

**Étape B — LLM-as-a-ranker (~1j, après étape A)**

Après résolution Milvus, passer les N meilleurs candidats au LLM avec le contexte complet pour re-ranking :
```
Contexte : client Airbus, secteur aviation, objectif "migration email 500 utilisateurs"
Voici 5 fragments de type "argument/commercial" :
  [1] Argument souveraineté des données...
  [2] Argument réduction des coûts...
  [3] Argument conformité réglementaire aéronautique...
  [4] Argument simplicité de déploiement...
  [5] Argument intégration Twake Workplace...
Lequel est le plus pertinent pour ce client ? Réponds avec le numéro et une justification en 1 phrase.
```
Le LLM peut raisonner sur la pertinence métier (conformité aéronautique > coût pour Airbus).

Paramètres à définir : N candidats à passer au LLM (5 recommandé), seuil de confiance Milvus minimal pour entrer dans la liste, comportement si tous les candidats sont jugés non pertinents.

---

**Séquencement** : Étape A d'abord (améliore la base immédiatement), Étape B ensuite (ajoute le raisonnement LLM sur de meilleurs candidats).

**Impact si non implémenté** : la démo Phase 3 ne peut pas illustrer "composition adaptée au contexte client" — les fragments sont identiques quelle que soit la composition. C'est le cœur du livrable #3.

---

### C2 — Sélection manuelle de slot manquante dans l'UI (bug #18)

**État** : OPEN. L'UI ne permet pas de choisir quel fragment va dans quel slot. L'API supporte `overrides` mais l'UI ne l'expose pas.

**Impact** : si le fragment auto-sélectionné est mauvais, l'utilisateur ne peut pas le remplacer depuis l'UI.

**Évolution** : bouton "Changer" sur chaque slot ouvrant un sélecteur de fragments. Effort : 3-4h.

---

### C3 — Qualité minimum par défaut (bug #26)

**État** : fix appliqué — `quality_min` passe de `draft` à `approved` par défaut.

**Limitation** : pour un nouveau projet avec uniquement des fragments `draft`, toutes les compositions échouent immédiatement avec un message d'erreur (amélioré pour indiquer la cause). L'onboarding d'un nouveau corpus nécessite une étape de validation explicite.

---

## TEMPLATES / XLSX

### T1 — XLSX devis : slots fantômes (question ouverte)

**Contexte** : le template `lincloud-devis.xlsx` n'utilise aucun fragment — seulement `${metadata.*}` et `${table:lignes.*}`. Pourtant le YAML déclare 3 slots (`introduction`, `pricing`, `conclusion`) qui sont résolus et affichés dans la preview mais absents du XLSX généré.

**Questions à trancher** :
1. Veut-on injecter du texte fragment dans le devis XLSX ? Si oui, où ?
2. Quels fragments auraient du sens : introduction ? conditions générales ? rien ?
3. En attendant : faut-il retirer les 3 slots du YAML pour ne plus tromper l'utilisateur ?

**Décision requise par** : mmaudet / Juliette

---

### T2 — PPTX format non-functional (bug #33)

**Status**: OPEN — contractual deliverable missing.

The render code path exists (`render-marp.ts`) but PPTX is not usable: `@marp-team/marp-cli` is not installed as a package dependency (only `marp-core` is), and no template with `output_format: pptx` exists. All slide templates use `output_format: slides` (Marp HTML).

**Distinction**: `slides` (Marp→HTML, working) ≠ `pptx` (Marp→PowerPoint, broken). The contract requires `pptx` and `reveal` as separate deliverables.

**Fix**: add `@marp-team/marp-cli` as a real dependency + create a PPTX template. See bug #33.

**Residual limitation post-fix**: Marp→PPTX has limited layout control vs. native PptxGenJS (no custom master slides, limited font embedding). Acceptable for demo; V2 would use native PptxGenJS for client-grade output.

---

### T3 — No Linagora branding on existing templates

**Status**: Pending Phase 3 — blocked on assets from Paul.

All 4 existing templates (`tpl-lincloud-docx.yaml`, `tpl-lincloud-xlsx.yaml`, `tpl-lincloud-slides.yaml`, `tpl-lincloud-reveal.yaml`) use generic "LinCloud Souverain" placeholder content. No Linagora logo, colors, or typography have been applied.

The contract requires "clean, ready to send to a client" output quality. Paul confirmed Linagora will provide template references and brand assets. Until these arrive, generated documents are not client-grade.

**Action required**: request brand assets and template references from Paul (logo, color palette, fonts, reference DOCX/PPTX). Apply to all 4 templates + new PPTX template during Phase 3.

---

## AUTH / SESSION

### A1 — No admin UI for user and role management

**Status**: OPEN — API exists, UI absent.

The backend exposes a full admin API: `GET/POST /v1/users`, `GET/POST /v1/tokens`, `GET /v1/audit`, all protected by `requireRole('admin')`. No frontend page exposes these endpoints. User creation, token management, and collection membership assignment all require direct API calls (`curl`).

**Impact for demo**: Cannot add a second user or manage roles from the browser. mmaudet (auto-seeded as admin) is the only usable account in dev without manual API calls.

**Evolution V2** (3-4h): Add an Admin panel page in the web UI — user list, create user form, token management, collection membership editor.

---

### A2 — Collection role enforcement incomplete for content operations (bug #34)

**Status**: OPEN — schema complete, enforcement partial.

The 5-level collection role hierarchy (`reader → contributor → expert → manager → owner`) exists in the schema and is enforced for collection management (add members, delete collection). For content operations within a collection (`/v1/collections/:slug/fragments`, templates, harvest), all operations are gated at `reader` level only — a collection reader can create, modify, and approve fragments.

Non-collection routes (`/v1/fragments`) correctly enforce global roles (`contributor` for write, `expert` for approve).

**Impact**: Multi-user setups where some members should be read-only do not work as intended. The roles exist in the DB but the API does not enforce them for content operations.

**Fix**: See bug #34 — pass per-level middlewares to route registration in `index.ts`.

---

### A3 — JWT non persisté entre onglets (bug #5)

**État** : OPEN. JWT stocké en mémoire JavaScript uniquement. Nouvel onglet ou refresh = re-login obligatoire. Jobs harvester en cours perdus.

**Impact démo** : CRITIQUE — un refresh pendant la démo = perte de session.

**Fix** : stocker le JWT dans `localStorage` ou `sessionStorage` avec expiration (TTL 8h). Effort : 1-2h.

---

## ARCHITECTURE GÉNÉRALE

### G1 — Pas de mécanisme de gouvernance de la taxonomie

Le harvester est le seul endroit où la taxonomie domain/type est définie. Il n'existe pas de workflow pour qu'un admin propose, révise ou publie un nouveau domaine sans intervention dev. Pour V2 multi-tenant, chaque collection devrait gérer sa propre taxonomie (voir H1).

### G2 — Milvus optionnel mais comportement SQLite non documenté

Quand Milvus est absent, le fallback SQLite (`LIKE %query%`) est silencieux et donne des résultats très différents. Aucun indicateur dans l'UI du mode actif (Milvus vs SQLite). Un utilisateur ne sait pas pourquoi les résultats de recherche sont moins bons.

**Évolution** : indicateur de mode dans le header ou la page de recherche.

---

### H6 — Absence de pipeline tabulaire dans le composer

**Observation (test 6, grille-tarifaire-complexe.docx, 2026-05-10)**

Pipeline d'extraction confirmé fonctionnel : Pandoc extrait les tables Word en Markdown pipe, `segment()` les inclut verbatim dans le body, SQLite stocke le contenu tabulaire. Le fragment "Tarification mensuelle des services Linagora" contient bien la table complète.

Un tableau de 10 lignes (grille tarifaire complète) est capturé dans **un seul fragment monolithique**. Le harvester ne découpe pas par ligne — un tableau entier = un fragment.

**Question produit ouverte — philosophie de granularité**

Pour un devis personnalisé client A (Twake + LinShare seulement, sans Stockage ni Support), comment Fragmint peut-il composer un devis adapté si le tableau de référence est un bloc indivisible ?

Trois philosophies :
- **A. Fragment par tableau entier** (actuel) : tout ou rien — le fragment est réutilisable tel quel ou pas du tout
- **B. Fragment par ligne** : très réutilisable, mais perte du contexte colonne (un prix sans son en-tête)
- **C. Fragment hybride avec données structurées** : fragment de type `table` avec colonnes typées, lignes interrogeables — le mieux, mais complexe

**Constat fondamental — le composer n'utilise pas les fragments tabulaires**

Le composer Fragmint sépare déjà narratif et données tabulaires : les lignes de devis sont saisies manuellement par l'utilisateur dans le champ "Données tabulaires" du Composer. Les fragments tabulaires capturés par le harvester ne sont donc **pas utilisés par le composer XLSX**.

Conséquence : un agent qui rédige un devis client doit resaisir toutes les lignes manuellement, même si le tableau de référence est déjà dans la DB. Le harvester capture les tableaux mais le composer ne sait pas les consommer.

**Évolution V2 — deux axes possibles**

*Axe 1 — Enrichir le harvester* : produire des fragments structurés par ligne (philosophie B ou C), avec un type `table` dédié et des colonnes typées (module, SKU, prix, unité). Effort : 2-3 jours.

*Axe 2 — Enrichir le composer* : au lieu d'une saisie manuelle des lignes de devis, proposer un sélecteur de fragment tabulaire ("piocher dans les fragments `pricing` existants"). Le composer récupère les lignes directement depuis les fragments DB. Effort : 2-3 jours.

*Axe 3 (idéal)* : les deux — fragments structurés + composer qui les consomme. Effort : 4-5 jours.

**Impact démo** : moyen — la démo peut fonctionner avec saisie manuelle. Mais la proposition de valeur "les données de référence sont dans la DB, le composer les utilise automatiquement" est absente.

**Fichiers concernés** : `packages/server/src/services/harvester-service.ts`, `packages/server/src/services/composer-service.ts`, templates XLSX
