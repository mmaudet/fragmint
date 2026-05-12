# Fragmint Mission — Linagora 20-day Internship

> **For AI agents**: Read this file at the start of every session alongside `CLAUDE.md`. This file defines the mission scope, priorities, and constraints. The technical patterns are in `CLAUDE.md`.

---

## Mission One-Liner

Stabilize Fragmint POC, build a fragment library from a real Linagora corpus, and demonstrate contextualized document composition (DOCX, XLSX, PPTX, reveal.js) ready for client-grade output.

---

## Context

Fragmint is currently at POC state. The technical pipeline (embedding, vector store, LLM, harvester, composer) is in place but has never been validated end-to-end on real data. The mission is to **valorize** Fragmint on its core use case (document generation), not to build new features.

**Source of truth**: Mission brief signed 2026-05-06, contract `20260506-Contrat application-001-SST-ENGEL Juliette` (Annex 3).

**Repository**: `github.com/mmaudet/fragmint`
**Working branch**: `juliette/mission-stabilization` (do NOT push to `main` directly)
**Visibility**: Michel-Marie Maudet observes commits in real-time. Push small, atomic, well-described commits frequently.

**Linagora support**: per the contract, Linagora provides expertise to support onboarding and ensure consistency of work. Reach out to Paul Tran-Van for technical context, dataset access, and unblocking decisions. Asking for help is in the contract.

---

## Phases (Thematic, NOT sequential)

The brief explicitly states phases are thematic, not sequential. Sequencing adapts to advances, technical dependencies, and project priorities. **Parallelization is expected** — for example, fragment ingestion (Phase 2) can start as soon as the dataset arrives even if Phase 1 bugs aren't all fixed.

### Phase 1 — Code stabilization
- Identify principal Fragmint bugs (POC state)
- Fix priority bugs blocking end-to-end usage
- Document remaining limitations and attention points

### Phase 2 — Fragment generation from real Linagora dataset
- Identify and prepare a representative Linagora corpus (commercial proposals, presentations, project deliverables)
- Process this corpus through the Fragmint harvester
- Verify segmentation, classification, and metadata quality
- Iterate on parameters and prompts to improve fragment relevance

### Phase 3 — Document composition with templates and context
- Build a template set covering target formats: `.docx`, `.xlsx`, `.pptx`, `reveal.js`
- Compose documents from these templates, fed by Linagora-derived fragments
- Allow composition adaptation to a provided context (e.g., "presentation for client X", "commercial proposal on subject Y")
- Evaluate generated document quality on multiple concrete use cases

### Phase 4 — Exploration: Fragmint Skills for opencode
- Prototype one or more Fragmint Skills for **opencode** (NOT Claude Code)
- Validate scenario: a user asks opencode to produce a document, opencode delegates to Fragmint via the Skill
- Identify limits and Fragmint evolutions needed for fluid assistant usage

The brief lists this Phase as "selon avancées" (if time permits) but the corresponding deliverable is in the formal deliverables list — therefore at least a minimum viable prototype is required.

---

## Formal Deliverables (per contract)

The contract lists exactly 5 deliverables. Each must be produced by mission end:

| # | Deliverable | Source | Format |
|---|------------|--------|--------|
| 1 | List of bugs identified and applied corrections | `BUGS.md` + commits on the repo | Markdown doc + commit history |
| 2 | Fragment library generated from real Linagora dataset | The vault populated with approved fragments | Git-versioned vault |
| 3 | Demonstration of contextualized document composition based on templates | Live demo + 4 templates × 3 use cases output examples | Working pipeline + sample outputs |
| 4 | Prototype Skill(s) Fragmint for opencode | Skill definition + demonstration | Working Skill + demo recording |
| 5 | Synthesis note on Fragmint evolutions and current limits | `docs/mission-synthesis.md` (or equivalent) | Markdown architecture doc |

---

## Surfaces (Priority Order)

Validated with Paul Tran-Van on 2026-05-07:

1. **Fragmint Web UI** — primary surface, must work cleanly
2. **opencode + Skills** — secondary, exploratory but valued (and required as deliverable #4)
3. **MCP via Claude Desktop** — tertiary, exists already, keep functional
4. **CLI** — keep functional, not a demo focus
5. **Obsidian plugin** — explicitly OUT OF SCOPE for the 20 days (already on Fragmint roadmap as "deferred")

---

## Backend AI Configuration

### Development (current — 2026-05-12)
- **Ollama local** : `mistral-nemo:12b` pour le LLM, `nomic-embed-text-v2-moe` pour les embeddings
- Endpoint : `http://host.docker.internal:11434/v1` (configuré dans `docker/docker-compose.dev.yml`)
- Modèles installés localement : `mistral-nemo:12b`, `nomic-embed-text-v2-moe`, `qwen2.5:7b-instruct`, `llama3.1:8b`
- `qwen2.5:7b-instruct` disponible pour tester comme modèle classify plus rapide (voir H0 dans limitations)

### Production target
- **`ai.linagora.com`** — Linagora's hosted platform, supports multiple providers (prefer open-weight models)
- Linagora will provide credentials when mission starts
- Both LLM and embeddings exposed via OpenAI-compatible API

### Remote fallback (si Ollama indisponible)
- OpenRouter `gpt-oss-120b:free` (free tier, OpenAI-compatible) — endpoint `https://openrouter.ai/api/v1`
- Switching : changer `FRAGMINT_LLM_ENDPOINT` + `FRAGMINT_LLM_MODEL` sans modification de code

---

## Output Formats

All four formats are required by the contract (Phase 3):

| Contract format | Code format | Engine | Status |
|----------------|-------------|--------|--------|
| DOCX | `docx` | docx-templates | Working |
| XLSX | `xlsx` | ExcelJS | Working |
| PPTX | `pptx` | Marp→PPTX (`marp-cli`) | **BROKEN** — see bug #33 |
| reveal.js | `reveal` | Markdown→HTML | Working |
| *(not in contract)* | `slides` | Marp→HTML (`marp-core`) | Working (bonus format) |

**`slides` vs `pptx` are not the same**: `slides` renders Marp Markdown as self-contained HTML. `pptx` exports to a `.pptx` PowerPoint file via `marp-cli`. The contract requires `pptx` and `reveal` as distinct deliverables — they are not interchangeable.

Note: Marp→PPTX chosen over native PptxGenJS (see Decisions Log 2026-05-07). Native PPTX deferred to V2 if Maudet requires more layout control post-mission.

**Visual quality target**: "clean, not just functional" (per Paul). Ready to send to a client.

---

## Linagora Branding

- Linagora provides template references and brand assets (Paul will share)
- Logo, colors, typography to be applied to generated documents
- Quality bar: "ready to send to a client"

---

## Deployment

- **Target**: `docker-compose up` works out of the box
- Maudet should be able to run the demo on his own machine
- A small VM deployment (Scaleway/etc.) is a possible follow-up but NOT required for the 20 days
- No Kubernetes, no Terraform, no complex IaC

---

## Demo Format

- Final demo: **reusable**, runs on Maudet's machine
- Audience: Maudet primary, possibly Linagora technical team
- Format: live demo + architecture note (synthesis document)

---

## Linagora-specific dataset

- Linagora provides the corpus (~10-15 real documents: pitch decks, commercial proposals, technical documents, project deliverables)
- Probable source: Twake (Linagora's collaboration platform)
- The dataset is the **bottleneck** for Phases 2-3 — request it ASAP

---

## Skills Pattern Reference

This section captures the conceptual framework that informs Phase 4 (opencode Skill) and the synthesis note.

### Progressive Disclosure (Anthropic Skills pattern)

Skills load instructions and resources in three levels to avoid context window saturation:

```
Level 1: Metadata (always loaded, ~100 tokens per skill)
    - SKILL.md frontmatter (name + description) injected in system prompt
    - Agent decides which skill might be relevant

Level 2: Full Instructions (loaded on-demand)
    - Complete SKILL.md body when agent invokes the skill
    - Includes triggers, when-to-use, available operations, instructions

Level 3: References & Scripts (loaded on-demand)
    - Reference files, helper scripts in subdirectories
    - Only loaded when SKILL.md instructions point to them
```

**Why it matters**: an agent can have access to dozens of skills without overwhelming the context. The system prompt stays small even as the skill library grows.

**Reference implementations**:
- Anthropic official skills: `github.com/anthropics/skills`
- Open framework reproduction: `github.com/dynamous-community/workshops/custom-skill-agent` (Pydantic AI based, useful for understanding the pattern, NOT a dependency for our work)
- Anthropic article on tradeoffs: "Code execution with MCP" (November 2025)

### MCP vs Skills tradeoff

| Pattern | Strength | Weakness |
|---------|---------|----------|
| MCP servers | Always available, structured tools, predictable | Each MCP server consumes 10-30k tokens just to be available |
| Skills + code execution | Loaded on demand, lightweight, flexible | Less predictable, agent must write/select code correctly |

Fragmint uses **both**: MCP for direct integration with Claude Desktop (9 tools always available), and a Skill wrapper for opencode (Phase 4) where the assistant invokes Fragmint capabilities through code-like delegation.

### Why Fragmint is conceptually a Skill system

Fragmint already implements Progressive Disclosure natively for documentation:

- **Templates** (YAML) = capability definitions, similar to SKILL.md
- **Fragments** (versioned `.md`) = references loaded on demand based on slot resolution
- **Composer** = execution layer that picks the right fragments and renders the document
- **MCP tools** = interface that exposes these capabilities to agents

This positioning is a strong narrative for the synthesis note (deliverable #5) and for Maudet: Fragmint is not just another doc tool, it's a **structured Skill system specialized for document generation**.

### Implications for Phase 4 (opencode Skill)

The Fragmint Skill for opencode should be designed with progressive disclosure:

```
.fragmint-skill/
├── SKILL.md                          # Level 2: when invoked
│                                       # Includes: triggers, operations,
│                                       # how to call Fragmint tools
├── references/
│   ├── template-catalog.md           # Level 3: list of available templates
│   ├── use-case-patterns.md          # Level 3: pitch, proposal, RFP, etc.
│   └── linagora-branding.md          # Level 3: brand guidelines
└── scripts/
    └── compose-helper.sh             # Level 3: optional helper script
```

The agent first sees only the SKILL.md description in its system prompt (~100 tokens). When the user asks for a document, the agent loads SKILL.md, then loads references only as needed.

---

## Optional Exploration Areas

The brief grants explicit "marge de manoeuvre" (room to maneuver) to investigate relevant axes during the mission. Examples mentioned:

- **Twake Drive integration** — store fragments in Twake Drive (interesting but not prioritized)
- **Obsidian integration** — explicitly mentioned in brief but de-prioritized by Paul
- **Other axes identified during mission** — anything that emerges as relevant

These are **not out of scope** but **not prioritized**. Pursue only if main deliverables are on track.

---

## Strict Out of Scope (for the 20 days)

- Twake Workplace integration (beyond ingesting documents from it)
- LinShare integration
- Linagora SSO
- OpenRAG direct integration (we explicitly stepped back from this — see "Why no RAG" below)
- Production-grade deployment (Kubernetes, monitoring, CI/CD)
- Comprehensive test coverage (minimum viable per Paul: "AI does unit tests well today")
- Reimplementing the Skills system in a custom framework (use opencode's native Skill support)

---

## Why no OpenRAG / RAG integration

The original brief was Fragmint × OpenRAG integration. After deep technical investigation (16 bugs documented in `BUGS.md`), the scope shifted: **make Fragmint work end-to-end first, RAG integration is a Phase 2 problem** (post-mission).

For this mission, semantic intelligence comes from:
1. **LLM-as-a-ranker** instead of pure vector similarity (palliates Milvus instability)
2. **Quality-based re-ranking** (approved > reviewed > draft) — already implemented
3. **Metadata filters** (type/domain/lang) — already implemented

---

## Success Criteria

Per Paul, no fully objective criteria. Subjective signals of success:

1. **Frequent, visible commits on the repo** — Maudet observes progress in real time
2. **End-to-end demo that works on Maudet's machine** with real Linagora data
3. **Quality of generated documents** — clean, presentable, contextually relevant
4. **Bugs documented and fixed** — turn the POC into a usable tool
5. **Architecture note** — synthesis of evolutions and current limits, including the Skills positioning
6. **opencode Skill prototype** — listed as deliverable, must exist even minimally

---

## Key Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-05-07 | Branch dedicated `juliette/mission-stabilization` instead of pushing to `main` directly | Per Paul's flexibility, less disruptive |
| 2026-05-07 | OpenRouter gpt-oss-120b for dev | Free, OpenAI-compatible, available now while waiting for ai.linagora.com creds |
| 2026-05-07 | Drop OpenRAG integration | Out of scope per revised brief, focus on Fragmint stabilization |
| 2026-05-07 | LLM-as-a-ranker pattern for composer | Palliates Milvus instability without requiring OpenRAG |
| 2026-05-07 | Obsidian plugin de-prioritized | Per Paul: cool exploration but not at the expense of main scope |
| 2026-05-07 | PPTX added as deliverable format | Contract explicitly lists `.pptx`; assume not a typo |
| 2026-05-07 | Apply Progressive Disclosure pattern for Phase 4 Skill | Aligns with Anthropic Skills standard, opencode native support, strong narrative for synthesis note |
| 2026-05-07 | Fragmint positioned as a "Skill system for document generation" in synthesis | Strategic positioning for Maudet, matches the agentic ecosystem trend |
| 2026-05-07 | Implement minimal eval infrastructure (golden dataset + LLM-as-judge) | Required by brief Phase 2 ("verify quality") + Phase 3 ("evaluate quality"); reproducible run-evals.sh becomes a demo asset and feeds synthesis Section 7 |
| 2026-05-07 | PPTX implementation: Marp→PPTX export rather than native PptxGenJS | Reuses existing Marp infrastructure, faster to ship; native PPTX is a V2 if needed |

---

## Contacts

- **Michel-Marie Maudet** — CEO Linagora, mission sponsor, observes via repo commits
- **Paul Tran-Van** — primary contact, friend, makes the bridge between Juliette and Maudet, asynchronous availability via email/Slack

---

## References

- `BUGS.md` — prioritized bug list with fix status
- `PLAN.md` — 20-day execution plan with daily breakdown and parallelization
- `CLAUDE.md` (root) — technical patterns, stack, conventions
- `.claude/external-docs/fragmint-stack.md` — stack reference
- `docs/architecture.md` (repo) — Fragmint architecture
- Mission contract Annex 3 (the brief itself)
- Anthropic Skills repo: `github.com/anthropics/skills`
- Progressive Disclosure workshop reference: `github.com/dynamous-community/workshops/custom-skill-agent`
