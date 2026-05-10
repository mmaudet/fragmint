# Fragmint — Limitations, Évolutions et Questions ouvertes

> Notes accumulées pendant la mission de stabilisation (J1–J20).
> Alimentera Section 4 ("Limites actuelles") et Section 5 ("Évolutions recommandées")
> de la note de synthèse finale.
> Les questions ouvertes nécessitent une décision de mmaudet / Juliette avant d'être traitées.

---

## HARVESTER

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
Pattern sur 3 tests : test 1 → 1/7 en methodology, test 2 → 2/2, test 3 → 4/4. Total : 7/13 (54%) des fragments classés `methodology`. Les types `description` et `argument` sont sous-utilisés.
Le LLM utilise `methodology` comme fourre-tout pour tout contenu structuré en étapes ou bonnes pratiques.
Cause : prompt `classify()` sans exemples ni règles de désambiguïsation entre types proches.

**Évolution V2 (2-3h) — enrichir le prompt `classify()` avec des règles explicites** :
- `methodology` = phases d'un processus chronologique (déploiement, migration, cycle de vie projet)
- `description` = caractéristiques statiques d'un produit, concept ou composant
- `argument` = raison de choisir, justification, bénéfice client
- `other` = contenu hors-scope des 7 types ci-dessus

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

### H3 — Détection de doublons (bug #4)

**État** : CONFIRMÉ FONCTIONNEL (2026-05-10). Testé sur plusieurs réingestions — doublons correctement flaggés via Milvus (seuil > 0.80). Bug #4 supprimé du tracker.

---

### H4 — Édition des candidats manquante dans l'UI (bug #12)

**État** : OPEN. UI propose seulement Accepter/Rejeter. Impossible de corriger domain, type ou titre avant de valider. L'API supporte `modified[]` mais l'UI ne l'utilise pas.

**Impact démo** : fragments mal classés (H2) doivent être corrigés via `curl PUT` après coup — friction importante.

**Évolution** : ajouter un mode édition sur chaque carte candidat. Effort : 3-4h.

---

### H5 — Formats de fichiers supportés (évolution V2)

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

## AUTH / SESSION

### A1 — JWT non persisté entre onglets (bug #5)

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
