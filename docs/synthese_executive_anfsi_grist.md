# Test ANFSI Grist — Synthèse exécutive

**Date** : 9-11 juin 2026
**Mode de test** : retrieval hybride, top_k=8 fragments par section
**Document source** : `PR_ANFSI_Preconfiguration_deploiement_TWAKE_31128.docx`
**Vault** : `example-vault` (corpus Twake.ai, aucun fragment Grist natif)

---

## Objectif

Générer une proposition commerciale Grist en réutilisant un vault existant qui ne contient pas le produit ciblé. Brief :

- **Client** : ANFSI (Agence du numérique des forces de sécurité intérieure)
- **Prestation** : déploiement d'une instance privée Grist sur cloud RHR, intégration dans Twake Drive via le protocole OpenBuro
- **Périmètre** : 130 000 utilisateurs Gendarmerie Nationale
- **Budget** : 50 000 € HT
- **Période** : septembre-décembre 2026

---

## Le workflow utilisateur — vue d'ensemble

Pour produire un draft exploitable, l'utilisateur passe par 5 phases successives :

### Phase 1 — Préparation du corpus (préalable, une fois par vault)

Avant de pouvoir générer une propale, le vault doit être prêt :

- **Tags du référentiel** : les tags utilisés (par produit, client, technologie) doivent exister dans la table `fragment_tags`. Si un tag est absent au moment de l'ingestion, le LLM de classification ne peut pas le proposer — il faut le créer manuellement.
- **Domaines correctement assignés** : chaque fragment doit avoir son domaine (`twake-workplace`, `grist`, `openrag`, etc.). C'est la première dimension de filtrage du retrieval.
- **Fragments tagués** : les fragments existants doivent porter les tags pertinents. La sync se fait en 3 endroits (JSON `fragments.tags` + jointure `fragment_tag_links` + frontmatter YAML du vault).

**État aujourd'hui** : gestion des tags et des domaines accessible dans l'UI.

### Phase 2 — Génération et révision du plan

Une fois le brief saisi, Fragmint génère un plan en 10 sections corpus-aware.

**Le plan brut n'est pas toujours optimal.** L'utilisateur doit le retravailler :

- Vérifier que les **mots-clés du brief** sont bien dans les descriptions de section (sinon Pool A ne se déclenchera pas)
- Renommer les sections pour qu'elles **correspondent au vocabulaire du corpus** (ex : "Architecture" plutôt que "Conception technique" si le corpus parle d'architecture)
- Ajouter les sections qui manquent (ex : section Clauses si le corpus en contient mais que le plan n'en propose pas)
- Vérifier l'ordre logique des sections

**État aujourd'hui** : édition manuelle dans l'UI. Le plan est modifiable section par section.

### Phase 3 — Sélection et nettoyage des fragments par section

Pour chaque section, Fragmint propose des fragments candidats issus du retrieval hybride. L'utilisateur doit :

- **Approuver les fragments pertinents** (en moyenne 3-5 par section)
- **Rejeter les fragments hors-scope** que le retrieval a remontés à tort (en moyenne 1-3 par section sur ce test)
- **Identifier les manques** : si une section a peu ou pas de fragment, signaler que la composition reposera principalement sur le brief

C'est la phase où l'utilisateur exerce le plus son jugement éditorial. Elle nécessite de **connaître son corpus** pour distinguer ce qui est pertinent de ce qui est superficiellement proche.

**État aujourd'hui** : interface de sélection fonctionnelle dans l'étape "Fragments" du workspace.

### Phase 4 — Writer_instructions par section

Avant de lancer la génération, l'utilisateur ajoute pour chaque section qui en a besoin un writer_instructions court (3-5 bullets) :

- **Points à inclure obligatoirement** (ex : numéro de marché, validité de l'offre, parallèle Docs DINUM)
- **Points à éviter explicitement** (ex : Apache James, Police nationale, déploiement par vagues)
- **Périmètre spécifique** (ex : "Gendarmerie Nationale uniquement, pas Police")

**Format optimal validé sur ce test** : 3-5 bullets directifs. Plus court = oublis. Plus long = c'est l'utilisateur qui rédige, plus Fragmint.

**État aujourd'hui** : champ texte par section dans l'UI.

### Phase 5 — Génération, audit et édition finale

L'utilisateur lance la génération de toutes les sections en une passe. Le compositeur produit le draft.

L'utilisateur audit ensuite chaque section :

- **Vérifie la fidélité au brief** : tous les éléments du brief sont-ils présents ?
- **Vérifie l'absence de drift contextuel** : pas de mention d'éléments hors-scope ?
- **Édite manuellement** les phrases résiduelles qui auraient pu être réintroduites par le compositeur malgré les writer_instructions

Si une section est trop éloignée du résultat attendu, l'utilisateur peut **régénérer cette section seule** avec un writer_instructions affiné.

**État aujourd'hui** : édition dans le workspace UI.

---

## Résultats mesurés

| Niveau d'intervention | Sections exploitables |
|---|---|
| Corpus cleané + sélection de fragments | **7/10** |
| + writer_instructions courtes par section | **9/10** |
| Corpus parfait + writer_instructions (estimé) | ~10/10 |


---

## Ce qui fonctionne

- **Zéro hallucination pure** : tous les faits produits sont traçables vers le brief ou un fragment. Le système ne fabrique pas, il transpose.
- **Structuration automatique du plan** en 10 sections cohérentes dès la première génération (à retravailler pour les mots-clés)
- **Hiérarchie "brief gagne sur les fragments"** correctement implémentée dans WRITER_SYSTEM_BASE pour les faits projet-spécifiques (chiffres, dates, noms de produits, périmètres)
- **writer_instructions courtes** (3-5 bullets par section) = levier de pilotage le plus efficace testé
- **Traçabilité fragment-à-fragment** : l'utilisateur voit pour chaque section quel fragment a été mobilisé, avec son score et sa source

---

## Ce qui ne fonctionne pas

3 patterns d'erreur récurrents identifiés, présents dans plusieurs sections :

1. **Fragments Frankenstein** — un fragment mélange des patterns réutilisables (HA, conteneurisation) et des valeurs projet-spécifiques (300 000 utilisateurs ANFSI). Le compositeur reprend l'ensemble du fragment sans distinguer ce qui est transposable.

2. **Titres trompeurs** — le LLM judge pondère le titre du fragment davantage que son body. Conséquence : des fragments hors-scope retenus à tort (ex : fragment "Interopérabilité IMAP/SMTP/JMAP" pris pour une section Architecture Grist) ou des fragments pertinents droppés à tort (ex : clauses OSSA renommées en "Grille tarifaire").

3. **Drift contextuel** — le compositeur réinjecte des éléments des fragments source (Apache James, Kerberos, co-financement, migration messagerie) même quand le brief ne les mentionne pas et que les writer_instructions tentent de les exclure.

Limites secondaires :

- top_k=5 par défaut trop restrictif quand Pool A force 30-40 candidats (résolu en passant à top_k=8 pour ce test)
- Tableaux financiers en images PNG non extractibles par Pandoc
- Pas d'UI pour ajouter manuellement un fragment à une section
- Calibration des montants dans les tableaux pricing toujours manuelle

---

## Recommandation produit

**Le corpus est le facteur déterminant de la qualité du draft généré.**

Un investissement sur le chunker (titres sémantiques, split des fragments mixtes) bénéficie à toutes les propales futures. C'est un effet structurel et durable, sur la phase 1 (préparation du corpus).

Les writer_instructions courtes sont nécessaires mais à refaire à chaque propale. C'est un effort par propale, sur la phase 4.

Les deux investissements sont complémentaires et non substituables.

---

## Roadmap par priorité

**30 jours — quick wins** (peu coûteux, impact élevé)

1. Chunker : préfixer le titre au body à l'indexation
2. top_k adaptatif selon le nombre de candidats forcés
3. WRITER_SYSTEM_BASE renforcé sur les valeurs projet-spécifiques
4. Prompt du LLM judge : lecture explicite du body

**60 jours — sujets moyens** (impact produit notable)

5. Split automatique des fragments Frankenstein à l'ingestion
6. Tagging automatique enrichi (NER sur le body)
7. UI pour candidats manuels par section
8. Indicateurs de confiance par phrase dans les drafts

**6 mois — sujets structurels** (transformations majeures)

9. PARAMETERIZABLE_SCHEMAS étendus (volumes, dates, périmètres)
10. Pipeline de validation à l'ingestion
11. Compositeur multi-étapes (extraction → rédaction → vérification)

---

## Avis sur la maturité produit

Fragmint est un proof of concept solide avec un différenciateur réel : **zéro hallucination + traçabilité complète + souveraineté du déploiement**. Pour un contexte réglementé ou un marché public, ces propriétés ne sont pas triviales et différencient clairement de GPT-4 et équivalents.

Le workflow en 5 phases est cohérent et fonctionnel. Mais la phase 1 (préparation du corpus) reste aujourd'hui une tâche d'expert : tagging manuel, gestion des fragments mixtes, scripts d'ingestion pour les tableaux-images. Un commercial non-technique ne peut pas l'utiliser seul le premier jour.

**Seuil de viabilité produit** : un utilisateur non-technique peut préparer un corpus pour un nouveau client en moins d'une heure, sans aide. Ce seuil n'est pas atteint aujourd'hui mais est accessible avec le pipeline de validation à l'ingestion (sujet 6 mois).

---

*Rétrospective rédigée le 11 juin 2026 — branche `mission-phase-2`*
