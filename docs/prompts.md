# Fragmint — Catalogue des prompts LLM

> Généré le 2026-06-02 — branch `mission-phase-2` — commit `81c7cff`  
> 12 prompts, 5 features : Harvest, Qualité, Supersedure, Composition, Retrieval

---

## Table des matières

1. [Harvest — Segment + Classify (pipeline actif)](#1-harvest--segment--classify-pipeline-actif)
2. [Harvest — Classify seul](#2-harvest--classify-seul)
3. [Harvest — Segment seul (legacy)](#3-harvest--segment-seul-legacy)
4. [Harvest — Inférence schéma payload (tableaux)](#4-harvest--inférence-schéma-payload-tableaux)
5. [Qualité — LLM-as-judge](#5-qualité--llm-as-judge)
6. [Supersedure — Détection de remplacement](#6-supersedure--détection-de-remplacement)
7. [Composition — Génération du plan (outline)](#7-composition--génération-du-plan-outline)
8. [Composition — Rédaction de section](#8-composition--rédaction-de-section)
9. [Retrieval Hybride — Re-ranking par batch](#9-retrieval-hybride--re-ranking-par-batch)
10. [Retrieval Agentique — Phase 0 : sélection domain:type](#10-retrieval-agentique--phase-0--sélection-domaintype)
11. [Retrieval Agentique — Phase 1 : sélection candidats](#11-retrieval-agentique--phase-1--sélection-candidats)
12. [Retrieval Agentique — Phase 2 : scoring batch](#12-retrieval-agentique--phase-2--scoring-batch)

---

## 1. Harvest — Segment + Classify (pipeline actif)

**Fichier** : `packages/server/src/services/llm-client.ts:157–223`  
**Méthode** : `segmentAndClassify()`  
**Appelé par** : `harvester-pipeline.ts` — une fois par chunk sémantique  
**Format** : message `user` unique (pas de system message)  
**Variables** : `domainList`, `validTypes`, `tagHint`, `hintsBlock`, `markdown`

```
You are a document analysis assistant.
Extract reusable content blocks from the document and classify each one using structured metadata.

# Extraction rules
- body: EXACT verbatim text from the document. Do NOT translate, paraphrase, or summarize.
- title: short label (3-8 words) in the SAME language as the body. Do NOT write an English title for French content.
- lang: ISO 639-1 code of the body language (fr, en, ...)

# Classification rules

## domain — the subject area or product this block is about. MUST be one of:
  ${domainList}
  Use "other" for content not clearly tied to one specific domain.
  If the content belongs to a domain NOT in the list, add it to new_proposals.domains with "NEW:" prefix.

## type — the content type. MUST be one of:
  ${validTypes}

  Type disambiguation (use these definitions to pick the right type):
  - "introduction": general product/company/service overview
  - "argument": commercial or technical argument, competitive advantage
  - "use-case": generic usage scenario WITHOUT naming a specific client or organization
  - "reference": named organization's deployment with specific context or measurable results (référence client)
  - "testimonial": direct quote or explicit endorsement from a named client
  - "methodology": technical approach, architecture, process description
  - "pricing": pricing, offers, licensing models
  - "faq": questions and answers format
  - "clause": contractual clause, SLA, legal commitment
  - "engagement": service commitment, guarantee, support level
  - "conclusion": synthesis, closing statement
  - "bio": person or organization profile
  KEY DISTINCTION — "use-case" vs "reference":
    → "reference" if: a named organization is cited + specific deployment details OR measurable results
    → "use-case" if: describes a generic scenario or workflow without naming a real client

## tags — ${tagHint}
  [Si knownTags non vide] : "ONLY use tags from this exact list: [...]. Do NOT invent tags or add
  anything outside this list to the "tags" array."
  [Si knownTags vide] : "Leave "tags" empty — new thematic tags go in new_proposals.tags instead."

  Entity tags — identify named organizations, products, and technologies:
  Prefix format: client:name, produit:name, tech:name, partner:name, cert:name, reg:name
  Use lowercase kebab-case after the colon. Examples: client:dgfip, produit:linshare, tech:apache-james
  Apply entity tags ONLY when the fragment body explicitly names the organization/product/technology.
  If an entity tag is NOT in the known list above → put it in new_proposals.tags (no NEW: prefix), e.g. "client:some-new-client".
  If a thematic concept is worth tagging but not in the known list → put it in new_proposals.tags too (e.g. "edge-computing").

[BLOC HINTS — affiché uniquement si uploadHints.domain ou uploadHints.tags fournis à l'upload]
# Operator hints (orientation — apply where relevant, not systematically to every block)
- domain (suggested): ${uploadHints.domain}
- tags (suggested): ${uploadHints.tags.join(', ')}
[Si tag de type client:*, produit:*, partner:*]
RULE — named-reference hints (client:*, produit:*, partner:*): apply these ONLY if the fragment body
explicitly names or directly discusses that specific client, product, or organization. Generic
contractual clauses, SLA commitments, methodology sections, and capability descriptions do NOT qualify
unless the named reference appears in the text. Domain and general thematic tags (open-source,
sovereignty, etc.) may be inferred from context — named references may not.

# Document
${markdown}

## confidence — your confidence that ALL classification fields are correct (0–1).
  Scale: 0.95+ only when all metadata is unambiguous. 0.70-0.94 when confident
  but some ambiguity exists. 0.50-0.69 when uncertain. Below 0.50 when likely
  misclassified. Default toward lower values when unsure.

Return ONLY a valid JSON array. Each element must contain ALL fields:
[
  {
    "title": "...",
    "body": "...",
    "domain": "...",
    "type": "...",
    "lang": "fr",
    "tags": ["open-source"],
    "new_proposals": {
      "tags": ["client:acme-corp", "edge-computing"],
      "domains": ["NEW:quantum-computing"]
    },
    "confidence": 0.72
  }
]
```

---

## 2. Harvest — Classify seul

**Fichier** : `packages/server/src/services/llm-client.ts:251–266`  
**Méthode** : `classify()`  
**Appelé par** : `plan-service.ts` (inférence du type de section)  
**Format** : message `user` unique  
**Variables** : `existingTypes`, `existingDomains`, `tagHint`, `blockText`

```
You are a content classification assistant. Classify the following text block.

- type: the rhetorical function of the block. Choose the BEST match from: ${existingTypes}.
- domain: the SUBJECT MATTER (which product or thematic area this is about). Choose the BEST match
  from: ${existingDomains}. Domain is about WHAT the text is about, not HOW it is written.
  A technical paragraph about Twake → domain "twake", not "technical".
- tags: keywords describing the nature and audience of the content.
  ${tagHint}
  [Si knownTags] : "Prefer tags from this known list when relevant: [...]. You may add new tags if
  needed, but they MUST be in English."
  [Sinon] : "MUST be in English, lowercase, single words or hyphen-separated. Never use French words."
- confidence: your confidence in this classification (0–1).
  Scale: 0.95+ only when all metadata is unambiguous. 0.70-0.94 when confident
  but some ambiguity exists. 0.50-0.69 when uncertain. Below 0.50 when likely
  misclassified. Default toward lower values when unsure.

Do not invent domain or type values outside the provided lists. Use "other" if nothing fits.

Text:
${blockText}

Return a JSON object with: type (string), domain (string), tags (string array), confidence (number 0-1).
```

---

## 3. Harvest — Segment seul (legacy)

**Fichier** : `packages/server/src/services/llm-client.ts:98–109`  
**Méthode** : `segment()`  
**Statut** : legacy — plus appelé par le pipeline actif  
**Format** : message `user` unique  
**Variables** : `typeList`, `markdown`

```
You are a content segmentation assistant. Extract reusable content blocks from the following document.

Rules:
- body: copy the EXACT original text verbatim. Do NOT translate, paraphrase, or summarize.
  Preserve the source language.
- title: a short label (3-8 words) in the SAME language as the body. Do NOT write an English title
  for French content. Do NOT write a French title for English content.
- type: MUST be one of: ${typeList}. Do NOT use any other value.
- lang: ISO 639-1 code (fr, en, de, ...).

Document:
${markdown}

Return ONLY a JSON array where each element has: title (string), body (string), type (string), lang (string).
```

---

## 4. Harvest — Inférence schéma payload (tableaux)

**Fichier** : `packages/server/src/services/llm-client.ts:297–305`  
**Méthode** : `inferPayloadSchema()`  
**Appelé par** : `harvest-table-extractor.ts` (LLM fallback si heuristique insuffisante)  
**Format** : message `user` unique  
**Variables** : `headers`, `sampleRow`, `schemaList`

```
Tu analyses les colonnes d'un tableau extrait d'un document.

En-têtes : ${headers.join(', ')}
Exemple de ligne : ${JSON.stringify(sampleRow)}

Schémas disponibles :
${schemaList}

Réponds UNIQUEMENT avec l'identifiant du schéma le plus adapté (ex: "pricing-line-v1").
Si aucun ne correspond, réponds "generic-row-v1". Aucune explication.
```

---

## 5. Qualité — LLM-as-judge

**Fichier** : `packages/server/src/services/quality-judge.ts:48–91`  
**Méthode** : `runQualityJudge()`  
**Appelé par** : `harvester-pipeline.ts` — pour chaque fragment non-doublon  
**Format** : `[system, user]`  
**Variables** : `block.title`, `block.body`, `block.domain`, `block.type`, `taxonomy`

**System :**
```
You are a content quality evaluator. Output valid JSON only.
```

**User :**
```
You are evaluating the quality of a content fragment extracted from a document.

# Fragment to evaluate
Title: ${block.title}
Body: ${block.body}

# Metadata assigned by ingestion
Domain: ${block.domain} / Type: ${block.type}

[BLOC TAXONOMIE — si taxonomy fournie]
# Corpus referential (validated values in the library)
Domains: ${taxonomy.domains.join(', ')}
Types: ${taxonomy.types.join(', ')}
Tags (validated): ${taxonomy.tags.slice(0, 40).join(', ')}[...]

# Your task
Evaluate along 3 dimensions. For each: verdict "pass" | "partial" | "fail" + 1-sentence reason.

## Dimension 1: Reusability
Can this fragment be inserted as-is in another document without requiring external context?
PASS: stands alone, no "as mentioned above", no dangling pronouns
FAIL: starts with "Furthermore/Moreover", refers to "previous section", undefined entities

## Dimension 2: Semantic Coherence
Does the fragment express ONE coherent idea, readable in isolation?
PASS: single topic, logical flow
FAIL: multiple distinct ideas bundled, abrupt topic shifts

## Dimension 3: Classification Accuracy
Do the assigned metadata (domain, function, type) match the actual content?
PASS: domain is actual topic, function/type align with corpus referential
FAIL: domain ≠ body topic, function or type mismatch or not in referential

## Metadata suggestions
If the current type, domain, or tags could better match the content AND the corpus referential,
suggest corrections. Use only values from the referential when possible.
If metadata is already accurate, omit suggested_metadata.

Return ONLY valid JSON:
{
  "reusability": { "verdict": "pass", "reason": "..." },
  "semantic_coherence": { "verdict": "pass", "reason": "..." },
  "classification_accuracy": { "verdict": "pass", "reason": "..." },
  "overall_recommendation": "accept",
  "overall_reason": "1-2 sentences",
  "suggested_metadata": { "type": "...", "domain": "...", "tags": ["..."], "reason": "..." }
}
```

---

## 6. Supersedure — Détection de remplacement

**Fichier** : `packages/server/src/services/supersedure-detector.ts:11–106`  
**Méthode** : `detectAndPropose()`  
**Appelé par** : `fragment-service.ts` à chaque mise à jour qualité  
**Format** : `[system, user]`  
**Variables** : `candidate` (fragment existant), `newFrag` (fragment plus récent)

**System :**
```
You are a document supersedure judge. Given two knowledge fragments A (older) and B (newer),
decide whether B supersedes A.

Return ONLY valid JSON with no surrounding text:
{
  "recommendation": "SUPERSEDE" | "COEXIST" | "DIFFERENT_TOPIC",
  "confidence": <0.0-1.0>,
  "reasoning": "<one sentence>",
  "elements_lost_in_b": ["element1"] | null
}

- SUPERSEDE: B contains the same knowledge as A and is more complete or up to date. A should be deprecated.
- COEXIST: Both fragments contain useful, complementary knowledge. Keep both.
- DIFFERENT_TOPIC: The fragments are about different subjects despite surface similarity.
- elements_lost_in_b: important facts present in A but missing from B (only when SUPERSEDE).
```

**User :**
```
Fragment A (older):
domain: ${candidate.domain}
type: ${candidate.type}
lang: ${candidate.lang}
tags: ${tags_A.join(', ')}

${candidate.body_excerpt}

Fragment B (newer):
domain: ${newFrag.domain}
type: ${newFrag.type}
lang: ${newFrag.lang}
tags: ${tags_B.join(', ')}

${newFrag.body_excerpt}
```

---

## 7. Composition — Génération du plan (outline)

**Fichier** : `packages/server/src/services/plan-prompts.ts:12–59`  
**Méthode** : `buildPlanMessages()`  
**Appelé par** : `plan-service.ts::generatePlan()`  
**Format** : `[system, user]`  
**Variables** : `spec_prompt`, `lang`, `domain`, `tags`, `reference_docs`, `current_plan`, `extra_instructions`

**System :**
```
You produce structured document plans in Markdown. Output ONLY the plan.
Format: one H2 (## ) per section. Under each H2, a single short paragraph
(1–3 sentences) describing what the section covers. No body content.
No introduction, no conclusion outside the plan, no commentary.
```

**User :**
```
Context / specification:
${spec_prompt}

Constraints:
- Language: ${lang}
- Domain: ${domain}
- Tags: ${tags}

[Si reference_docs fournis]
Reference documents (use as context, do not quote directly):
--- ${doc.name} ---
${doc.content}   ← tronqué à 2000 caractères
---

[Si pas de current_plan]
Additional instructions: ${extra_instructions}

[Si current_plan fourni]
Current plan to revise:
${current_plan}

Revision instructions: ${extra_instructions}
```

---

## 8. Composition — Rédaction de section

**Fichier** : `packages/server/src/services/plan-prompts.ts:73–136`  
**Méthode** : `buildSectionMessages()`  
**Appelé par** : `plan-assembler.ts::generateSection()`  
**Format** : `[system, user]`  
**Variables** : `lang`, `writer_prompt_override`, `plan_title`, `spec_prompt`, `section`, `reference_docs`, `fragments`

**System :**
```
You are an expert technical writer producing one section of a larger
document. Write in {LANG}. Be concise and factual.

The "Source fragments" provided are internal raw material — building
blocks of the document being authored. They are NOT external sources
to cite. Do NOT:
- attribute content to them ("according to fragment 1", "as stated in...")
- quote them verbatim or wrap their text in quotation marks
- mention that fragments, notes, or sources exist
- preserve their original phrasing if it doesn't fit the section's
  flow or voice

Instead, rewrite and weave the fragment content into a single coherent
section that reads as original prose. You may rephrase freely, reorder
ideas, and drop fragment content that does not fit the section's scope.
Stay faithful to the facts in the fragments — do not invent additional
facts.

Output ONLY the section body in Markdown. Do not repeat the section
title as a heading. No introduction, no closing remark.

[Si writer_prompt_override présent]
Additional guidance: ${writer_prompt_override}
```

**User :**
```
[Si plan_title présent]
Document title: ${plan_title}

[Si spec_prompt présent]
Document specification: ${spec_prompt}

Section title: ${section.title}
Section description: ${section.description}

[Si reference_docs]
Reference documents (background context for this plan — do not quote directly):
--- ${doc.name} ---
${doc.content}   ← tronqué à 1500 caractères

[Si aucun fragment sélectionné]
(no source fragments — write from the description and reference documents above)

[Si fragments présents]
Source fragments (use these as the basis for the content):
--- Fragment 1 ---
${fragment.body}   ← tronqué à max_chars (configurable)
--- Fragment 2 ---
...
```

---

## 9. Retrieval Hybride — Re-ranking par batch

**Fichier** : `packages/server/src/retrieval/hybrid-retriever.ts:154–173`  
**Méthode** : `batchJudge()`  
**Appelé par** : retrieval hybride — après pré-filtrage vectoriel Milvus  
**Format** : message `user` unique  
**Variables** : `query.text`, `query.inferred_type`, `spec_context`, `candidates`

```
Rate the relevance of each fragment for the following document section.
[Si spec_context]
Document context (spec): "${spec_context}"

Section: "${query.text}"
[Si query.inferred_type]
Expected fragment type for this section: ${query.inferred_type}

Fragments (each has [type:] and [domain:] — use them to assess fit):
1. ID:xxx [type: argument] [domain: twake]
   Title: ...
   Excerpt: ...
2. ...

Score each fragment from 0 to 10. Be strict and discriminating:
9-10 = perfect fit for this section (type matches AND content directly relevant)
7-8 = good fit
5-6 = partial fit
3-4 = weak fit
0-2 = poor fit or type mismatch for this section

Return a JSON array where each item is {"id": "...", "score": N}.
Include ALL ${candidates.length} fragments. Return ONLY the JSON array.
```

---

## 10. Retrieval Agentique — Phase 0 : sélection domain:type

**Fichier** : `packages/server/src/retrieval/agentic-retriever.ts:229–238`  
**Méthode** : `selectDomainTypes()`  
**Rôle** : filtre grossier sur la table des matières (index.md) avant de charger les fragments  
**Format** : message `user` unique, `temperature: 0.1`  
**Variables** : `query.text`, `query.filters.lang`, `toc` (index résumé)

```
You are a document composition assistant.

Section to populate: "${query.text}"
[Si lang] Language: ${query.filters.lang}

Fragment library table of contents:
${toc}

Select the domain:type combinations most relevant for this section.
Return ONLY a JSON array: ["domain:type", ...] (e.g. ["twake-mail:argument", "linshare:use-case"])
```

---

## 11. Retrieval Agentique — Phase 1 : sélection candidats

**Fichier** : `packages/server/src/retrieval/agentic-retriever.ts:269–290`  
**Méthode** : `selectCandidates()`  
**Rôle** : sélectionne et classe les IDs de fragments pertinents depuis l'index markdown  
**Format** : message `user` unique, `temperature: 0.1`  
**Variables** : `query`, `indexMd`, `targetCount`, `minCount`, `maxCount`, `collectionSlug`

```
You are a document composition assistant with access to a fragment library.

Section to populate: "${query.text}"
[Si inferred_type] Preferred fragment type: ${query.inferred_type}
[Si filters] Language: ... / Domain(s): ... / Type: ... / Tags: ...
[Si collectionSlug] Collection: ${collectionSlug}

Fragment library index (organized by domain → type, with `type:` explicit on each fragment line):
${indexMd}

Rank the most relevant fragment IDs for this section, from most to least relevant.
The goal is to surface ${targetCount} high-quality fragments for this section.
Return between ${minCount} and ${maxCount} IDs — your choice based on how many are genuinely useful.
Do not pad with weak fragments. Do not truncate good ones.
Instructions:
- Each fragment has a `type:` field — use it to match the section's purpose:
  - "références clients" / "client references" → prefer type: reference or type: testimonial
  - "cas d'usage" / "use cases" → prefer type: use-case
  - "présentation" / "introduction" → prefer type: introduction or type: argument
  - "méthodologie" → prefer type: methodology
- Use entities and tags to further refine relevance within matching types.
Return ONLY a JSON array of ID strings, best first: ["TM-arg-001", "LC-intro-003", ...]
```

---

## 12. Retrieval Agentique — Phase 2 : scoring batch

**Fichier** : `packages/server/src/retrieval/agentic-retriever.ts:174–190`  
**Méthode** : `callBatchJudge()`  
**Rôle** : score tous les candidats Phase 1 (appelé 2× en mode self-consistency, températures 0.2 et 0.4)  
**Format** : message `user` unique  
**Variables** : `query.text`, `query.inferred_type`, `spec_context`, `candidates`

```
Evaluate the relevance of each fragment for the following document section.
[Si spec_context]
Document context (spec): "${spec_context}"

Section: "${query.text}"
[Si inferred_type] Expected fragment type for this section: ${inferred_type}

Fragments:
1. ID:xxx
   Title: ...
   Excerpt: ...   ← 200 premiers caractères du body
2. ...

Score each fragment 0 to 10. Be strict and discriminating:
9-10 = perfect fit (type AND content directly relevant)
7-8 = good fit
5-6 = partial fit
3-4 = weak fit
0-2 = poor fit or type mismatch

Return a JSON array: [{"id": "...", "score": N, "reason": "one sentence"}, ...]
Include ALL ${candidates.length} fragments. Return ONLY the JSON array.
```

---

## Récapitulatif

| # | Feature | Fichier | System msg | Format sortie |
|---|---------|---------|------------|---------------|
| 1 | Harvest segment+classify | `services/llm-client.ts` | — | JSON array |
| 2 | Harvest classify seul | `services/llm-client.ts` | — | JSON object |
| 3 | Harvest segment seul (legacy) | `services/llm-client.ts` | — | JSON array |
| 4 | Harvest inférence schéma payload | `services/llm-client.ts` | — | string |
| 5 | Qualité LLM-as-judge | `services/quality-judge.ts` | ✓ | JSON object |
| 6 | Supersedure | `services/supersedure-detector.ts` | ✓ | JSON object |
| 7 | Composition — outline | `services/plan-prompts.ts` | ✓ | Markdown |
| 8 | Composition — section | `services/plan-prompts.ts` | ✓ | Markdown |
| 9 | Retrieval hybride re-rank | `retrieval/hybrid-retriever.ts` | — | JSON array |
| 10 | Retrieval agentique Phase 0 | `retrieval/agentic-retriever.ts` | — | JSON array |
| 11 | Retrieval agentique Phase 1 | `retrieval/agentic-retriever.ts` | — | JSON array |
| 12 | Retrieval agentique Phase 2 | `retrieval/agentic-retriever.ts` | — | JSON array |
