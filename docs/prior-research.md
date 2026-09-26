# Prior art — AI for legacy/embedded code understanding

Research done pre-hackathon (2026-09-25) to avoid re-inventing existing approaches for the SAAB track ("How might we use AI to understand legacy embedded systems?").

## 1. Architecture/intent recovery (closest to our challenge)

- **ArchAgent** — scalable legacy SW architecture recovery w/ LLMs. Case study recovers critical business logic from a real legacy repo. Most direct precedent for our "black box → interface description" goal. https://arxiv.org/abs/2601.13007
- **Reversa** — converts legacy SW into operational specs *for AI agents* (reverse-documentation framework). https://arxiv.org/html/2605.18684v1
- **Comprendia** — Eclipse plugin: dependency graph + LLM explanation on one interactive graph, CVE risk overlay via OSV.dev. Good UX precedent. https://arxiv.org/html/2608.10290
- **explain-this-codebase** — open-source: AST → networkx call/dependency graph, LLM summary per module. Forkable base for a fast demo. https://github.com/manasa086/explain-this-codebase
- **CodeGraph** (FalkorDB) — codebase → knowledge graph, natural-language query over dependencies. https://www.falkordb.com/blog/code-graph/
- **CIAO (Code In Architecture Out)** — hybrid static-analysis + LLM split for arch recovery. Confirms hybrid split is the right instinct (matches ArchAgent). https://arxiv.org/pdf/2604.08293
- **Generating Software Architecture Description from Source Code using Reverse Engineering and LLMs** — same hybrid static+LLM approach. https://arxiv.org/pdf/2511.05165
- **Automated Software Architecture Design Recovery from Source Code Using LLMs** — includes an **embedded software industrial case study**. Most directly relevant hit found so far for our track; read this one in full. https://link.springer.com/chapter/10.1007/978-3-032-02138-0_5

## 1b. Intent & design-rationale recovery (the "why was it built this way" / Chesterton's Fence angle)

Established field (design rationale, architectural design decisions) getting an LLM pass. Most aligned with SAAB's actual ask — richer than pure arch recovery.

- **sprawl** (open source) — mines git history for *why code is the way it is*: citations, bug-fix churn ranking, detects intent that has drifted out of sync with code. Large chunk of our "intent reconstruction" idea already built — read as prior art or extend it. https://github.com/uvesarshad/sprawl
- **Can LLMs Extract Architectural Design Decisions from Source Code Commits?** — direct test of the "mine rationale from commits" premise. https://arxiv.org/html/2609.03721v1
- **Recovering Fine-Grained Code Change Rationale from Multiple Software Artifacts** — key finding: rationale is *fragmented* across sources — commit messages carry the "goal," issues/PRs carry the "need." Argues for multi-source fusion. https://arxiv.org/html/2604.10345
- **DR-Miner** — mines design rationale from issue logs. https://arxiv.org/pdf/2405.19623
- **Using LLMs in Generating Design Rationale for Software Architecture Decisions** — generation side of the same problem. https://arxiv.org/pdf/2504.20781

Adjacent fields worth knowing exist even if not diving deep: **program comprehension** (mental-model-building literature — Letovsky, von Mayrhauser, Storey), **MSR (Mining Software Repositories)** — whole conference on extracting knowledge from commit/issue history, closest field to our intent-reconstruction angle, **change impact analysis** — formal literature behind "blast radius" concept.

## 2. Embedded/firmware specific

- **Firmware Reverse Engineering: A Comprehensive Review and Directions** — survey of 118 works 2014–2026, full FRE pipeline incl. AI/LLM stage. Read first, cites most of the field. https://doi.org/10.3390/electronics15173830
- **Function Renaming in Reverse Engineering of Embedded Device Firmware with ChatGPT** — LLM renames functions in decompiled embedded firmware. https://dl.acm.org/doi/10.1145/3759425.3763387
- **Trim My View** — LLM code-query system for module retrieval in *robotic firmware*. https://arxiv.org/pdf/2503.03969
- **Inferring Equivalence Classes from Legacy Undocumented Embedded Binaries for ISO 26262-Compliant Testing** — safety-certification angle, directly relevant to "what must stay same for certification/compat." https://arxiv.org/pdf/2604.22673
- **Retrograde Software Analysis** — recovers control-flow graphs + embedded constants for legacy porting/verification. https://www.emergentmind.com/topics/retrograde-software-analysis
- **Leveraging LLMs for Legacy Code Modernization** (ICSE 2025) — evaluates LLM-generated docs for MUMPS + IBM mainframe assembly. Finding: generated comments largely hallucination-free, but **flags evaluation metrics as the open problem** — worth building a demo-answer to this. https://conf.researchr.org/details/icse-2025/llm4code-2025-papers/27/

## 3. Binary/decompiler-level (if going low-level HW/FW)

- **GhidrAssist** — Ghidra plugin, LLM explains decompiled fn, renames vars/params, infers types, writes back to DB. https://github.com/symgraph/GhidrAssist
- **GhidraGPT** — similar Ghidra extension, right-click fn → LLM explain in console. https://github.com/weirdmachine64/GhidraGPT
- **GhidraMCP** — lets a model drive Ghidra directly via MCP. Fastest path to a binary-first demo if we go that route. (search "GhidraMCP" on GitHub)
- **ReCopilot** — SOTA function-name recovery + variable-type inference on decompiled pseudocode, beats generic LLM baseline by 13%. https://arxiv.org/html/2505.16366v1
- **ReF Decompile** — LLM decompiler, 61% re-executability on HumanEval-Decompile benchmark.
- **LLM4Decompile** — open-source LLM decompiler. https://github.com/albertan017/LLM4Decompile
- **SK2Decompile** — structure/knowledge-aware decompilation. https://arxiv.org/pdf/2509.22114
- **HELIOS** — structure-aware decompilation. https://arxiv.org/pdf/2601.14598
- **SoK: Potentials and Challenges of LLMs for Reverse Engineering** — orientation/survey read if going binary-first. https://arxiv.org/pdf/2509.21821

## 4. Safety/critical-behavior flagging (the "don't remove the weird guard line" problem)

No paper nails this exact framing yet — **this is the gap to target**. Closest:
- ISO 26262 equivalence-class paper (§2 above) — certification-safe behavior classes from undocumented binaries.
- **ALIBI: Adaptive Agentic Attacks via Adversarial Code Comments** — shows LLMs can be misled by fabricated/stale comments; relevant risk when trusting comments over actual behavior. https://arxiv.org/pdf/2607.24964
- **Critical Code Studies with AI** — humanities-adjacent, LLM-assisted "archaeological reading" of historic software. Conceptual framing, not tooling. https://link.springer.com/article/10.1007/s00146-026-02958-2

## 5. Commercial/product landscape

Vendor blogs (Augment Code, Entrans, KodeSage, Gray Technical "Data Chunker Pro") pitch AI legacy-modernization: chunk codebase → LLM summarize → flag critical/risky parts. Consistent theme across all of them: **AI drafts, human domain-expert confirms** — business-logic reconstruction stays human-gated because an LLM will confidently invent intent that sounds right and isn't. Matches the warning already in our own brief (CLAUDE.md: "redundant-looking line may guard 15-yr-old HW anomaly").

- https://www.augmentcode.com/tools/6-ai-platforms-for-safe-legacy-code-modernization
- https://www.entrans.ai/blog/legacy-code-reverse-engineering-with-ai
- https://kodesage.ai/blog/ai-documentation-tools-for-legacy-code

## Takeaway for our build

Field is **crowded**: architecture recovery, rationale mining, and LLM decompilation all have working implementations now (ArchAgent, CIAO, sprawl, DR-Miner, LLM4Decompile, etc). "Point an LLM at old code, generate docs" is a solved-ish demo — judges may have seen it. Don't pitch that.

What's still missing, and what SAAB's brief actually asks for, is the intersection of four things nobody combines yet:

1. **Hardware/platform grounding.** Nearly all existing work targets application software (MUMPS, Java, Python, mainframe). Almost nobody reasons about *silicon errata, timing assumptions, register semantics, peripheral dependencies*. SAAB's brief names this explicitly ("what depend on obsolete HW/timing assumption") — it's what "given input about digital platform" is pointing at.
2. **Criticality ranking.** Recovering architecture ≠ telling an engineer *which parts are safety-/mission-critical and must not change*. That's a distinct, separate output, and it's explicitly in SAAB's success criteria.
3. **Change-safety as the goal, not documentation.** Nearly everything above optimizes for docs or modernization output. SAAB's framing is *reconstruct intent/dependencies/risk **before making a change*** — the user is someone about to edit, not someone reading for understanding.
4. **Evaluation / provenance.** ICSE 2025 paper (§2) flags evaluation as an open problem industry-wide. A crude ground-truth check (Linux quirk tables, errata-referencing commits, etc.) would answer the judges' inevitable "how do you know it isn't hallucinating?" — and the literature says this is currently missing.

That combination — **hardware-aware intent recovery, ranked by criticality, aimed at a specific proposed change, with verifiable provenance** — is a defensible, differentiated pitch position.

Fast path: fork `explain-this-codebase` (dependency graph) or ArchAgent's hybrid static+LLM split, add a `sprawl`-style git-history rationale layer (bug-fix churn ranking + intent-drift detection), then layer criticality flags (git-blame/comment-age heuristics + LLM cross-check against any available HW datasheet/spec/errata) on top — framed around "propose a change, show what breaks and why it might be load-bearing" rather than just summarizing.

## 6. Token-efficient codebase understanding (informs scan pipeline, `docs/plan.md` §4.1)

Added 2026-09-25 when we moved to the 4-tab product. The question was how to understand a whole repo **without sending all of it to an LLM**, and ideally in **one scan**.

- **CodeBoarding** (MIT): https://github.com/CodeBoarding/CodeBoarding
  - How it works: it extracts symbols and call graphs with LSP static analysis. An LLM then groups them into components and describes them.
  - Outputs: `analysis.json`, nested component diagrams, and Mermaid/HTML docs.
  - Incremental re-analysis of changed parts only.
  - Works with OpenAI-compatible gateways (`openai_base_url`).
  - **Its README lists Python/TS/JS/Java/Go/PHP/Rust/C#, but not C/C++**, so we can't run it directly on PX4. We copy the pattern (static graph, LLM grouping, nested diagrams) instead. This is the reference UX for our Tab 3.
- **DeepWiki-Open** (MIT): https://github.com/AsyncFuncAI/deepwiki-open
  - A repo-to-wiki generator with an "Ask" chat. Next.js frontend, Python backend, and support for OpenAI-compatible / Ollama / LiteLLM providers.
  - The reference UX for our Tabs 1 and 2.
- **Aider repo map**: https://aider.chat/docs/repomap.html
  - Tree-sitter extracts definitions and references.
  - Graph ranking (PageRank over the file dependency graph) picks the most important symbols.
  - The result is sent as a **signatures-only skeleton** that fits a token budget (default about 1k tokens).
  - This is the core idea behind our "skeletons, not bodies" and "rank before you read."
- **RepoGraph** (ICLR 2025): https://arxiv.org/abs/2410.14684
  - A line-level repo graph (definition and reference nodes) built with tree-sitter.
  - It retrieves **ego-graphs** around keywords instead of whole files.
  - The basis for our transitive caller/callee tools and blast radius.
- **cAST** (EMNLP 2025 Findings): https://arxiv.org/abs/2506.15655
  - AST-based chunking for code RAG: split big AST nodes and merge small siblings, within a size limit.
  - Beats line-based chunking (+4.3 Recall@5 on RepoEval).
  - Our search index uses function/struct-level chunks for this reason.
- **RAPTOR** (hierarchical summarization tree): https://arxiv.org/abs/2401.18059
  - Recursive bottom-up summaries, then retrieval at any level of abstraction.
  - The basis for our file → component → system summaries.
- **GraphRAG** (Microsoft): https://arxiv.org/abs/2404.16130
  - Community detection over a knowledge graph, plus community summaries, for answering "global" questions.
  - Same idea as our Louvain components plus component summaries.

**What we take from all this:**

1. Parse and graph everything deterministically. That part costs no tokens.
2. Rank symbols by centrality and embedded criticality.
3. Give the LLM skeletons plus the top-N bodies only.
4. Summarize hierarchically.
5. Cache so re-scans are incremental. Parsing is cached by file content. LLM calls are cached by a hash of their full input, so parent summaries invalidate when their inputs change (`docs/plan.md` §4.5).
6. Answer questions with agentic tool calls over the model, not by stuffing context.

**Limits we accept and surface:**
- Tree-sitter parses syntax. It can't resolve C++ overloads, virtual dispatch, function pointers, macros or `#ifdef` variants (https://tree-sitter.github.io/tree-sitter/).
- Our call graph is name-matched, and every edge carries a resolution status. clangd with `compile_commands.json` is the upgrade path.
