# Conversation log: product planning session (Fri 25 Sep 2026, evening)

> A handoff for teammates. It summarizes a planning session between Dominik and Claude Code. The session only updated documentation; **no code was written**. It covers what was decided, why, what changed in the repo, and what comes next.
>
> **Source of truth is still `docs/plan.md` (v2.2).** This file explains how we got there.

---

## 1. Starting point

Before this session the repo held only docs:

- `AGENTS.md` (with `CLAUDE.md` and `GEMINI.md` as symlinks to it): the challenge brief, event logistics, the design-thinking process, and tools/credits.
- `docs/plan.md` v1.0: a generic "system understanding foundation plus differentiating features" plan with no concrete product shape.
- `docs/ideas.md`: two ideas. The **Chesterton's Fence Checker** (point at a line and get a safe/risky/dangerous/stop verdict) and the **PR Gate** (the same engine as a CI plugin).
- `docs/demo.md`: pitch flow and demo prep checklist.
- `docs/repos.md`: demo targets (PX4 driver subdir primary, NASA cFS fallback).
- `docs/prior-research.md`: a survey of prior art.

## 2. Input: notes from our talks with the SAAB mentor

Three sets of notes were pasted in. Combined:

**What they want**

- A tool that answers: *"If I change this, what else changes, and what critical parts do I need to think about?"*
  - **Software change:** which critical parts are affected, and which timing must be preserved?
  - **Hardware change:** what's the impact on the software?
- Today the mentor does this **manually**, by digging through the codebase.

**Focus**

- A good description of the system and its architecture: what's critical, how everything is connected, and how that relates to a proposed change.
- Make sure a critical component or interface isn't broken by a change, **via test coverage / a test suite**.
- Start by describing the system and what's critical to a change, then build a test suite on top.
- Understanding the system architecture comes first.
- Some timing in the system may be really critical.

**Attitude**

- **Speed is more important than being 100% correct.** They did it all by hand, so they'd appreciate even a chatbot. Better fast than perfect.
- In embedded software there are very specific things that **aren't documented anywhere and can't be known**. Assume that.

**Assumptions we're allowed to make**

- We pick one GitHub project.
- Git is assumed, with a history of updates. Not every codebase uses git in reality, but we assume it does.
- Some things are undocumented.

## 3. What Dominik asked for

1. A web app with **4 tabs/features**:
   1. **Codebase explorer / onboarding.** It explores the whole codebase, creates onboarding documents and an architecture overview. It must be **token-efficient**: don't send the whole codebase to an LLM, and one scan should ideally be enough. Consider existing research.
   2. **Chatbot**, like DeepWiki. It's built on the backend from feature 1 and has context of the whole codebase. It answers specific questions, possibly using RAG.
   3. **Graph view**, similar to CodeBoarding (https://github.com/CodeBoarding/CodeBoarding). It shows all the components and how they depend on each other. Clicking a node highlights its dependencies and shows more information. A "3D graph."
   4. **PR reviewer.** Connect a GitHub account, see all repos, select one, pick a PR, and rank it as safe to merge or dangerous. Does it break unwritten assumptions or timing dependencies? It returns a verdict (**safe / risky / dangerous / stop**) with cited evidence:
      - everything that depends on the changed code or calls it (deep reference exploration);
      - git history: blame, who wrote it, and why.

      This directly answers SAAB's *"redundant-looking line may guard a 15-yr-old HW anomaly."*
2. **Additional requirements:**
   - Codebases are legacy and poorly documented, so the LLM has to infer a lot. It must **not hallucinate**. If it doesn't know, it says so.
   - All codebases use git.
   - Wherever specific lines of code are shown (chat, graph, PR checker), add a **button to contact the person who wrote that line**, according to git history (email address and GitHub account).
   - On first launch, the user must **log in with GitHub**, which gives full access to the app.
3. **Only update docs** (plan.md, AGENTS.md, other docs). **No code yet.**

## 4. Research done during the session

It was checked in order to design a token-efficient scan. Details are in `docs/prior-research.md` §6.

- **CodeBoarding** (MIT): uses LSP static analysis, then an LLM groups code into components, producing nested diagrams and incremental re-analysis. **Its README lists no C/C++ support**, so we can't run it on PX4 directly. We copy the pattern.
- **DeepWiki-Open** (MIT): a repo-to-wiki generator with an "Ask" chat, supporting OpenAI-compatible providers. The reference UX for Tabs 1 and 2.
- **Aider repo map:** tree-sitter plus PageRank over the dependency graph, producing a signatures-only skeleton that fits a token budget. This is the core idea behind "skeletons, not bodies."
- **RepoGraph** (ICLR 2025, arXiv 2410.14684): a line-level code graph with ego-graph retrieval. The basis for blast radius and the caller/callee tools.
- **cAST** (EMNLP 2025 Findings, arXiv 2506.15655): AST-based chunking for code RAG, which beats line-based chunking. Used for our search-index chunks.
- **RAPTOR** (arXiv 2401.18059): hierarchical bottom-up summarization. Used for file → component → system summaries.
- **GraphRAG** (arXiv 2404.16130): community detection plus community summaries. Same idea as our Louvain components.
- **Tree-sitter limits:** it parses syntax only. It can't resolve C++ overloads, virtual dispatch, function pointers, macros or `#ifdef` variants.
- **Gonka brokers offer chat models only, no embedding models.** So search uses SQLite FTS5 (BM25) plus the symbol graph plus LLM summaries. Local embeddings are optional.

## 5. Product design (plan v2.0)

The full detail is in `docs/plan.md`. Key points:

### 5.1 Core architecture: scan once, reuse everywhere

- One **scan pipeline** per repo snapshot builds a **system model** in SQLite: symbols, edges, components, signals, commits, blame, authors, summaries, claims, and a search index.
- All four tabs query that model and **never re-read the whole codebase**.

### 5.2 Scan pipeline stages

| # | Stage | LLM? |
|---|---|---|
| 0 | Acquire: clone with history, with a deep scope and a reference scope | no |
| 1 | Static analysis with tree-sitter: symbols and edges | no |
| 2 | Git mining: churn, bug-fix commits, reverts, blame, co-change, `#123` refs, author → GitHub login | no |
| 3 | Embedded signals and criticality score, with an explanation | no |
| 4 | Componentization: directories, plus Louvain for larger scopes | no |
| 5 | LLM summaries, bottom-up (file → component → system) | yes |
| 6 | Docs generation (onboarding pack) | yes |
| 7 | Search index (SQLite FTS5) | no |

### 5.3 Embedded signals (what makes this more than DeepWiki)

- **Interrupts and concurrency:** ISRs, interrupt enable/disable, critical sections, atomics, barriers.
- **Hardware access:** `volatile`, MMIO casts, register macros, bus I/O (I2C / SPI / UART / CAN).
- **Timing:** delays and sleeps, timeouts, watchdog, scheduling, rate and conversion constants.
- **Workaround markers in comments:** errata, silicon, rev, workaround, hack, quirk, datasheet, "do not", "don't remove", XXX, FIXME.
- **Defensive or redundant-looking code:** retries, double reads, CRC and sanity checks, magic numbers.
- **External interfaces:** public headers, extern APIs, uORB and MAVLink topics, params, protocol constants.
- **Platform variants:** `#ifdef` branches.
- **Git risk signals:** introduced by a bug-fix or revert commit, high bug-fix density, old and untouched, single author, co-change.

### 5.4 Product rules (non-negotiable)

1. **Honesty labels on every claim:**
   - **Verified**: the cited evidence directly states it.
   - **Inferred**: has a confidence level and evidence.
   - **Unknown**: says what's missing and who to ask.
2. **Everything cites:** `file:line` and commit SHAs are clickable and pinned to a snapshot.
3. **Ask-the-author button** on every code line shown:
   - "last modified by" (blame);
   - "introduced by" (best effort, with an Unknown fallback);
   - name, email, GitHub login, `mailto:`, profile link, "copy question";
   - **never sends anything automatically**.
4. **GitHub login gates the whole app.**
5. **Git is assumed.**
6. **Speed over perfection, but never fabricate.**
7. **Missing evidence never implies safety** (added in v2.1).

### 5.5 The four tabs

- **Tab 1, Overview & Onboarding:**
  - repo picker (the user's repos or a pasted public URL, optional subpath);
  - live scan progress and a token counter;
  - onboarding pack: system overview with a Mermaid diagram, components, critical-parts register, external interfaces, timing and HW assumptions, open questions / unknowns, scope and coverage note, reading order;
  - Markdown export.
- **Tab 2, Chat (DeepWiki-style):**
  - agentic tool-calling over the system model (search, symbol, file, callers/callees, signals, git history, blame, co-change);
  - "Can I change this?" mode (the Chesterton's Fence idea);
  - handles hardware-change questions.
- **Tab 3, Graph (CodeBoarding-style):**
  - 3D force graph with a 2D toggle, drilling down component → file → symbol;
  - size shows centrality, colour shows criticality, badges show signal type;
  - clicking highlights transitive dependencies, with a side panel;
  - blast-radius overlay.
- **Tab 4, PR Reviewer:**
  - GitHub repo → PR list → review;
  - verdict **SAFE / RISKY / DANGEROUS / STOP** with blast radius, git history of touched lines, signals hit, test impact, suggested tests, "unwritten assumptions this PR may break", and open questions;
  - stretch: a "post as PR comment" button, click only.

**Pitch next step:** the same engine as a GitHub Action / CI gate.

### 5.6 Doc updates in v2.0

- `docs/ideas.md`: marked as folded into the plan. The Fence Checker became the Tab 2 mode; the PR Gate became Tab 4, with CI as the next step.
- `docs/demo.md`: the solution is now the 4-tab app with the PR reviewer as the climax. Prep two real PRs in our fork (STOP vs SAFE).
- `README.md`: product description.
- `docs/prior-research.md`: added §6 on token-efficient codebase understanding.

## 6. External review (ChatGPT) and our response (plan v2.1)

Dominik had ChatGPT review v2.0. Its verdict: the architecture is sound, but the spec **promises more certainty than the analysis can provide**. Claude agreed with nearly all points. They were folded in as **plan §4.5, the evidence and uncertainty model**.

| # | ChatGPT's point | What we changed |
|---|---|---|
| 1 | Tree-sitter can't give a reliable C++ call graph (overloads, virtual dispatch, function pointers, macros, `#ifdef`) | Every edge has a `method` (`ast_direct / name_match / include_path / reference_index / git_cochange`), a `resolution` (`resolved / ambiguous / unresolved`), `candidates[]` and `evidence`. The graph draws ambiguous edges dashed and unresolved ones as stubs. **Co-change is correlation only and is never traversed as a dependency.** clangd is the later upgrade. |
| 2 | Scanning one subdirectory can't establish the full blast radius | **Two-layer scope:** the *deep scope* (driver, full analysis) and the *reference scope* (whole repo, a cheap no-LLM identifier index). Anything unseen is reported as "impact outside analysed scope: unknown." Boundary nodes appear in the graph. |
| 3 | A cache key of blob SHA + prompt + model is insufficient (summaries also depend on history, signals and deps; parents have no blob) | Parse cache keyed by `(content hash, parser version)`. LLM cache keyed by `hash(full normalized input + prompt id/version + model + params)`, so parents invalidate automatically. **Snapshot ID** = hash(repo, commit, deep scope, reference scope, config, parser version). |
| 4 | Having a citation doesn't make a claim Verified | **Claim validator:** citations must resolve in the snapshot **and** be in the evidence packet the LLM got; quoted code must match. Verified needs a `basis` of `code_fact`, `commit_statement` or `comment_statement`. Rationale is Inferred unless a comment or commit states it ("the code waits 10 ms" can be Verified; "the HW needs 10 ms" can't unless stated). Parents can't be more certain than their children. |
| 5 | PR review needs explicit before/after snapshots (GitHub diffs against the merge base) | Pin the **merge base, base tip and head** SHAs. Removed lines map against the merge base, added lines against head. Changed head files get parsed. Every citation records its snapshot. |
| 6 | SAFE and test claims exceed the evidence; the LLM shouldn't lower the rule floor | "Related tests found" instead of "covered"; executed coverage is out of MVP scope. Added **analysis completeness** (`complete / partial / insufficient`) with reasons. **Only a human override** (with a written reason, stored and shown) can lower the rule floor. The LLM can only raise it. |
| small | "Introduced by" is fragile | Best effort with an Unknown fallback ("history too tangled"). |
| small | The timeline is ambitious | Prompt 01 split into **01a** (no LLM) and **01b** (LLM + Tab 1). The **git-signal spike became a gate** that runs first. |

**Where Claude pushed back on ChatGPT (point 6).** If incomplete analysis can never give SAFE, then every subdirectory scan (always incomplete) makes SAFE unreachable, and the demo loses its SAFE-vs-STOP contrast.

The resolution is a **change-class exception**: a diff that only touches comments, whitespace or log strings (checked at the AST level) is behaviour-free and can be SAFE regardless of completeness. Anything else with partial knowledge of callers is at least RISKY.

**Two issues Claude added that ChatGPT missed:**

- Louvain clustering on a ~10-file driver is pointless, so directories are used under ~30 files.
- The "skeleton ≈ 10–20% of raw tokens" figure is an unmeasured estimate. It's labelled as such, and 01b must measure it.

**The rule-floor table in v2.1:**

| Condition | Minimum verdict |
|---|---|
| Removing or changing a line introduced by a bug-fix/workaround/errata commit | DANGEROUS |
| Changing an ISR, timing constant, HW register access or external interface | DANGEROUS |
| Removing an explicit workaround or errata fix | STOP |
| Changing a symbol whose callers are only partly known | RISKY |

## 7. Stack decision (plan v2.2)

Dominik decided: **build with SvelteKit, and use Better Auth for GitHub authentication.** This replaced the earlier proposal (a React/Vite frontend plus a Python FastAPI backend).

### 7.1 Is anything besides SvelteKit needed? No.

**It's one SvelteKit app, one Node process, with no separate backend.** SvelteKit server code (`+server.ts`, `+page.server.ts`, `hooks.server.ts`) runs in a normal long-lived Node process that can do everything. Every library has a JS/TS equivalent, so a Python service would only add a second runtime, a second deploy, and an internal API to keep in sync.

Conditions for this to hold:

- Use **`@sveltejs/adapter-node`**, **not serverless** (Vercel/Netlify/Cloudflare). Scans run for minutes and need a `git` binary and a persistent disk.
- Background jobs use an **in-process job queue** (concurrency 1–2, progress event bus, SSE). No Redis is needed.
- If parsing blocks the event loop, move it to `worker_threads`. That's still the same app.
- A separate worker service would only be needed for hosted multi-user scale or clangd-based C++ resolution. Neither applies at the hackathon.

What it depends on outside the app code (none of these are services we build):

- **On the machine:** Node.js and the `git` CLI.
- **Embedded:** SQLite is a library inside the app, as files under `data/`, not a DB server.
- **External services:** a GitHub OAuth App plus the GitHub API, and a Gonka LLM broker (OpenAI-compatible API).
- **Setup:** install Node and git, create a GitHub OAuth App, get a broker API key, fill in `.env`, and run one app.

### 7.2 Full stack

| Area | Choice |
|---|---|
| Framework | SvelteKit 2, Svelte 5, TypeScript, `@sveltejs/adapter-node` |
| Auth | **Better Auth**, GitHub social provider, scopes `read:user`, `user:email`, `repo` |
| UI | Tailwind + shadcn-svelte (plain defaults until the demo flow works) |
| Graph | `3d-force-graph` / `force-graph` (3D with a 2D toggle) |
| Diagrams / code | Mermaid; Shiki code viewer with line highlighting; a Markdown renderer |
| C/C++ parsing | `web-tree-sitter` with WASM grammars (avoids native build issues) |
| Graph algorithms | `graphology`, `graphology-metrics` (PageRank), `graphology-communities-louvain` |
| Git | `git` CLI via `child_process.execFile` (no shell, no interpolated args) |
| GitHub API | `octokit`, with the user's token from Better Auth, server-side only |
| LLM | `openai` npm SDK → Gonka broker. `MiniMax-M2.7` for volume; `DeepSeek-V4-Flash-0731` / `GLM-5.3-Flash` for synthesis, chat and verdicts. On a 429, retry then fall back. |
| Storage | `better-sqlite3` with FTS5. `data/app.sqlite` holds auth tables and the job registry; one SQLite file per snapshot holds the system model; the LLM cache is a table keyed by input hash. |
| Jobs | in-process queue, SSE progress |
| Tests | `vitest` |
| Env | `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL_FAST`, `LLM_MODEL_STRONG` |

**Deliberately left out:**

- a Python backend;
- Redis or any queue service;
- a vector DB or hosted embeddings (Gonka has none, so search is BM25 plus the graph);
- clangd (a later upgrade).

### 7.3 Better Auth specifics (checked against the Better Auth docs)

- **Server setup:**
  - `src/lib/server/auth.ts` calls `betterAuth({ database: <better-sqlite3>, socialProviders: { github: { clientId, clientSecret, scope: [...] } }, plugins: [sveltekitCookies(getRequestEvent)] })`.
  - `sveltekitCookies` must be the **last plugin**, and needs SvelteKit ≥ 2.20.
  - Create the tables with the Better Auth CLI migration.
- **Scopes:**
  - `user:email` is **required** by Better Auth for GitHub, or you get an `email_not_found` error.
  - `repo` is needed for private repos and PRs, but it also grants write access. The login screen says so, and the app never writes without a click. `public_repo` is enough for public-only demos.
- **Callback URL:** `<BETTER_AUTH_URL>/api/auth/callback/github`. Register it in the GitHub OAuth App.
- **Request handling in `hooks.server.ts`:**
  - `auth.api.getSession({ headers })` puts the session and user into `event.locals`.
  - `svelteKitHandler({ event, resolve, auth, building })` serves `/api/auth/*`.
  - **Login gate:** pages without a session redirect to `/login`; API routes return 401.
- **Client:** `createAuthClient()` from `better-auth/svelte`. The login button calls `authClient.signIn.social({ provider: "github" })`.
- **GitHub token:** read it server-side via `auth.api.getAccessToken(...)`. Check the exact params against the installed version. GitHub OAuth tokens don't expire or refresh.

### 7.4 Folder structure

```
src/
  hooks.server.ts            Better Auth handler + login gate
  lib/
    auth-client.ts
    components/              ClaimBadge, Citation, CodeViewer, AskAuthor, Graph, VerdictBanner, …
    server/
      auth.ts  db/  jobs/  scan/  evidence/  llm/  github/  agents/
  routes/
    login/
    (app)/  +page.svelte (repo picker), scans/[id]/overview|chat|graph/, reviews/
    api/                     endpoints (plan §6.2)
tests/                       vitest
data/                        clones, sqlite, caches (gitignored)
```

### 7.5 Open issue: Lovable

Lovable (the headline sponsor, flagged "use as primary tool" in AGENTS.md) **generates React, not Svelte**. So it can only be used for mockups and design exploration.

To decide: is that enough sponsor usage for the pitch? One option is to build a standalone piece, such as a landing or pitch page, in Lovable.

## 8. Priority rule (added to AGENTS.md)

**Priority 1: the product works. Priority 2: it looks good.**

- Build working end-to-end flows on real data first, with plain default shadcn-svelte components.
- Hold off on visual polish until the demo flow works: scan → Onboarding → Graph → PR verdict → Chat.
- Design polish comes later, with frontend design skills (e.g. the "taste" skill), from the Sat 13–14 slot at the earliest.

## 9. How the scan stays token-efficient (the explanation given)

**The code does the fact-finding; the LLM only writes the explanations.**

1. **Stages 0–4 use no LLM and produce most of the knowledge base.**
   - Parsing gives the symbols, the edges with their resolution status, and the reference index across the whole repo.
   - Git mining gives bug-fix/workaround lines, authors and co-change.
   - Pattern matching gives the embedded signals and the criticality scores with explanations.
   - Ranking gives PageRank and components.

   This alone powers the critical-parts ranking, the graph, blame and Ask-the-author.
2. **Stages 5–6 use the LLM sparingly.**
   - **Skeletons instead of code:** signatures, comments, constants, signals and a short git summary. Full bodies go in only for the top-N critical symbols.
   - **Bottom-up hierarchy:** each level only sees the summaries from the level below.
   - **Model tiering:** the cheap model for file summaries, the strong model for synthesis.
   - **Short structured JSON output** that the validator checks.
3. **Rough estimate for a driver of about 10 files** (unmeasured; 01b must measure it):

   | Step | Estimate |
   |---|---|
   | File summaries | ~20k |
   | Top-N bodies | ~5k |
   | Components and system | ~10k |
   | Docs | ~30k |
   | **Total** | **~60–80k tokens** |

   The whole-repo reference index costs **0 LLM tokens**.
4. **Why "one scan is enough":**
   - The input-hash cache makes re-scans nearly free, and a new commit only pays for what changed.
   - The long tail that didn't make the summary budget is still fully indexed. Chat and the PR reviewer fetch it with tool calls only when a question needs it.
5. **Honest caveat:**
   - A single driver would fit in a context window raw. The approach matters for SAAB-sized systems, where dumping everything means millions of tokens, and for grounding, since we know exactly what the LLM saw and can check its citations.
   - The real risk is the quality of the no-LLM stages. That's why the git-signal spike runs first.

## 10. Timeline (plan §7)

It's Friday evening. The pitch is Sat 17:00. Rule: **if behind, cut scope, not validation.**

| Slot | What |
|---|---|
| **Fri night, first** | **Git-signal spike (gate).** Check candidate PX4 drivers for HW-rationale in commit messages. Pick the demo target and the STOP-PR line. Fall back to cFS if thin. |
| Fri night | **Prompt 01a:** scaffold, Better Auth login gate, snapshots, stages 0–4, reference index, edge resolution, impact/completeness engine. No LLM. |
| Sat 09–11 | **Prompt 01b** (LLM, validator, stages 5–7, Tab 1), then **02** (PR Reviewer on 2 prepared PRs: comment-only → SAFE, workaround removal → STOP). |
| Sat 11–13 | **Prompt 03:** Graph tab, and the shared Ask-the-author component. |
| Sat 13–14 | **Prompt 04:** Chat. The earliest point for design polish. |
| Sat 14:00 | **Feature freeze.** Pre-run and cache the demo, record a backup video, pitch workshop. |

**Parallel workstreams** (all against the plan §6.2 API contract):

1. Scan core
2. LLM + evidence layer
3. PR reviewer
4. UI

**Cut order if behind:**

1. chat tool-calling → single-shot retrieval;
2. 3D → 2D only;
3. the symbol-level graph;
4. suggested tests → list gaps only;
5. the whole-repo reference index → subpath only, reported as "external impact: unknown".

**Never cut:** confidence labels, claim validation, citations, the completeness indicator, the PR verdict demo.

## 11. Demo scenario (plan §8)

1. Sign in with GitHub. Scan the PX4 barometer driver (with the whole-repo reference index). Show the token counter and the coverage note.
2. **Tab 1:** the critical-parts register surfaces a workaround line tied to an errata/bug-fix commit.
3. **Tab 3:** click that function. Its dependents light up (including boundary nodes outside the driver), along with the timing signals.
4. **Tab 4:**
   - a PR in our fork that "cleans up" that line gets **STOP**, with the original commit cited and Ask-the-author;
   - a comment-only PR gets **SAFE**, explained by the change-class rule.
5. **Tab 2:** ask "why does this driver wait X ms after reset?". What the code does is Verified. The *why* is Verified only if a commit or comment says so; otherwise it's Inferred or Unknown, with the author to contact.
6. Cross-check against PX4's public Silicon Errata page to show we don't hallucinate.

## 12. Files changed in this session (all uncommitted at the time of writing)

| File | Change |
|---|---|
| `docs/plan.md` | Rewritten: v2.0 → v2.1 (evidence model) → v2.2 (SvelteKit + Better Auth, priority rule) |
| `docs/prompts/01a-foundation.md` | **New.** Git-signal spike (writes `docs/spike-results.md`), scaffold, Better Auth gate, snapshots, stages 0–4, reference index, impact/completeness, Ask-the-author endpoint, tab shells, vitest tests |
| `docs/prompts/01b-llm-and-onboarding.md` | **New.** LLM client, input-hash cache, evidence packets, claim schema and validator, stages 5–7, Tab 1 UI, tests, and measuring the skeleton ratio |
| `docs/prompts/01-base-product.md` | Created, then **deleted** (replaced by 01a/01b) |
| `AGENTS.md` | Repo layout, product summary, rules for agents (priority rule, honesty, missing evidence ≠ safe, snapshots, Ask-the-author, token efficiency), decided stack, Lovable note |
| `docs/prior-research.md` | Added §6, token-efficient codebase understanding, plus the tree-sitter limits |
| `docs/ideas.md` | Status note: folded into plan (Tab 2 mode and Tab 4) |
| `docs/demo.md` | 4-tab solution, CI gate as the next step, two real PRs in our fork (the SAFE one must be comment/whitespace/log-string only) |
| `README.md` | Product description and links |
| `docs/conversations/2026-09-25-product-planning.md` | This file |

## 13. Open decisions and next actions for the team

**Open decisions** (plan §9):

- **Lovable vs SvelteKit:** mockups only, or build a standalone piece (e.g. a pitch page) in Lovable?
- **Which Gonka broker and models.** Verify the context windows; prompts are designed for ≤ ~24k tokens.
- **Final demo target:** decided by the git-signal spike (a PX4 driver or cFS).
- **Full PX4 clone (~584 MB) on venue wifi:** use a blobless or partial clone, or pre-clone before the demo.
- **Hosting:** localhost is fine for the pitch. The OAuth callback URL has to match.

**Next actions:**

1. Commit these doc changes. This hasn't been done yet.
2. Create a GitHub OAuth App (callback `http://localhost:5173/api/auth/callback/github`, or whatever port we run on). Get a Gonka broker key from the help desk.
3. Run **Prompt 01a**, starting with the git-signal spike. Review `docs/spike-results.md` as a team before continuing.
4. Then run 01b. Prompts 02 (PR Reviewer), 03 (Graph) and 04 (Chat) **still need to be written**. Follow the 01a/01b style and plan §5.
