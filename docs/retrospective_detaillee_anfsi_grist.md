# Rétrospective détaillée — Test end-to-end ANFSI Grist (juin 2026)

**Date** : 9-11 juin 2026
**Mode de retrieval** : hybride RRF + Pool A, top_k=8 fragments par section
**Document source ingéré** : `PR_ANFSI_Preconfiguration_deploiement_TWAKE_31128.docx`
**Plan généré** : `plan_197a67a3-d403-4071-8ecd-9a702d354634`
**Vault utilisé** : `example-vault` (corpus Twake.ai)

---

## 1. Contexte du test

L'objectif était de générer une proposition commerciale Grist pour l'ANFSI en réutilisant le vault Twake.ai, qui ne contient pas de fragments Grist natifs. Le brief :

- **Client** : ANFSI (Agence du numérique des forces de sécurité intérieure)
- **Prestation** : déploiement d'une instance privée Grist sur le cloud RHR ANFSI, intégration dans Twake Drive via le protocole OpenBuro
- **Périmètre** : 130 000 utilisateurs Gendarmerie Nationale
- **Budget** : 50 000 € HT
- **Période** : septembre-décembre 2026

Le test était volontairement ambitieux : le corpus disponible est à 100 % Twake.ai (messagerie, agendas, drive). On cherchait à voir ce que le système pouvait récupérer de réutilisable pour une proposition sur un produit connexe mais distinct.

**Paramètres de test** :

- Mode retrieval : hybride RRF + Pool A
- top_k : 8 fragments par section
- LLM judge actif
- WRITER_SYSTEM_BASE incluant la hiérarchie brief > fragments

---

## 2. Le workflow utilisateur — détail des 5 phases

Pour produire un draft exploitable, l'utilisateur passe par 5 phases successives. Chaque phase a son rôle, son effort et ses points de vigilance.

### Phase 1 — Préparation du corpus (préalable, une fois par vault)

Avant de pouvoir générer la première propale d'un vault, le corpus doit être correctement préparé. Cette phase est ponctuelle (à faire une fois) mais structurante.

**Ce qu'il faut faire** :

1. **Vérifier le référentiel de tags**
   - Les tags utilisés dans le vault (par produit, client, technologie, périmètre) doivent exister dans la table `fragment_tags`
   - Si un tag est absent au moment de l'ingestion d'un nouveau document, le LLM de classification ne peut pas le proposer
   - Conséquence pratique : à chaque nouveau type de fragment (nouveau produit, nouveau client), il faut potentiellement créer des tags manuellement

2. **Vérifier les domaines assignés**
   - Chaque fragment doit avoir son domaine (`twake-workplace`, `grist`, `openrag`, etc.)
   - Le domaine est la première dimension de filtrage du retrieval
   - Une erreur de domaine = le fragment ne remontera jamais pour les bonnes sections

3. **Vérifier la cohérence des tags sur les fragments existants**
   - Les tags doivent être synchronisés en 3 endroits :
     - `fragments.tags` (JSON dans la table fragments)
     - `fragment_tag_links` (table de jointure pour Pool A)
     - Frontmatter YAML du fichier `.md` dans le vault Git
   - La désynchronisation entre ces 3 endroits = bugs invisibles au retrieval

4. **Identifier les fragments "Frankenstein"**
   - Fragments qui mélangent un pattern réutilisable et une valeur projet-spécifique
   - À identifier en amont pour pouvoir les rejeter sur les futures propales d'un autre projet

**État aujourd'hui** : gestion des tags, des domaines et du retypage accessible dans l'UI.

### Phase 2 — Génération et révision du plan

Une fois le brief saisi dans Fragmint, le système génère automatiquement un plan en sections corpus-aware. Mais le plan brut n'est pas toujours optimal.

**Ce qu'il faut faire** :

1. **Lire le plan généré**
   - Sections proposées, types éditoriaux (`introduction`, `methodology`, `pricing`...), descriptions
   - Vérifier la cohérence avec le brief

2. **Retravailler les descriptions de section**
   - Les descriptions de section sont utilisées par le retrieval pour identifier les fragments candidats
   - Si une description ne contient pas les bons mots-clés du brief, Pool A ne se déclenchera pas
   - Exemple sur ce test : une section "Architecture" doit explicitement mentionner "OpenBuro" et "Twake Drive" dans sa description pour que les fragments associés remontent

3. **Renommer les sections selon le vocabulaire du corpus**
   - Si le corpus parle d'"architecture" et que le plan dit "conception technique", il y a un écart sémantique
   - Aligner le vocabulaire augmente la pertinence du retrieval

4. **Ajouter ou retirer des sections**
   - Le plan corpus-aware peut oublier des sections importantes (ex : section Clauses si le corpus contient des clauses mais que le LLM générateur de plan ne l'a pas proposée)
   - L'utilisateur doit savoir ce que sa propale finale doit contenir, indépendamment du corpus

5. **Vérifier l'ordre logique des sections**
   - Le plan doit suivre une logique commerciale (contexte → enjeux → méthodologie → architecture → prestations → planning → pricing → conditions → conclusion)
   - Réordonner si nécessaire

**État aujourd'hui** : édition manuelle dans l'UI. Le plan est modifiable section par section. Nécessite que l'utilisateur connaisse à la fois son brief et son corpus.

### Phase 3 — Sélection et nettoyage des fragments par section

Pour chaque section du plan, Fragmint propose des fragments candidats issus du retrieval hybride (RRF + Pool A + LLM judge). C'est la phase la plus critique : c'est là que l'utilisateur exerce son jugement éditorial.

**Ce qu'il faut faire** :

1. **Approuver les fragments pertinents**
   - En moyenne 3-5 fragments par section sur ce test
   - Vérifier que le contenu du fragment est cohérent avec ce qu'on veut dire dans la section
   - Vérifier que le titre du fragment est cohérent avec son body (un titre trompeur est un piège)

2. **Rejeter les fragments hors-scope**
   - En moyenne 1-3 fragments par section sur ce test
   - Les fragments qui parlent d'un autre projet, d'un autre périmètre, d'un autre produit
   - Les fragments Frankenstein dont la partie projet-spécifique ne s'applique pas
   - Les fragments dont le titre matche superficiellement mais dont le body est hors-sujet

3. **Identifier les manques**
   - Si une section a peu ou pas de fragment, c'est un signal important
   - Cela signifie que la composition reposera principalement sur le brief et les writer_instructions
   - À documenter pour la phase 4

4. **Vérifier l'ordre des fragments (pour les tableaux)**
   - Pour les fragments-tableau (`generic-row-v1`, `pricing-line-v1`), l'ordre des lignes compte
   - Le `_row_index` doit être correct, sinon les lignes seront mélangées

**État aujourd'hui** : interface de sélection fonctionnelle dans l'étape 2 "Fragments" du workspace. L'utilisateur voit le score, le type, le titre et un extrait de chaque fragment. Il peut approuver ou rejeter.

**Limite identifiée** : pas d'UI pour ajouter un fragment qui n'aurait pas été remonté par le retrieval. Contournement par scripts Python modifiant directement `state_json`.

### Phase 4 — Writer_instructions par section

Avant de lancer la génération, l'utilisateur ajoute pour chaque section qui en a besoin un writer_instructions court (3-5 bullets) pour cadrer le compositeur.

**Quand c'est nécessaire** :

- Quand le corpus ne contient pas exactement ce qui est demandé (sections où le brief porte plus que les fragments)
- Quand les fragments sélectionnés ont du contenu hors-scope dans leur body (cas du Frankenstein)
- Quand des éléments contractuels précis doivent absolument apparaître (numéro de marché, validité, modalités)

**Le format optimal validé sur ce test** :

```
Points à inclure obligatoirement :
- Élément A (ex : marché ELL n°1300201352)
- Élément B (ex : validité de l'offre 3 mois)
- Élément C (ex : parallèle avec Docs DINUM)

Points à éviter explicitement :
- Élément X (ex : Apache James, anti-spam — composants messagerie)
- Élément Y (ex : Police nationale, STN — hors périmètre)
- Élément Z (ex : co-financement — pas dans le brief)
```

3-5 bullets directifs. Plus court = oublis (le compositeur saute des éléments importants). Plus long = c'est l'utilisateur qui rédige, plus Fragmint.

**Ce qu'on a appris sur ce test** :

- Le bon dosage est la liste de bullets concis
- Les instructions très détaillées qui dictent les paragraphes mot pour mot font perdre l'intérêt de Fragmint (l'utilisateur fait le travail à la place du compositeur)
- Les instructions trop vagues laissent passer le drift contextuel des fragments source

**État aujourd'hui** : champ texte par section dans l'UI. Pas d'aide à la rédaction, pas de templates. L'utilisateur doit savoir ce qu'il veut éviter.

### Phase 5 — Génération, audit et édition finale

L'utilisateur lance la génération de toutes les sections en une passe (parallélisée, 3 sections simultanément). Le compositeur produit le draft complet.

**Ce qu'il faut faire** :

1. **Audit factuel section par section**
   - Vérifier que tous les éléments du brief sont présents
   - Vérifier l'absence de drift contextuel (mentions d'éléments hors-scope)
   - Vérifier la cohérence des chiffres, dates, périmètres

2. **Identifier les patterns d'erreur résiduels**
   - Fragments Frankenstein qui ont produit du contenu hors-brief
   - Titres trompeurs qui ont introduit des éléments parasites
   - Groupements sémantiques fautifs dans les synthèses

3. **Décider entre édition manuelle et régénération**
   - **Édition manuelle** : si seulement quelques phrases sont à corriger
   - **Régénération avec writer_instructions affiné** : si la section a un problème structurel

4. **Édition finale dans le workspace**
   - Corrections de phrases résiduelles
   - Ajustements stylistiques
   - Calibrage manuel des tableaux pricing (le compositeur laisse les montants à `[à préciser]`)

**État aujourd'hui** : édition dans le workspace UI. Le groundedness check signale les passages potentiellement hallucinés. Pas d'indicateur visuel de confiance par phrase.

### Synthèse des phases

| Phase | Rôle | Récurrence |
|---|---|---|
| 1. Préparation du corpus | Tags, domaines, sync, identification Frankenstein | Ponctuel par vault |
| 2. Révision du plan | Mots-clés, vocabulaire, ordre, sections | À chaque propale |
| 3. Sélection fragments | Approuver, rejeter, identifier manques | À chaque propale |
| 4. Writer_instructions | Cadrer le compositeur, 3-5 bullets par section | À chaque propale |
| 5. Génération + audit + édition | Production du draft, vérification, corrections | À chaque propale |

---

## 3. Ingestion et retrieval — constats techniques

### Ce qui fonctionne

- Découpage sémantique du DOCX (sections, paragraphes, tableaux)
- Extraction de 6 tables structurées en fragments `generic-row-v1` et `sla-row-v1`
- Classification automatique des domaines et types par LLM
- Collections de fragments correctement regroupées
- Pool A force les fragments-tableau via les tags pertinents
- LLM judge utilise le `spec_context` pour discriminer
- Mode hybrid RRF performant sur corpus multi-domaine

### Limites techniques de l'ingestion

**Tableaux financiers en images** : la section "Proposition financière" du document source contient un tableau tarifaire encodé comme image PNG (`![](media/image6.png)` dans le markdown Pandoc). Pandoc ne peut pas extraire les données d'une image. Workaround : création manuelle de 3 fragments `pricing-line-v1` depuis lecture de l'image.

**Tags absents du référentiel initial** : les tags `produit:docs`, `planning` et `grist` n'existaient pas dans la table `fragment_tags`. Le LLM de classification ne pouvait pas les proposer. Création manuelle via script Python.

**Sync tags en 3 endroits** : `fragments.tags` (JSON) + `fragment_tag_links` (jointure pour Pool A) + frontmatter YAML du fichier `.md` dans le vault. Source potentielle de désynchronisation.

**`_row_index` absent à l'ingestion** : ajout manuel pour 31 fragments. L'ordre a été vérifié via les `created_at`.

**Conflit WAL SQLite host/Docker** : les scripts Python exécutés sur l'hôte écrasaient leurs propres writes à cause du WAL maintenu par le serveur Docker. Solution : exécuter les scripts directement dans le container.

### Limites du retrieval

**Fragments-tableau invisibles sans Pool A** : les fragments `generic-row-v1` ont des bodies de 8-15 mots type `"Jalon: Volet 1 | Début: Mai 2026"`. Le LLM judge leur attribue un score < 3 pour une section dont le titre du jalon ne mentionne pas le produit visé. Rejetés par le floor.

**Pool A ne protège pas contre le floor** : les fragments forcés par Pool A sont soumis au même critère d'élimination que les fragments vecteur.

**Section §1 vide initialement** : aucun fragment `introduction` du corpus ne passait le scoring pour "Grist". Corpus très orienté Twake.ai messagerie.

**top_k=5 par défaut trop restrictif** quand Pool A force 30-40 candidats. Le test a été conduit à top_k=8 pour atteindre 7/10 sections exploitables dès le niveau 1.

**Pas d'UI pour candidats manuels** : ajout manuel d'un fragment à une section impossible via l'interface. Contournement : modification directe du champ `state_json` du plan en base SQLite.

---

## 4. Patterns d'erreur identifiés

L'audit factuel du premier draft (avant fixes) a révélé **aucune hallucination pure** mais 18 cas problématiques, tous traçables vers 3 patterns récurrents.

### Pattern 1 — Titres trompeurs (LLM judge mal calibré)

Le LLM judge pondère le titre du fragment davantage que son body. Conséquence : un fragment dont le titre matche le sujet de la section mais dont le body est hors-contexte obtient un score élevé et passe. Symétrique : un titre trop générique peut faire dropper un fragment utile dont le corps est pertinent.

**Exemple 1 — fragment retenu à tort** : "Interopérabilité — IMAP, SMTP, JMAP, clients NEO" retenu en §4 Architecture Grist parce que le mot "Interopérabilité" résonne avec le brief Grist (interopérabilité OpenBuro). Le body précise pourtant "pour ce qui concerne la messagerie". Conséquence : mention IMAP/SMTP/JMAP dans une section Grist.

**Exemple 2 — fragments droppés à tort** : 4 fragments de clauses d'exclusion OSSA renommés "Grille tarifaire OSSA" à l'ingestion. Le judge les voit en section "Conditions et clauses" et les score 1-2 (croyant qu'ils sont du pricing). Droppés par llmFloor=3.

**Fix immédiat** : renommer le titre des fragments concernés pour expliciter le scope.
**Fix structurel** : améliorer le scoring du judge pour donner plus de poids au body.

### Pattern 2 — Fragments Frankenstein (chunker mal calibré)

Un fragment qui mélange des patterns réutilisables et des valeurs projet-spécifiques est une source de drift systématique. Le compositeur reprend le fragment en bloc sans distinguer ce qui est transposable.

**Exemple** : fragment `frag-e2fa11b7` "Principes d'architecture" qui contient :

- HA, redondance multi-nœuds → pattern Linagora générique (réutilisable)
- Docker/Kubernetes → pattern générique (réutilisable)
- Ségrégation des flux → pattern sécurité générique (réutilisable)
- "300 000 utilisateurs (horizon 2027 voire 2028)" → projection ANFSI Twake messagerie (NON réutilisable pour la propale Grist 130K)
- Détails RHR (3 sites, SUSE, CEPH) → spécifique ANFSI (partiellement réutilisable)

Le compositeur a repris la mention 300K dans la section §4 Grist. Techniquement valide (le LLM a interprété "extension à 300K" comme "capacité théorique de l'architecture"), mais hors-brief.

**Pourquoi WRITER_SYSTEM_BASE n'a pas corrigé** : la règle "brief gagne sur les faits projet" ne s'applique pas si le LLM ne perçoit pas la mention 300K comme un fait projet en conflit avec le brief 130K. Il a résolu le conflit en les rendant compatibles.

**Fix structurel** : split du fragment à l'ingestion en deux fragments distincts (un pattern, un projet-spécifique).

### Pattern 3 — Groupement sémantique fautif

Le compositeur agglomère des concepts hétérogènes dans les sections de synthèse (introduction, conclusion).

**Exemple** : phrase générée en §10 dans une version intermédiaire : "130 000 utilisateurs des entités GN, RHR et OpenBuro". Le compositeur a traité 3 concepts de natures différentes comme s'ils étaient homogènes :

- GN = Gendarmerie Nationale (population d'utilisateurs)
- RHR = infrastructure cloud
- OpenBuro = protocole d'interopérabilité

**Fix structurel** : compositeur multi-étapes (extraction de la structure intermédiaire avant rédaction).

### Audit factuel détaillé — résumé en chiffres

| Catégorie | Nombre de cas |
|---|---|
| Transposition inappropriée du contexte Twake → Grist | 12 |
| Manquements du brief (mention marché ELL, validité 3 mois, etc.) | 4 |
| Adaptations imparfaites du compositeur | 2 |
| **Hallucinations pures (inventions ex nihilo)** | **0** |

---

## 5. Corrections appliquées pendant le test

5 fixes ont été appliqués pour faire progresser la qualité du draft.

### Fix 1 — WRITER_SYSTEM_BASE : hiérarchie brief > fragments

Avant : le prompt incluait `"Stay faithful to the facts in the fragments"` ce qui faisait primer les fragments sur le brief en cas de conflit.

Après : ajout d'une section "Source hierarchy" qui pose explicitement :

1. Le brief = source de vérité pour les faits du projet (client, produit, dates, budget, périmètre)
2. Les fragments = source de vérité pour le style, les formulations, les engagements génériques
3. En cas de conflit factuel → le brief gagne

**Couvre** : transposition de dates, budgets, noms de produits, périmètres.
**Ne couvre pas** : éléments cachés dans le body des fragments que le LLM ne perçoit pas comme étant en conflit avec le brief (cas du fragment Frankenstein).

### Fix 2 — Rejets de fragments pathologiques par section

5 fragments rejetés manuellement après identification des vecteurs de drift :

| Section | Fragment rejeté | Drift éliminé |
|---|---|---|
| §3 | "Volet 3" engagement (facturation oct-jan) | Déploiement par vagues |
| §3 | "Volet 3" engagement (extension fév-juin 2027) | Migration de données |
| §7 | "Architecture de déploiement visée" (Apache James) | Apache James, Twake Mail |
| §9 | "Extension cible (horizon 2027)" | 250-300K + Police nationale |
| §10 | "Prestations et livrables" mai-juillet 2026 | Personnalisation graphique |

### Fix 3 — writer_instructions par section pour les manquements brief

Ajoutées dans l'UI avant régénération :

- **§5** : "Ce projet concerne la Gendarmerie Nationale uniquement. Ne pas mentionner la Police nationale, le STN, le CNAU PN, ni les MOA messagerie."
- **§8** : "Ne pas inventer de jalons de facturation. Modalités de paiement : selon conditions du marché ELL n°1300201352. Budget total : 50 000 € HT."
- **§9** : "Conditions de paiement : selon conditions du marché ELL n°1300201352. Validité de l'offre : 3 mois à compter de la date d'émission."
- **§10** : "Rappeler que cette proposition s'inscrit en complément de la proposition principale Twake.ai (marché ELL n°1300201352). Périmètre : Gendarmerie Nationale uniquement, 130 000 utilisateurs."

### Fix 4 — Détection automatique des fragments-tableau par payload_schema

**Problème** : les fragments `generic-row-v1` (jalons, ateliers, lignes de prix) ont des corps au format `"Jalon: X | Début: Y | Fin: Z"`. Le LLM compositeur les recevait comme du texte brut et les convertissait systématiquement en prose narrative.

**Fix** : dans `buildSectionMessages`, si ≥ 2 fragments sélectionnés pour une section ont un `payload_schema` se terminant par `-row-v1`, l'instruction suivante est injectée :

> *"IMPORTANT: The source fragments below are rows of a structured table. Output a Markdown table — one row per fragment, in the order given. Infer column headers from the fragment content. Do not convert them to prose."*

**Portée** : universel, couvre tous les schémas `-row-v1` actuels et futurs.

### Fix 5 — Correction PRICING_OVERRIDE + workaround Pandoc images

**(a)** Restriction de la condition de déclenchement de `PRICING_OVERRIDE_INSTRUCTION` à `payload_schema: 'pricing-line-v1'` uniquement (au lieu de `type: 'pricing'` trop large qui incluait les ateliers).

**(b)** Création manuelle de 3 fragments `pricing-line-v1` depuis lecture de l'image `image6.png` non extractible par Pandoc. Ces fragments encodent la structure de colonnes réelle du tableau tarifaire et servent de template au compositeur pour §8.

---

## 6. Mesure quantitative des leviers de pilotage

Question testée : combien de sections sont exploitables (OK directement ou avec édition mineure) à chaque niveau d'investissement ?

| Niveau | Conditions | Sections exploitables |
|---|---|---|
| 0 | Aucune intervention | ~3-4/10 (estimé) |
| 1 | Cleanup corpus + rejet fragments hors-scope | **7/10** (mesuré) |
| 2 | + writer_instructions courtes par section | **9/10** (mesuré) |
| 3 | Corpus parfait, sans writer_instructions | ~8-9/10 (estimé) |
| 4 | Corpus parfait + writer_instructions | ~10/10 (estimé) |

**Lecture** :

- Le corpus a un effet structurel et durable (bénéficie à toutes les propales futures, via la phase 1 du workflow)
- Les writer_instructions ont un effet par propale (à refaire à chaque fois, via la phase 4)
- Les deux sont complémentaires, non substituables

### 3 sections résistent au corpus seul

Au niveau 3 (corpus parfait sans writer_instructions), 3 sections restent partielles parce que leurs problèmes ne sont pas dans les données mais dans le comportement du compositeur LLM :

- **§1** : sur-extension du contexte source (le compositeur interprète le contexte de la propale source comme contexte courant)
- **§5** : ambiguïté de scope quand les fragments mentionnent plusieurs périmètres dans le même body
- **§10** : groupement sémantique fautif dans les synthèses

Ces 3 patterns justifient les solutions structurelles sur le compositeur (roadmap 6 mois).

### Note méthodologique

Les niveaux 0, 3 et 4 sont des estimations par déduction à partir des patterns observés. Une vraie validation demande d'implémenter les fixes corpus et de régénérer.

---

## 7. Bilan détaillé

### Ce qui est prêt en production

| Feature | État | Note |
|---|---|---|
| Ingestion DOCX → fragments prose | ✅ Fonctionnel | Découpage et classification corrects |
| Extraction tableaux structurés | ✅ Fonctionnel | `generic-row-v1`, `sla-row-v1`, collections |
| Pool A (forced candidates par tags) | ✅ Fonctionnel | Indispensable pour les fragments-tableau |
| Hybrid RRF + LLM judge | ✅ Fonctionnel | Meilleur mode sur vault multi-domaine |
| writer_instructions par section | ✅ Fonctionnel | Soupape essentielle pour corpus partiels |
| `_row_index` ordering tables | ✅ Fonctionnel | Nécessite ajout manuel actuellement |
| Groundedness check | ✅ Fonctionnel | Détecte les hallucinations post-composition |
| Export DOCX | ✅ Fonctionnel | Via Pandoc + template Word |
| WRITER_SYSTEM_BASE brief > fragments | ✅ Fonctionnel | Couvre les faits projet-spécifiques |

### Ce qui est fragile ou manquant

| Limitation | Impact concret | Priorité |
|---|---|---|
| LLM judge trompé par les titres | Fragments retenus/droppés à tort | Haute |
| Fragments Frankenstein (patterns + valeurs mélangés) | Drift contextuel résiduel | Haute |
| Pool A ne protège pas contre le floor | Fragments forcés peuvent être rejetés | Haute |
| Pas d'UI pour candidats manuels | Contournement DB uniquement | Haute |
| Tableaux financiers en images | Création manuelle de fragments | Haute |
| top_k=5 par défaut trop restrictif | Sections vides au niveau 1 | Moyenne |
| Tags absents du référentiel initial | Tagging manuel au premier usage | Moyenne |
| Sync tags en 3 endroits | Source de désynchronisation | Moyenne |
| `_row_index` non automatique | Ordre aléatoire par défaut | Moyenne |
| Calibration tableaux pricing | Montants laissés `[à préciser]` | Moyenne |
| Groupement sémantique fautif | Erreurs dans les synthèses | Structurelle |

---

## 8. Roadmap par priorité

### 30 jours — Quick wins (peu coûteux, impact élevé)

**1. Améliorer le chunker — deux axes complémentaires**

*Axe A* : préfixer le titre au body à l'indexation. Le LLM judge voit toujours le titre dans son contexte sémantique.

*Axe B* : titres sémantiques par sous-bloc générés par LLM au harvest, plutôt que d'hériter du titre de chapitre source.

**2. top_k adaptatif** selon le nombre de candidats forcés par Pool A. Plafond à 15.

**3. Renforcer WRITER_SYSTEM_BASE sur les valeurs projet-spécifiques.** Ajouter une règle stricte sur les chiffres, dates, acteurs, protocoles techniques, noms de produits.

**4. Améliorer le prompt du LLM judge.** Instruction explicite pour lire le body avant le titre, identifier si le fragment parle d'un autre projet/produit/périmètre, justifier le score en une phrase.

**5. Détection des tableaux-images à l'ingestion.** Heuristique sur la sortie Pandoc : si un document contient visuellement des tableaux mais que Pandoc n'en extrait aucune cellule, lever un avertissement.

**6. Calibration des montants dans les tableaux pricing.** Quand un `pricing-line-v1` est en `selected`, instruction explicite au compositeur pour proposer une ventilation cohérente avec le total du brief.

### 60 jours — Sujets moyens (valeur produit notable)

**7. Split automatique des fragments mixtes à l'ingestion.** Détection par LLM des sous-blocs sémantiquement distincts dans un chapitre source.

**8. Tagging automatique enrichi.** NER sur le body à l'ingestion → mapping vers des tags structurés (`tech:cassandra`, `acteur:dinum`, etc.).

**9. UI pour candidats manuels par section.** Bouton "Ajouter un fragment" dans l'étape Fragments du workspace.

**10. Indicateurs de confiance par phrase** dans les drafts. Code couleur selon que la phrase est sourcée clairement, reformulée, ou générative.

**11. Comparaison brief vs draft** à la fin de chaque génération. Checklist des éléments du brief présents/manquants/non sourcés.

**12. Historique des versions par section.** Ne pas perdre une bonne version en régénérant.

### 6 mois — Sujets structurels (transformations majeures)

**13. PARAMETERIZABLE_SCHEMAS étendus.** Au-delà des montants monétaires :

- `volume-line-v1` : volumétries (users, boîtes, documents)
- `timeline-line-v1` : jalons et dates
- `actor-line-v1` : périmètres d'acteurs et MOA
- `metric-line-v1` : indicateurs et SLA

**14. Pipeline de validation à l'ingestion.** Interface humaine pour valider/corriger chaque fragment avant indexation. 15 minutes d'investissement → tous les retrieval futurs en bénéficient. Ce sujet refonde la phase 1 du workflow pour la rendre accessible aux non-techniques.

**15. Compositeur multi-étapes.** Extraction d'une structure intermédiaire, puis rédaction depuis cette structure, puis vérification par un second LLM.

**16. Évaluation et test continus.** Corpus de tests + scoring automatique des compositions générées + régression check à chaque modification.

---

## 9. Avis sur la maturité produit

### Ce que Fragmint est aujourd'hui

Un proof of concept solide avec un différenciateur réel pour des utilisateurs avertis qui connaissent leur corpus et savent piloter les 5 phases du workflow.

**Ce qui est réellement bon** :

- **Zéro hallucination pure** : différenciateur fort dans un contexte souverain ou réglementé. Pouvoir affirmer "tout ce qui est dans le doc est traçable" n'est pas trivial.
- **Traçabilité fragment-à-fragment** : l'utilisateur voit la provenance de chaque section et peut auditer, rejeter, corriger.
- **Le brief gagne sur les fragments** : la hiérarchie des sources est correcte et fonctionnelle pour les faits projet-spécifiques.
- **Workflow structuré en 5 phases** : chaque phase a un rôle clair, l'utilisateur sait où il est dans le processus.

**Ce qui bloque l'adoption aujourd'hui** :

- **Phase 1 (préparation du corpus) = expertise technique.** Tagging manuel, gestion des fragments Frankenstein, scripts Python pour forcer des candidats, ingestion d'images à la main.
- **Phase 4 (writer_instructions) demande de connaître le corpus.** L'utilisateur doit savoir ce qu'il veut éviter pour pouvoir l'écrire.
- **Pas d'UI pour les actions courantes des phases 1 et 3.** Forcer un fragment, splitter un fragment Frankenstein, créer un fragment depuis une image — tout passe par des scripts.

### Ce que Fragmint peut devenir

Le pari central : rendre la composition documentaire aussi fiable que le copier-coller, mais automatisée et traçable.

Le concurrent réel n'est pas GPT-4. C'est un commercial qui ouvre ses anciennes propales, copie les paragraphes pertinents, et adapte à la main. Fragmint gagne contre ça si et seulement si la qualité du corpus (issue de la phase 1) est suffisante pour que le premier draft soit meilleur que le copier-coller brut.

**Avec investissement corpus + UI de validation à l'ingestion** :

- La phase 1 devient accessible aux non-techniques
- Un commercial peut générer un premier draft en 10 minutes qui couvre 7-8/10 sections sans intervention
- L'accumulation de propales devient un actif réel : chaque propale validée enrichit le corpus
- Le positionnement souverain devient vendable (vault local, fragments versionés en Git, LLM local possible)

**Avec investissement compositeur** :

- Les 3 patterns résiduels (sur-extension contextuelle, ambiguïté de scope, groupement sémantique) disparaissent ou deviennent rares
- Le premier draft sans writer_instructions passe estimativement à ~9/10 sections exploitables
- La phase 4 devient optionnelle dans la majorité des cas

### Le vrai risque

Si la phase 1 reste une tâche d'expert (scripts, tagging, split manuel), Fragmint restera un outil pour des équipes avec un "gardien du vault" technique. Utile, mais pas scalable.

**Seuil de viabilité produit** : un commercial non-technique peut compléter les 5 phases pour un nouveau client en moins de 2h, sans aide. Ce seuil n'est pas atteint aujourd'hui. Il est atteignable avec le pipeline de validation à l'ingestion.

### En une phrase

Fragmint est un proof of concept solide avec un vrai différenciateur (traçabilité + zéro hallucination + souveraineté). Il deviendra un produit quand la phase 1 du workflow sera accessible à ceux qui l'utilisent.

---

## Annexes (à venir)

- A1. Détail des 18 cas de l'audit factuel
- A2. Scripts utilisés pendant le test
- A3. Configuration retrieval détaillée
- A4. Logs et données brutes des régénérations

---

*Rétrospective rédigée le 11 juin 2026 — branche `mission-phase-2`*
