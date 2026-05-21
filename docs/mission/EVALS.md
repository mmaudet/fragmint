# Fragmint — Eval Methodology

> **For AI agents**: Read this when working on Phase 2 (harvester quality) or Phase 3 (composer quality). Defines the minimal eval infrastructure to build. References to course examples are local paths — check them when needed.

> For deep references on LLM-as-a-judge methodology (G-Eval, MT-Bench, biases),
> see `.claude/notes/llm-as-a-judge-references.md` (local only).

---

## Scope

Evals apply to two parts of the pipeline only:

| Component     | What to eval                                 | Method                         |
| ------------- | -------------------------------------------- | ------------------------------ |
| **Harvester** | Classification accuracy (domain, type, lang) | Golden dataset — deterministic |
| **Composer**  | Fragment relevance per slot                  | LLM-as-a-judge                 |

Everything else (CRUD, render, auth) is deterministic code — no evals needed.

---

## Target directory structure (to create at Day 7-8)

```
e2e/evals/
├── harvester-cases.yaml          # 10-15 test cases: input text → expected classification
├── composer-judge-prompt.md      # Parameterizable LLM-as-a-judge prompt (all 4 formats)
├── run-evals.sh                  # Runs all evals, produces dated markdown report
└── reports/                      # gitignored — dated eval reports
    └── eval-2026-05-XX.md
```

---

## Pattern 1 — Golden Dataset (Harvester)

### Structure of `harvester-cases.yaml`

```yaml
cases:
  - name: cloud_intro_fragment
    inputs:
      text: "Twake Workplace est la suite collaborative souveraine de Linagora..."
    expected:
      domain: lincloud
      type: introduction
      lang: fr
    evaluators:
      - Contains: "lincloud"
      - Contains: "introduction"

  - name: legal_clause_fragment
    inputs:
      text: "Conformément au RGPD, les données personnelles sont traitées..."
    expected:
      domain: legal
      type: clause
      lang: fr
```

**Target**: >90% correct classification across all cases (per PLAN.md Phase 2 definition of done).

### Reference example (course material)

Full working YAML with `HasMatchingSpan`, `Contains`, `ContainsAny`, `LLMJudge` evaluators:
see `dynamous-community/ai-agent-mastery` course, Module 8 (Agent Evals) — golden dataset YAML.
Local copy: `/Users/julietteengel/code/julietteengel/AI_COURSE/courses/ai-agent-mastery/8_Agent_Evals/`
Note: `HasMatchingSpan` (span tree / OpenTelemetry) doesn't apply to Fragmint's server pipeline — skip it.

---

## Pattern 2 — LLM-as-a-Judge (Composer)

### Structure of `composer-judge-prompt.md`

```
You are evaluating a document composition produced by Fragmint.

Template: {template_id}
Format: {output_format}   # docx | xlsx | pptx | reveal
Context provided: {context}

For each slot resolution below, rate 1-5:
- Relevance: does this fragment fit the slot semantically given the context?
- Coherence: does it flow with adjacent fragments?
- Audience fit: does it match the tone/audience of the request?

Slot resolutions:
{slot_resolutions}

Output JSON:
{
  "slots": {
    "{slot_key}": {"relevance": N, "coherence": N, "audience_fit": N}
  },
  "overall": N,
  "reasoning": "..."
}
```

**Target**: average overall score > 3.5/5 before demo, > 4.0/5 for demo compositions.

### Reference example (course material)

see `dynamous-community/ai-agent-mastery` course, Module 8 (Agent Evals), `prod_judge.py`.
Local copy: `/Users/julietteengel/code/julietteengel/AI_COURSE/courses/ai-agent-mastery/8_Agent_Evals/backend_agent_api/evals/prod_judge.py`
Shows the judge implementation pattern (Pydantic AI based — adapt to direct LLM call since Fragmint uses its own LLMClient).

---

## `run-evals.sh` — what it should do

1. POST each `harvester-cases.yaml` case to `POST /v1/harvest/classify` (or equivalent)
2. Compare response against `expected` fields — print pass/fail per case
3. For composer judge: POST to `POST /v1/compose`, then call LLM with judge prompt
4. Write results to `e2e/evals/reports/eval-$(date +%Y-%m-%d).md`
5. Print summary: `Harvester: 13/15 (87%) | Composer avg: 3.8/5`

---

## Demo argument

At Day 19 demo prep, the run output becomes a demo asset:

> "Voici les métriques qualité du système : 15 cas tests harvester, 93% de classification
> correcte. 12 compositions évaluées par LLM-as-a-judge, score moyen 4.2/5.
> Je peux relancer ça en 30 secondes."

This goes into the synthesis note (deliverable #5) as Section 7 "Quality methodology".

---

## Golden dataset — plan de construction (2026-05-12)

**Matière première disponible** : 8 documents testés (tests 1-8), 74 fragments harvested dans le vault, classifications partiellement validées manuellement en session.

**Le golden dataset est un prérequis, pas un livrable de démo.** Sans lui, impossible de valider objectivement les changements de prompt (définitions enrichies, few-shots) ni l'impact du modèle plus petit sur la qualité de classification (voir bug #30).

**Sélection des cas (objectif : 30-40 cas) :**

| Catégorie | Nb cas | Source |
|-----------|--------|--------|
| Classifications correctes connues (ground truth ✅) | 15-20 | Tests 3, 8 notamment |
| Classifications incorrectes connues (cas d'échec ❌) | 8-10 | Test 5, 7, 8 — "technical fourre-tout" |
| Cas ambigus documentés (discutable mais défendable) | 5-8 | "bio" pour présentation produit, "cas-usage" pour features |
| Cas hors-domaine (recettes, kubernetes) | 3-5 | Tests 2, 3 |

**Validations connues depuis les 8 tests :**
```yaml
# ✅ Corrects — ground truth sûr
- kubernetes "Resource Requests and Limits" → methodology/technical/en
- kubernetes "Quality of Service Classes" → methodology/technical/en
- LinShare "Certifications de LinShare Pro" → reference-technique/technical/fr
- LinShare "Souscription à LinShare Pro" → faq/technical/fr
- LinShare "Délais de déploiement" → methodology/technical/fr
- memo "Domination des hyperscalers" → argument/legal/fr  (reclassifié depuis clause)

# ❌ Erreurs connues — cas d'échec pour mesurer amélioration
- LinShare "Capacité de partage et chiffrement" → attendu: argument/technical, obtenu: pricing/commercial
- memo "Human Dimension of Transition" → attendu: engagement/commercial, obtenu: methodology/technical
- memo "Ecosystem of Partners" → attendu: argument/commercial, obtenu: methodology/technical
- proposition-aura "Workplace Approach" → attendu: methodology/commercial, obtenu: methodology/technical
```

**Méthode de construction :**
1. Lire les 74 fragments harvested depuis le vault (champ `body` + frontmatter `type`/`domain`)
2. Pour chaque fragment, valider manuellement la classification attendue (toi = juge)
3. Écrire dans `e2e/evals/harvester-cases.yaml`
4. Score baseline : % de cas où la classification actuelle = expected
5. Après chaque changement prompt → relancer → comparer score

**Référence format avancé :** le golden dataset NeuroVerse (Module 8 cours Dynamous) montre les évaluateurs `HasMatchingSpan`, `Contains`, `ContainsAny`, `LLMJudge`. Pour Fragmint, adapter : `ExactMatch` (type, lang), `ContainsAny` (domaines acceptables), `LLMJudge` (qualité body si format FAQ).

---

## Timing

| Day   | Task                                                                              |
| ----- | --------------------------------------------------------------------------------- |
| J7-8  | Build `harvester-cases.yaml` + `run-evals.sh`, run baseline sur 8 docs testés    |
| J8    | Appliquer définitions enrichies + few-shots, mesurer delta score                  |
| J9-10 | Build `composer-judge-prompt.md`, run on 5 baseline compositions                  |
| J10   | Tester modèle plus petit classify si golden dataset valide seuil qualité           |
| J13   | Run judge on all 3 use cases (12 compositions), document scores                   |
| J18   | Include eval results in synthesis note Section 7                                  |
| J19   | Include eval run in demo storyboard                                               |
