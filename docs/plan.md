# Product Plan — v2.3 (2026-09-25)

> Supersedes plan v1.0. Source of truth for product scope. If code and this file disagree, fix one of them. Don't leave them out of sync.
>
> **v2.4 changes (Sat 02:00):** the UI pass. The four tabs are now one system view: a wiki (Tab 1), a chat dock at the bottom of every system page (Tab 2), a 3D graph with a blast radius meter (Tab 3), and GitHub-style pull requests and reviews (Tab 4). The features in §5 are unchanged; where each one lives, and how it looks, is in `docs/ui-spec.md`. Repositories can now be deleted.
>
> **v2.3 changes (Fri 23:45):** all four tabs are built. The libraries (§6), API contract (§6.2), folder structure (§6.3), the §7 status column, the demo scenario (§8) and the open decisions (§9) now describe the code as it is. The build status, measured numbers, where the build differs from this plan, and the remaining TODOs are in `docs/status.md`.
>
> **v2.2 changes:** the stack is decided. It's one SvelteKit app (adapter-node) with Better Auth (GitHub), and no separate backend (§6). Build priority: working first, polish later (§7).
>
> **v2.1 changes** (after an external review of v2.0):
> - an evidence and uncertainty model (§4.5): edge resolution status, two-layer scan scope, snapshot identity, input-hash caching, stricter Verified rule;
> - pinned before/after snapshots for PR review;
> - an analysis-completeness field that can block SAFE;
> - human-only overrides of the rule floor;
> - "related tests found" instead of "covered";
> - Prompt 01 split into 01a and 01b, with the git-signal spike as a gate.

## 1. The problem, in the mentor's words

From our talks with the SAAB mentor (Lars-Erik Lindberg):

- Today they answer *"If I change this, what else changes, and what critical parts do I need to think about?"* by digging through the codebase **by hand**.
  - **Software change:** which critical parts are affected, and which timing has to be preserved?
  - **Hardware change:** what does it do to the software?
- **Speed matters more than being 100% correct.** A fast, grounded first answer (something like a chatbot) beats days of manual digging, as long as it's honest about what it doesn't know.
- They need a **good description of the system**: its architecture, which parts are critical, and how everything is connected.
- A change must **not break a critical component or interface**. The way to guarantee that is **test coverage / a test suite** for the change.
- Some things in embedded software **aren't documented anywhere and can't be known** from the code. The tool has to say so rather than invent an answer.
- **Timing can be critical** in these systems.

Assumptions we're allowed to make:

- We pick **one open-source GitHub project**: **ArduPilot**, deep scope `libraries/AP_InertialSensor`, with RTEMS SPARC/LEON as the fallback. Chosen by the git-signal spike; see `docs/repos.md` and `docs/spike-results.md`.
- **Git is always available.** The codebase has history (commits, blame, authors).
- Parts of the system are undocumented.

## 2. Product in one sentence

A web app that **scans a legacy embedded repository once**, builds a **system model** (architecture, dependencies, critical parts, git-derived intent, and who wrote what), and exposes it through **four tabs**: Onboarding docs, a codebase chatbot, an interactive dependency graph, and a PR risk reviewer.

## 3. Non-negotiable product rules

These apply to every tab, every prompt, and every screen.

1. **Honesty over fluency.** Every claim the tool makes is labelled as one of:
   - **Verified**: a fact the cited evidence **states directly**. Examples: "the code waits 10 ms after reset" (cites the line), or "this line was added in commit abc123, whose message says it works around errata X" (cites the commit). The citations must resolve in the claim's snapshot, and they must be part of the evidence the LLM was actually given (see §4.5).
   - **Inferred**: reasoned from context, with a confidence of low, medium, or high, plus the evidence it's based on. **Every rationale or intent claim is Inferred unless a comment or commit message states it.** For example, "the hardware requires 10 ms" is Inferred unless something says so explicitly.
   - **Unknown**: the information isn't in the code or git history. The tool says what's missing and suggests who to ask (see rule 3).

   When in doubt, the LLM **must** answer "Unknown". Prompts, output schemas, validators and UI all enforce this, and the UI renders all three labels visibly differently.
2. **Everything cites.** File paths, line ranges, and commit SHAs in the UI are clickable. They open the code view, the GitHub permalink, or the commit. Each citation records **which snapshot** (commit) it refers to.
3. **"Ask the author" button everywhere a line of code appears.** That covers chat citations, graph node details, PR review findings, and onboarding docs. Git history gives us:
   - **Last modified by**: `git blame` for the line.
   - **Introduced by**: *best effort*. We trace the first commit that added the line with `git log -L <start>,<end>:<file> --reverse`, falling back to the pickaxe (`-S`). This breaks when code has been moved, reformatted or rewritten. In that case the UI shows **"Unknown: history too tangled"** and falls back to last-modified-by.
   - For each person: name, email from the commit metadata, GitHub login and profile (via the GitHub commits API), commit date, and commit message.
   - Actions: `mailto:` with a pre-filled subject and body (repo, file:line, commit, the question), open GitHub profile, and copy question.
   - Caveats shown in the UI: `noreply` emails, people who have left, and last-activity date in the repo. The tool **never sends anything automatically**. The user clicks.
4. **GitHub login gates the app.** On first launch the user sees only a "Sign in with GitHub" screen. After OAuth they get full access, and their token is used to list repos, read PRs, and resolve commit authors.
5. **Git is assumed.** No non-git ingestion paths.
6. **Speed over perfection, but never fabricate.** Prefer a fast answer with clear confidence labels over a slow "complete" one.
7. **Missing evidence never implies safety.** Anything outside the analysed scope, or any reference we couldn't resolve, shows up as an explicit gap ("external impact: unknown"). It never shows up as "no dependents." Every impact result and verdict carries an **analysis completeness** indicator.

## 4. Core architecture: scan once, reuse everywhere

```
                 ┌───────────────────────────────────────────────┐
 GitHub repo ──► │ SCAN PIPELINE (runs once per snapshot,        │
 (+ subpath)     │  incremental afterwards via content-hash cache)│
                 │  0 acquire → 1 static → 2 git mining →        │
                 │  3 signals+criticality → 4 components →       │
                 │  5 LLM summaries → 6 docs → 7 search index    │
                 └──────────────────────┬────────────────────────┘
                                        ▼
                          SYSTEM MODEL (knowledge store)
             symbols · edges · components · signals · commits ·
             blame · authors · summaries · claims · search index
                ▲            ▲              ▲              ▲
          Tab 1 Onboarding  Tab 2 Chat   Tab 3 Graph   Tab 4 PR Review
          (reads docs)   (agent w/ tools) (reads graph)  (diff × model)
```

The scan is the product's foundation. Tabs 2–4 **never re-read the whole codebase**. They query the system model, which is also what keeps token use bounded.

### 4.1 Token-efficient scan strategy

Throwing the whole codebase at an LLM blows through context limits and budget. The approach below combines existing work (see `docs/prior-research.md` §6):

- **Deterministic first, LLM last.** Stages 0–4 use **no LLM at all**: parsing, graphs, git mining, heuristics, clustering. The LLM only sees compact, pre-digested inputs.
- **Skeletons, not bodies** (Aider repo-map idea). Per file, the LLM gets:
  - function and type signatures;
  - doc comments and inline comments;
  - macros and constants;
  - the detected signals (below);
  - a short git summary.

  Full function bodies go in **only** for the top-N symbols by criticality score. *Estimate, not measured yet:* roughly 10–20% of raw file tokens. Measure it on the demo target and replace this number.
- **Rank before you read** (PageRank, as in Aider and RepoGraph). Centrality and fan-in on the dependency graph, plus the criticality score, decide what gets LLM attention and in what order. Everything under the budget cut-off gets a deterministic summary: its signature list and signals.
- **Hierarchical, bottom-up summarization** (RAPTOR / DeepWiki / CodeBoarding style): file → component → system. Each level only sees summaries of the level below, never raw code.
- **AST-aware chunking** (cAST) for the search index. Chunks are whole functions or structs, never arbitrary line windows.
- **Content-addressed caching** (details in §4.5):
  - parse results are keyed by file content;
  - LLM calls are keyed by a hash of their **complete normalized input** plus the prompt and model config.

  Re-scans only pay for inputs that actually changed. This is how "one scan is enough" holds up over time.
- **Model tiering** (Gonka models, OpenAI-compatible API):
  - `MiniMaxAI/MiniMax-M2.7` for high-volume per-file summaries.
  - `deepseek-ai/DeepSeek-V4-Flash-0731` or `zai-org/GLM-5.3-Flash` for component and system synthesis, chat, and PR verdicts.
  - On a 429 error, retry with backoff, then fall back to another model.
- **Budget guardrails.**
  - Keep every prompt ≤ ~24k tokens (the context windows of the broker models aren't verified yet).
  - Run with a hard per-scan token budget, and log the actual spend.
  - Show "tokens used" in the UI. It's a demo point: "scanned X kLOC for Y tokens."

### 4.2 Scan pipeline stages

| # | Stage | LLM? | Output |
|---|---|---|---|
| 0 | **Acquire**: clone with history. Two scopes (§4.5): the **deep scope** (e.g. `libraries/AP_InertialSensor`, full analysis) and the **reference scope** (by default the whole repo at the same commit, used for the cheap symbol-reference index only). | no | local clone, file inventory, languages, snapshot ID |
| 1 | **Static analysis**: tree-sitter C/C++ over the deep scope. Over the reference scope, only identifier/tag extraction for the reference index. | no | symbols (functions, classes, methods, structs, enums, macros, globals, ISRs); edges `includes`, `calls`, `reads/writes global`, `uses macro`, **each with a method and a resolution status** (§4.5); public headers; out-of-scope references |
| 2 | **Git mining**: log, blame, and change patterns (deep scope). | no | per file and per symbol: churn, age, authors, bug-fix commits (fix/bug/workaround/errata/revert keywords), reverts; **co-change correlation** (files that change together, a hint at hidden coupling and **not** a dependency); issue/PR refs in commit messages (`#123`); author identity map (email → GitHub login) |
| 3 | **Embedded signals and criticality score**: see §4.3. | no | `Signal` records with location and snippet; per-symbol and per-component criticality score with an explanation of what contributed |
| 4 | **Componentization**. **Small scopes** (under ~30 files): directory structure only, because clustering a single driver is pointless. **Larger scopes:** directory structure plus community detection (Louvain) on resolved edges. | no | components with members, and inter-component edges |
| 5 | **LLM summaries**: bottom-up (file → component → system) using skeletons and the ranked budget. | yes | per-file / component / system summaries, each as validated structured claims (§4.5) |
| 6 | **Docs generation**. | yes (cheap, from summaries) | onboarding doc, architecture overview (Mermaid), critical-parts register, external interfaces list, timing and hardware assumptions list, glossary, **open questions / unknowns** list, **scope and coverage note** |
| 7 | **Search index**: SQLite FTS5 (BM25) over AST chunks, symbol names, summaries and commit messages. Local embeddings (e.g. transformers.js in Node) are an optional upgrade. | no | hybrid search |

**Note on embeddings:** the Gonka brokers list chat models only. Don't depend on a hosted embedding API. BM25 plus the symbol graph plus LLM-written summaries is enough for the MVP.

**As built (Fri 25 Sep):**
- **Stages 0–4** run as specified, with one exception: stage 1 uses our own syntax-level C/C++ scanner (`cparse.ts`) instead of tree-sitter. It keeps the same edge contract: method, resolution, candidates.
- **Stage 5** exists only as an on-demand LLM system overview (`POST /api/scans/{id}/summary`).
- **Stage 6** is the deterministic onboarding pack.
- **Stage 7** is not built; chat searches the stored model in memory.
- **Limits:** a deep scope may hold at most 500 C/C++ files, and rescanning an already-analysed snapshot reuses its stored model.
- Measured timings are in `docs/status.md`.

### 4.3 Embedded-specific signals (what makes this more than DeepWiki)

Detected with tree-sitter queries, regexes and git history. Each signal adds to the criticality score, and each one is **evidence the verdicts and docs can cite**.

- **Interrupts / concurrency:**
  - ISR handlers (`*_IRQHandler`, `ISR(`, `__attribute__((interrupt))`);
  - disabling or enabling interrupts, and critical sections;
  - mutexes, atomics, memory barriers.
- **Hardware access:**
  - `volatile` usage;
  - MMIO pointer casts to fixed addresses;
  - register macros and bit manipulation;
  - bus I/O (I2C / SPI / UART / CAN transfer calls).
- **Timing:**
  - delays and sleeps (`usleep`, `px4_usleep`, `hal.scheduler->delay`, `udelay`, busy-wait / NOP loops);
  - timeouts and intervals, watchdog kicks, scheduling calls (`ScheduleDelayed`, `hrt_absolute_time`);
  - conversion-time and rate constants.
- **Workarounds and rationale markers** in comments:
  - `errata`, `silicon`, `rev`, `workaround`, `hack`, `quirk`, `datasheet`;
  - `do not`, `don't remove`, `must`, `XXX`, `FIXME`;
  - chip-revision checks.
- **Defensive / redundant-looking code:** retry loops, double reads, CRC and sanity checks, and magic numbers. These are exactly the "redundant-looking line" from SAAB's brief.
- **External interfaces:**
  - public headers and `extern` APIs;
  - message / topic definitions (e.g. uORB, MAVLink);
  - parameters and config;
  - protocol constants.
- **Platform variants:** `#ifdef` board/chip/OS branches.
- **Git risk signals:**
  - line or function introduced by a bug-fix or revert commit;
  - high bug-fix density;
  - old and untouched (stable, load-bearing);
  - single author (bus factor);
  - strong co-change correlation.

Signals are **heuristic evidence**. They raise attention; they don't prove criticality. The UI says what fired and why. It never states "this is safety-critical" as a Verified fact.

### 4.4 System model (data model)

Stored in SQLite (+ FTS5) per **snapshot** (§4.5), with JSON exports for the frontend.

- `Repo`
- `Snapshot`: repo, commit SHA, deep scope, reference scope, analysis config hash, parser version, `snapshot_id = hash(all of these)`.
- `ScanRun`: snapshot, status, stage, progress, token spend, coverage stats (files parsed and failed, references resolved / ambiguous / unresolved).
- `File`, `Symbol`: kind, signature, range, file, component, `in_deep_scope`.
- `Edge`: from, to, kind, weight, plus:
  - `method`: `ast_direct | name_match | include_path | reference_index | git_cochange`
  - `resolution`: `resolved | ambiguous | unresolved`
  - `candidates[]` (for ambiguous edges)
  - `evidence` (file:line of the reference)

  Edge kinds are `calls | includes | uses_global | uses_macro | component_dep`, plus `co_changes`, which is **correlation only**. Impact traversal never follows `co_changes` as if it were a dependency.
- `Component`: members, summary, criticality.
- `Signal`: kind, symbol/file, line range, snippet, source (`static | comment | git`).
- `Commit` (sha, author, date, message, is_bugfix, refs), `BlameRange`, `Author` (name, emails[], github_login, first/last active).
- `Claim`: text, status (`verified | inferred | unknown`), confidence, `basis` (`code_fact | commit_statement | comment_statement | inference`), and `citations[]`. Each citation is `{snapshot_id, path, start, end}` or `{sha}`. This is the atom every LLM output is made of.
- `Doc`: kind, markdown, claims[].
- `LLMCall`: input hash, prompt ID and version, model, tokens, cached (bool).

### 4.5 Evidence and uncertainty model

This is the contract every tab relies on. It's cheap to build now and expensive to retrofit later.

**1. Graph edges carry uncertainty.** Tree-sitter gives syntax, not semantics. It can't resolve C++ overloads, virtual dispatch, function pointers, macro-generated calls or `#ifdef` build variants on its own.

- A direct call to a unique name inside the deep scope is `resolved`.
- A name with several candidates (overloads, same-named methods, virtual calls) is `ambiguous`, with the candidates listed.
- Function pointers, macro calls and callbacks we can't follow are `unresolved`, and they're recorded as open ends.
- The UI draws ambiguous edges dashed and unresolved ones as stubs. Impact results report counts of each.
- *Next step, not MVP:* clangd / `compile_commands.json`-based resolution.

**2. Two-layer scope.** Deep analysis of one driver can't see who calls it from outside.

- The **deep scope** gets the full pipeline: signals, git mining, and LLM summaries.
- The **reference scope** (by default the whole repo at the same commit) gets only a cheap, no-LLM identifier index built with tree-sitter tags. It answers "where else is this symbol, header or topic referenced?"
- If the reference scope is restricted, or a reference can't be matched, the result says **"impact outside analysed scope: unknown."** It never says "no dependents."

**3. Snapshot identity.** Everything, including every citation, belongs to a snapshot. A snapshot is the commit plus both scopes, the analysis config and the parser version. Changing any of these makes a new snapshot.

**4. Caching.**

- **Parse cache:** `(file content hash, parser/grammar version)`.
- **LLM cache:** `hash(complete normalized input messages + prompt ID/version + model + generation params)`.
  - Parent summaries automatically invalidate when a child summary, signal, dependency or history input changes, because those are part of their input.
  - There's no reliance on a single file blob SHA. Component and system summaries don't have one anyway.

**5. Claim validation.** This runs after every LLM call, before anything is stored or shown.

- Every citation must resolve in the claim's snapshot: the path exists, the line range is valid, the SHA exists.
- Every citation must be **part of the evidence packet sent to the LLM** for that call. The model can't cite things it never saw.
- If a claim quotes code, the quoted text must actually appear in the cited lines.
- A claim marked `verified` needs a `basis` of `code_fact`, `commit_statement` or `comment_statement`, plus a valid citation. Otherwise it's downgraded to `inferred`.
- A claim marked `inferred` that has no valid citation is downgraded to `unknown`.
- Summaries built on child claims can't upgrade their certainty. A component claim built only from inferred file claims stays inferred.

## 5. The four tabs

### Tab 1: Overview & Onboarding

*"Give me the system in 15 minutes."*

- Pick a repo and run a scan. Options: GitHub repo from the user's account, or a pasted public URL such as ArduPilot. Optional subpath (deep scope) and ref.
- Live progress through the stages, plus the token counter.
- Generated onboarding pack:
  - **System overview:** purpose, main flows, architecture diagram (Mermaid, component level).
  - **Components:** responsibility, key files, interfaces, and criticality for each.
  - **Critical-parts register:** ranked list with the "why" (signals and git evidence) and an Ask-the-author button.
  - **External interfaces:** what other systems see and depend on.
  - **Timing and hardware assumptions:** every timing constant, delay, ISR and chip-specific workaround, with citations.
  - **Open questions / unknowns:** what the tool couldn't determine and who to ask.
  - **Scope and coverage:** what was analysed deeply, what was only indexed, how many references were resolved / ambiguous / unresolved, and what is unknown.
  - **Where to start reading:** a guided reading order.
- Export as Markdown.

### Tab 2: Codebase Chat (DeepWiki-style)

*"Ask anything about the system."*

- **Agentic retrieval over the system model**, not naive RAG over raw code. The LLM calls tools:
  - `search(query)`: BM25 over chunks, summaries and commits.
  - `get_symbol`, `get_file(range)`.
  - `callers` / `callees` (transitive, depth-limited, returning resolution status and out-of-scope gaps).
  - `component_summary`, `signals(symbol|file)`.
  - `git_history(file|symbol)`, `blame(file, line)`, `co_changed_with(file)`.
- The system summary and component list are always in context (small, cached). Everything else is pulled on demand.
- Tool results form the evidence packet for claim validation (§4.5), so the chat can only cite what it actually fetched.
- Answers stream, with the Verified/Inferred/Unknown labels and clickable citations. Each cited line gets an Ask-the-author button.
- **"Can I change this?" mode** (Chesterton's Fence, from `docs/ideas.md`). The user points at a line or function, or pastes it, and gets the same verdict engine as Tab 4, run on a hypothetical change.
- Suggested starter questions: "What are the timing-critical paths?", "What happens if chip X is replaced?", "Why does function Y retry 3 times?"
- **Hardware-change questions** ("we're replacing sensor X with Y") work like this:
  - map to every symbol with bus / register / timing signals tied to that chip;
  - list what the replacement must satisfy;
  - say "Unknown" where the datasheet would be needed.

### Tab 3: Dependency Graph (CodeBoarding-style)

*"See how everything connects."*

- Interactive graph with **three zoom levels**: components, then files, then symbols. Double-click to drill down.
- **3D force-directed view** (`react-force-graph-3d`) with a 2D toggle for readability.
- Node size shows fan-in / centrality. Node colour shows criticality. Badges mark signal types: ⏱ timing, ⚡ ISR, 🔧 HW register, 🩹 workaround, 🔌 external interface.
- **Edge styles show certainty:**
  - solid lines are resolved edges;
  - dashed lines are ambiguous;
  - stubs are unresolved;
  - dotted, separately coloured lines are co-change correlation, off by default.
- Nodes outside the deep scope (found via the reference index) appear greyed out as **boundary nodes**.
- **Click a node:**
  - highlights its upstream and downstream dependencies (transitive, with a depth slider);
  - opens a side panel with the summary, signals, criticality explanation, recent commits, co-change partners, the top authors with Ask-the-author, and **counts of unresolved or out-of-scope references**.
- Filters by edge kind (calls / includes / co-change) and by signal type. Search box.
- Blast-radius overlay: select a node and the graph shows everything that would be affected if it changed. It uses the same engine as Tab 4, with the same completeness indicator.

Reference: CodeBoarding (https://github.com/CodeBoarding/CodeBoarding, MIT). It uses LSP static analysis plus LLM grouping into components, with nested diagrams. It **doesn't list C/C++ support**, so we reproduce the idea with our own tree-sitter pipeline instead of running it directly.

### Tab 4: PR Risk Reviewer

*"Is this PR safe to merge?"* This is the sharpest answer to SAAB's brief.

**Flow:**

1. The user is already signed in with GitHub. The app lists all their repos, plus public repos they add by URL.
2. The user picks a repo and sees its open (and recent closed) PRs.
3. The user picks a PR and the review runs.

**Review engine:**

1. **Pin the snapshots.** From the GitHub API, record the PR's `base.sha` (target branch tip), `head.sha`, and the **merge base** (from the compare endpoint, which is what GitHub's diff is computed against).
   - If the merge-base snapshot hasn't been scanned, scan it (incrementally, via the cache).
   - Then parse the **changed files at head** with tree-sitter. That's cheap, and it catches new symbols and new dependencies.
   - If the merge base differs from the base tip, say so in the review.
2. **Map the diff.**
   - Removed and modified-old lines are mapped against the **merge-base** snapshot.
   - Added and modified-new lines are mapped against the **head** snapshot.
   - The output: symbols touched, symbols added or removed, and dependencies added or removed.
   - Every citation records its snapshot.
3. **Deep reference exploration:**
   - transitive callers and callees, includes, global-variable users, and external interfaces reached, with resolution status;
   - hits from the reference index outside the deep scope;
   - co-change partners, listed separately as *"often changed together"*, never as dependents.
4. **History for every touched or removed line** (from the merge-base snapshot):
   - blame, and the introducing commit with its message (best effort, rule 3);
   - whether it was a bug-fix, revert or workaround commit;
   - linked issues/PRs (resolved via the GitHub API when they're referenced as `#123`);
   - authors.
5. **Signals hit:** timing, ISR, HW register, workaround comments, interface contracts, platform variants.
6. **Test impact:** worded honestly.
   - **Related tests found:** tests that reference the touched symbols (static match). This is **not** coverage.
   - **No related test found:** critical touched behaviours with no referencing test.
   - **Executed coverage / assertion verification:** out of scope for the MVP. The review states this plainly.
   - **Suggested tests:** characterization / regression tests and timing assertions that would protect the critical behaviour before merging.

   This covers the mentor's "make sure it doesn't break, via a test suite."
7. **Analysis completeness:** `complete | partial | insufficient`. It's computed deterministically from:
   - unresolved or ambiguous edges reachable from the touched symbols;
   - references outside the deep scope;
   - files that failed to parse;
   - `#ifdef` variants not analysed;
   - missing history.

   It's shown next to the verdict, with the reasons.
8. **Verdict: SAFE / RISKY / DANGEROUS / STOP.**
   - A **deterministic rule floor** is computed first:

     | Condition | Minimum verdict |
     |---|---|
     | Removing or changing a line introduced by a bug-fix/workaround/errata commit | DANGEROUS |
     | Changing an ISR, timing constant, HW register access or external interface | DANGEROUS |
     | Removing an explicit workaround or errata fix | STOP |
     | Changing a symbol whose callers are only partly known (completeness `partial` / `insufficient`) | RISKY |

   - **Change-class exception:** a diff that only touches comments, whitespace or log/message strings (checked at the AST level) changes no behaviour. It can be SAFE regardless of scope completeness. This keeps SAFE reachable on subdirectory scans without lying.
   - The LLM can **raise** the verdict freely, with cited reasons.
   - The LLM **cannot lower** the verdict below the floor. Only a **human override** can: a button that asks for a written reason. The override is stored and shown on the review ("floor DANGEROUS, overridden to RISKY by @user: reason").

   | Verdict | Meaning |
   |---|---|
   | **SAFE** | Behaviour-free change (comments, whitespace, log strings) **or** completeness is `complete`, no critical signals touched, small blast radius, and related tests found |
   | **RISKY** | Touches medium-critical code, has a moderate blast radius, no related tests, **or incomplete analysis** |
   | **DANGEROUS** | Touches timing / ISR / HW / external interface / workaround code, or code with a bug-fix history |
   | **STOP** | Removes or alters an explicit workaround / errata fix, or changes a timing or interface contract with no evidence of intent. Needs human sign-off. The review points to the original author via Ask-the-author. |

**Output:**

- verdict banner, completeness indicator, and a one-paragraph rationale;
- the pinned SHAs (merge base, base tip, head);
- findings list, each with a severity, Verified/Inferred/Unknown label, citations (code and commits, with their snapshot) and Ask-the-author;
- blast-radius mini-graph, drawn with the certainty styles;
- test-impact section;
- "unwritten assumptions this PR may break" list;
- open questions;
- override history.
- *Stretch:* "Post as PR comment" button. Explicit user click only, never automatic.

**Next step for the pitch** (not the MVP): a GitHub Action / CI gate that runs the same engine on every PR (the "PR Gate" in `docs/ideas.md`).

## 6. Tech stack (decided: SvelteKit + Better Auth)

**One SvelteKit app, no separate backend service.** SvelteKit server code (`+server.ts` endpoints, `+page.server.ts` loads and actions, `hooks.server.ts`) runs in a normal long-lived Node process. That process can do everything the application logic needs:

- spawn `git`;
- parse C/C++ with tree-sitter (WASM);
- run graph algorithms;
- hold SQLite;
- call the LLM and GitHub;
- stream SSE.

Every library below has a mature JS/TS equivalent, so a Python service would only add a second runtime, a second deploy, and an internal API to keep in sync.

**Conditions that make this work** (break any of these and we'd need more):

- **Use `@sveltejs/adapter-node`. Serverless adapters are out** (Vercel, Netlify, Cloudflare). Scans take minutes, need a `git` binary, and need a persistent disk for clones and SQLite. Serverless functions time out and have none of that.
- **Background jobs run in-process.** A small job queue module (concurrency 1–2) holds scan and review jobs and emits progress events that SSE endpoints subscribe to. No Redis or queue service is needed for a single-machine demo.
- **CPU-heavy parsing can move to `worker_threads`** if it blocks the event loop and the UI stops responding during a scan. That's still the same app, not a separate service.
- **We would only add a separate worker service** for multi-user or hosted production scale, or if we needed clangd-based C++ resolution. Neither applies to the hackathon.

### Libraries

As built. Where the build differs from the original plan, the plan is in parentheses.

- **Framework:** SvelteKit 2 + Svelte 5 + TypeScript, `@sveltejs/adapter-node`.
- **UI:** plain Tailwind (shadcn-svelte was planned, not used).
  - **Graph:** `force-graph`, 2D canvas. The 3D view was cut.
  - **Diagrams:** Mermaid source is in the Markdown export; it isn't rendered in the UI.
  - **Code viewer:** not built. Citations link to GitHub permalinks pinned to the snapshot commit. (Shiki was planned.)
- **Auth: Better Auth** with the GitHub social provider (details in §6.1).
- **Parsing:** our own syntax-level C/C++ scanner, `src/lib/server/scan/cparse.ts`.
  - It blanks comments, literals and `#else` branches, then finds functions, classes, macros, includes, call sites and indirect calls.
  - It has no native or WASM dependencies. (`web-tree-sitter` was planned.)
- **Graphs:** `graphology` + `graphology-communities-louvain`.
  - Ranking uses fan-in plus signals, not PageRank.
  - `graphology-metrics` is installed but unused.
- **Git:** the `git` CLI via `child_process.execFile`. No shell, and arguments are never interpolated.
- **GitHub API:** `fetch` against the REST API with the signed-in user's token (`src/lib/server/github.ts`). (`octokit` was planned.)
- **LLM:** the `openai` npm SDK pointed at a Gonka broker base URL (OpenAI-compatible).
  - Retry, then fall back to the other model.
  - Cache keyed by the input hash.
- **Storage:** `better-sqlite3` via Drizzle, one file (`DATABASE_URL`, `local.db` in dev).
  - It holds the Better Auth tables, scans, the per-snapshot system model, reviews and the LLM cache (`llm_call`).
  - Clones live under `data/`, which is gitignored.
  - No FTS5 yet.
- **Tests:** `vitest` (server unit tests), Playwright (e2e scaffold).
- **Config:** `.env`, never committed:
  - `DATABASE_URL`, `DATA_DIR`, `ORIGIN`;
  - `BETTER_AUTH_SECRET`;
  - `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`;
  - `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL_FAST`, `LLM_MODEL_STRONG`.

### 6.1 Auth (Better Auth + GitHub)

- **Server setup:**
  - `src/lib/server/auth.ts` calls `betterAuth({ database: <better-sqlite3 instance>, socialProviders: { github: { clientId, clientSecret, scope: [...] } }, plugins: [sveltekitCookies(getRequestEvent)] })`.
  - `sveltekitCookies` must be the last plugin, and it requires SvelteKit ≥ 2.20.
  - Create the tables with the Better Auth CLI migration.
- **Scopes:** `read:user` and `user:email` (Better Auth requires `user:email`), plus `repo`, which is needed to list private repos and read PRs.
  - `repo` also grants write access. The UI says so on the login screen, and the app never writes to GitHub without an explicit user click.
  - For a public-only demo, `public_repo` is enough.
- **Callback URL:** `<BETTER_AUTH_URL>/api/auth/callback/github`. Register it in the GitHub OAuth App.
- **Request handling in `hooks.server.ts`:**
  - `auth.api.getSession({ headers })` puts the session and user into `event.locals`.
  - `svelteKitHandler({ event, resolve, auth, building })` serves `/api/auth/*`.
  - **Login gate:** every route except `/login` and `/api/auth/*` redirects to `/login` without a session. API routes return 401 instead.
- **Client:** `createAuthClient()` from `better-auth/svelte`. The login button calls `authClient.signIn.social({ provider: "github" })`.
- **GitHub token for API calls:** read it server-side with `auth.api.getAccessToken(...)` for the user's GitHub account. It never reaches the browser.
  - Check the exact parameters against the installed Better Auth version.
  - GitHub OAuth tokens don't expire or refresh.

### 6.2 API contract (SvelteKit `+server.ts` endpoints)

As built. Shapes live in `src/lib/{scan,model,review,claims,github}.ts`.

```
/api/auth/*                          → Better Auth (sign-in, callback/github, sign-out, session)

GET  /api/github/repos               → user's repos (all pages)
GET  /api/github/repos/{owner}/{repo}            → any repo the token can read (e.g. public ArduPilot)
GET  /api/github/repos/{owner}/{repo}/branches   → all branches
GET  /api/github/repos/{owner}/{repo}/pulls?state=open|closed   → 50 most recently updated PRs

POST /api/scans                      { repo: "owner/name" | url, ref?, subpath?, reference_scope?: "repo" | "subpath" } → { scan_id, snapshot_id }
GET  /api/scans                      → the user's recent scans
GET  /api/scans/{scan_id}            → status, stage, tokens_used, stats (inventory, structure, git, signals, components); polled by the UI
GET  /api/scans/{scan_id}/docs       → onboarding pack (claims + citations); ?format=md downloads Markdown
GET  /api/scans/{scan_id}/graph?level=component|file|symbol&file=&cochange=1   → nodes, edges (resolution), boundary directories
GET  /api/scans/{scan_id}/node?id=<node>&impact=<depth>   → node details (signals, commits, authors, co-change, edge counts, ask) + blast radius
GET  /api/scans/{scan_id}/authorship?path=&line=  → { lastModifiedBy, introducedBy | null, introducedNote }
POST /api/scans/{scan_id}/chat       { messages[] } → { answer, claims[], steps[], downgrades, tokens }   (not streamed)
POST /api/scans/{scan_id}/summary    → LLM system overview { overview, claims[] }   (no UI yet)

GET  /api/reviews                    → the user's reviews
POST /api/reviews                    { owner, repo, pr_number } | { repo: "owner/name", pr_number } → { review_id }
GET  /api/reviews/{review_id}        → status, stage, verdict (latest override wins), result (snapshots, floor, reasons, completeness, findings, impact, tests, assumptions, open questions), overrides[]
POST /api/reviews/{review_id}/override   { verdict, reason (≥ 10 chars) } → records a human override (user from session)
```

Not built:
- the SSE `/events` stream (the UI polls);
- `/file` (citations link to GitHub permalinks);
- `/api/me` (the layout load has the user).

Node ids contain `/` and `#`, so the plan's `/nodes/{id}` and `/impact/{id}` became the query parameters above.

### 6.3 Folder structure

As built (the file-by-file map is in `AGENTS.md` → **Layout**):

```
src/
  hooks.server.ts            Better Auth handler + login gate; marks interrupted jobs failed
  lib/
    claims.ts, model.ts, review.ts, scan.ts, github.ts   shapes shared by server and pages
    components/              ClaimBadge, ClaimList, AskAuthor, VerdictBanner, VerdictChip, Placeholder
    server/                  server-only (SvelteKit blocks client imports)
      auth.ts                betterAuth config
      db/                    drizzle client; auth, scan and review schemas
      jobs/                  in-process job queue; yield.ts (keeps the server responsive during scans)
      scan/                  stages 0–4 (acquire, cparse/structure, gitmine, signals, components), pipeline, store, read-side views, summary
      evidence/              claim validator, impact + counts
      llm/                   openai client, tiering, retry/fallback, input-hash cache (prompts inline, versioned ids)
      github.ts              REST wrapper (repos, branches, pulls, commit → login)
      review/                PR review engine, verdict rules, diff + change class, LLM rationale, jobs + overrides
      chat/                  chat agent + tools
  routes/
    login/                   "Sign in with GitHub"
    (app)/                   everything behind the gate
      +page.svelte           repo picker (own, any public, demo prefill) / recent scans
      scans/[id]/overview|chat|graph/
      reviews/               repo → PR list → review
    api/                     endpoints from §6.2
data/                        clones (gitignored)
docs/
```

Tests sit next to the code as `*.spec.ts`, and fixture git repos are created inside the tests.

## 7. Implementation priority (hackathon timeline)

It's Fri 25 Sep evening now. Pitch is Sat 17:00. Rule from the crash course: **if behind, cut scope, not validation.**

**Build priority: working first, polish second.**
- Every slot below aims at a working end-to-end flow on real data.
- Use plain, functional UI (plain Tailwind) until the demo flow works.
- Visual design polish comes after that, from the Sat 13–14 slot at the earliest. That's also when design skills (e.g. a "taste" frontend-design skill) come in.

| Slot | Priority | Deliverable | Status (Fri 23:45) |
|---|---|---|---|
| Fri night, first | **Gate: git-signal spike** | Screened 47 repos and spiked 13. **Demo target: ArduPilot `libraries/AP_InertialSensor`**, with RTEMS SPARC/LEON as the fallback. PX4 drivers had thin history. See `docs/spike-results.md`. | ✅ done |
| Fri night | **P0: Prompt 01a** | Repo scaffold. GitHub OAuth plus login gate. Snapshot identity. Scan stages 0–4 plus the reference index (no LLM). Edge resolution status. SQLite model. The spike results feed the signal heuristics. | ✅ built. There is no tree-sitter (own scanner) and no parse cache (snapshot reuse instead). |
| Sat 09–11 | **P1: Prompt 01b, then 02** | Stages 5–7: LLM summaries with the claim validator. **Tab 1 Onboarding.** **Tab 4 PR Reviewer** end-to-end on 2 prepared PRs (a comment-only PR → SAFE, and a workaround-removal PR → STOP). | ✅ Tab 1, Tab 4 and the validator are built. STOP is verified on upstream PR #21937 and SAFE on comment-only commits. ⬜ Stage 5 is only the on-demand overview (no UI), and stage 7 is not built. ⬜ The SAFE demo *PR* still needs opening. |
| Sat 11–13 | **P2: Prompt 03** | **Tab 3 Graph** (data already exists, mostly frontend). Ask-the-author component shared across tabs. | ✅ 2D graph (3D cut). AskAuthor is on findings, the register, claims and nodes. ⬜ The `/authorship` panel has no UI. |
| Sat 13–14 | **P3: Prompt 04** | **Tab 2 Chat** with tool calling (reuses model queries from Tabs 3 and 4). | ✅ built as a JSON tool protocol, not streamed. ⬜ Not tried against the live broker yet. |
| Sat 14:00 | Freeze | Feature freeze. Pre-run and cache the demo scan and reviews. Record a backup video. Pitch workshop. | ⬜ See the TODO list in `docs/status.md`. |

**Parallel workstreams** for a 3–5 person team, all working against the §6.2 API contract:

1. **Scan core:** stages 0–4, reference index, signals, git mining.
2. **LLM + evidence layer:** summaries, docs, claim validator, chat agent, prompts.
3. **PR reviewer:** GitHub API, snapshot pinning, diff→symbols, completeness, verdict engine.
4. **UI:** Svelte routes, tabs, graph, Ask-the-author. Functional first. Visual polish comes after the demo flow works end to end.

**Cut order if behind:**

1. chat tool-calling (fall back to single-shot retrieval);
2. 3D (2D only);
3. the symbol-level graph;
4. suggested tests (list the gaps only);
5. the whole-repo reference index (restrict to the subpath and show "external impact: unknown").

**Never cut:** the confidence labels, claim validation, citations, the completeness indicator, or the PR verdict demo.

## 8. Demo scenario (ties back to `docs/demo.md`)

1. Sign in with GitHub. Click "Fill in the demo: ArduPilot IMU drivers" and scan `libraries/AP_InertialSensor` with the whole-repo reference index. That takes ~20 s cold; a rescan is instant. Show the coverage note and the history stats.
2. Tab 1: the critical-parts register lists the Invensense FIFO path (`_read_fifo`, `_fifo_reset`, `_accumulate_sensor_rate_sampling`). Its cited evidence includes the revert `9fa3a433f5` that restored the temperature check.
   - External interfaces show the barometer driver `AP_Baro_ICM20789` including the Invensense register header.
3. Tab 3: click `_check_raw_temp` (or `_accumulate`). The blast radius lights up its dependents: `_accumulate` → `_read_fifo` → `_poll_data`. The node panel shows the signals, commits and the person to ask.
4. Tab 4: review **upstream PR #21937** ("disable temperature based fifo check on ICM20602") directly; no fork is needed. It gets **STOP** in ~6 s, citing the origin commit `d2f6a514b9` ("catch FIFO alignment errors…"), found through the line's history, and the "use temperatue to detect FIFO corruption" comment, plus an Ask-the-author button.
   - A comment-only PR gets **SAFE**, explained by the change-class rule. It still needs opening in a fork; see `docs/status.md`.
5. Tab 2: ask "why does the IMU driver compare temperatures before accepting FIFO data?" (or "why does the DPS310 driver toggle chip-select?"). The answer is Verified *for what the code does* (with the line cited). The *why* is Verified only if a commit or comment says it. Otherwise it's Inferred or Unknown, with the author to contact.
6. Cross-check live against the real GitHub PRs #21937 and #22034 to show we don't hallucinate.

## 9. Open decisions

- **Lovable vs SvelteKit.** Lovable generates React, so it can't produce our SvelteKit code directly. It's usable for mockups and design exploration only. Decide whether that's enough sponsor-tool usage for the pitch, or whether one standalone piece (e.g. a landing/pitch page) is built in Lovable.
- **Broker:** gonka-api.org, configured through `LLM_BASE_URL` / `LLM_API_KEY`. Its OpenAI-compatible endpoint is a Supabase functions URL, as listed on gonka-api.org/for-agents.
  - It hasn't been called from the app yet.
  - Still to decide: the models (the fast/strong defaults are MiniMax-M2.7 / DeepSeek-V4-Flash), and context window sizes need verifying.
- **Sending code to the broker.** Chat, review rationale and the system overview send code snippets and commit messages to it.
  - Fine for public repos. For SAAB code it would need an on-prem model; say so in the pitch.
  - Decide before enabling the system-overview button.
- ~~Final demo target~~: decided. It's ArduPilot `libraries/AP_InertialSensor`, with RTEMS as the fallback (`docs/spike-results.md`).
- ~~Clone size~~: decided. A blobless clone (`--filter=blob:none`) is 66 MB and takes ~6 s (a full clone is ~650 MB). History blobs are fetched in one batch per scan. Pre-scan before the demo anyway.
- ~~Deep scope size~~: decided. At most 500 C/C++ files, because a whole-repo ArduPilot deep scan would take the better part of an hour. The rest of the repo is indexed for references.
- Hosting for the demo: localhost is fine for the pitch. The GitHub OAuth callback URL has to match.
