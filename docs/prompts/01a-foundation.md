# Prompt 01a: Foundation (no LLM)

> **Status: done (Fri 25 Sep). Don't re-run this prompt.** How the build differs from it:
> - Stage 1 uses our own C/C++ scanner (`cparse.ts`) instead of `web-tree-sitter`.
> - There is no parse cache; whole-snapshot reuse replaces it.
> - There are no SSE `/events`; the UI polls.
> - There's no `/file` endpoint; citations link to GitHub permalinks.
> - The impact engine lives in `src/lib/server/evidence/impact.ts`.
>
> Details and the remaining TODOs are in `docs/status.md`.
>
> Copy everything below the line into a coding agent (Claude Code / Codex / etc.) running in this repo.
>
> It builds the deterministic foundation:
> - the git-signal spike;
> - the scaffold and GitHub login;
> - snapshot identity;
> - scan stages 0–4 plus the reference index;
> - the evidence-model plumbing;
> - the Ask-the-author endpoint;
> - navigable shells for all four tabs.
>
> **No LLM calls in this prompt.** Prompt `01b-llm-and-onboarding.md` builds on this. Later prompts: 02 PR Reviewer, 03 Graph, 04 Chat.

---

Read `AGENTS.md` and `docs/plan.md` fully before writing any code. `docs/plan.md` is the source of truth. These sections are binding: §3 (product rules, especially rules 1, 3 and 7), §4.2–§4.5 (pipeline, signals, data model, **evidence and uncertainty model**), and §6 (SvelteKit stack, Better Auth, API contract, folders).

**Priority: it works first, it looks good later.** Use plain default shadcn-svelte components. Don't spend time on visual design in this prompt.

## Step 0: Git-signal spike (already done, read the results)

The spike has already been run. Read `docs/spike-results.md` before building anything else:

- **Demo target:** `ArduPilot/ardupilot`, deep scope `libraries/AP_InertialSensor`. Use it as the default demo scope in the rest of this prompt. The fallback is RTEMS `bsps/sparc/leon3`.
- **STOP line:** the temperature-based FIFO check in `libraries/AP_InertialSensor/AP_InertialSensor_Invensense.cpp`. It was introduced by `d2f6a514b9`, disabled in upstream PR #21937, and reverted in `9fa3a433f5` / PR #22034.
- **Clone:** `git clone --filter=blob:none` (~66 MB, ~20 s). Don't run `git grep` or `git log -S` over the whole history of a blobless clone; they fetch blobs lazily and are very slow.
- **Git mining must follow renames.** Use `git log --follow` per file, not per directory. Blame already follows renames (e.g. `AP_InertialSensor_MPU6000.cpp` → `AP_InertialSensor_Invensense.cpp`).
- Seed the signal heuristics (stage 3) with the patterns seen in the spike:
  - ArduPilot timing calls: `hal.scheduler->delay`, `in_expected_delay`;
  - chip-select toggles: `set_chip_select`;
  - comment markers: "datasheet", "undocumented", "work around".

## Scope

1. **Scaffold**, using the folder structure in plan §6.3:
   - One SvelteKit 2 app (Svelte 5, TypeScript) at the repo root, using `@sveltejs/adapter-node`.
   - Tailwind, shadcn-svelte, and `vitest`.
   - All server logic goes under `src/lib/server/`. **No separate backend service** (plan §6).
   - Add `.env.example` with every variable from plan §6, `.gitignore` (include `data/` and `.env`), and run commands in the root `README.md`.
2. **Better Auth with GitHub, as the login gate** (plan §6.1):
   - `betterAuth` with a `better-sqlite3` database (`data/app.sqlite`) and `socialProviders.github` with scope `["read:user", "user:email", "repo"]`.
   - `sveltekitCookies(getRequestEvent)` as the last plugin. Run the Better Auth CLI migration.
   - `hooks.server.ts` runs `getSession` into `locals` and uses `svelteKitHandler`.
   - Gate every route except `/login` and `/api/auth/*`. Pages redirect to `/login`; API routes return 401.
   - `/login` has a single "Sign in with GitHub" button (`authClient.signIn.social`) and a note that `repo` scope grants write access, which the app never uses without a click.
   - The GitHub token is only read server-side via `auth.api.getAccessToken`. Check the parameters against the installed version.
3. **Repo picker**:
   - Lists the user's repos (`/api/github/repos`).
   - Also accepts a pasted public GitHub URL.
   - Optional `ref`, `subpath` (deep scope) and `reference_scope` (`repo` by default, or `subpath`).
4. **Snapshot identity** (plan §4.5.3): `snapshot_id = hash(repo, commit SHA, deep scope, reference scope, analysis config, parser version)`. Every stored record and every citation carries `snapshot_id`.
5. **Scan stages 0–4**, deterministic, following plan §4.2:
   - **Stage 0:** acquire with history, and resolve the ref to a commit SHA.
   - **Stage 1:**
     - Run tree-sitter (`web-tree-sitter` with C/C++ WASM grammars) over the deep scope: symbols, plus edges with `method`, `resolution` (`resolved | ambiguous | unresolved`), `candidates[]` and `evidence` (plan §4.4, §4.5.1).
     - Build the **reference index** over the reference scope (identifier/tag extraction only). Use it to find references from outside the deep scope. Store those as boundary nodes and edges with `method: reference_index`.
     - Record parse failures.
   - **Stage 2:** git mining.
     - Collect churn, bug-fix commits, reverts, `#123` refs, and the author identity map.
     - Store co-change as `co_changes` edges with `method: git_cochange`. These are **correlation only**, and impact traversal must never follow them.
   - **Stage 3:** embedded signals (plan §4.3) and a criticality score. Each score comes with an explanation of which signals contributed. Seed the heuristics with patterns observed in the spike.
   - **Stage 4:** componentization. Use directories only when the scope has fewer than ~30 files. Otherwise use directories plus Louvain on **resolved** edges (`graphology-communities-louvain`).
   - **Coverage stats** on `ScanRun`: files parsed and failed, and edges resolved / ambiguous / unresolved.
6. **Parse cache** keyed by `(file content hash, parser/grammar version)`.
7. **Scan progress:**
   - `POST /api/scans` enqueues a job in the in-process job queue (`src/lib/server/jobs/`, concurrency 1–2, progress event bus). If parsing blocks the event loop badly, move it into `worker_threads`.
   - `GET /api/scans/{id}` and SSE `/events` report stage, progress and coverage.
   - The frontend shows the live stage list.
8. **Impact and completeness engine** (`src/lib/server/evidence/`). It's shared by Tabs 3 and 4, so build it once here.
   - Transitive callers and callees over non-correlation edges, with a depth limit.
   - The result includes affected nodes, the resolution status along each path, and boundary / out-of-scope hits.
   - It also returns `completeness: complete | partial | insufficient`, with the reasons (plan §5 Tab 4, step 7).
   - Expose it as `GET /api/scans/{id}/impact/{node_id}`.
9. **Real data endpoints:**
   - `GET /api/scans/{id}/graph`
   - `GET /api/scans/{id}/nodes/{node_id}`
   - `GET /api/scans/{id}/file`
10. **Ask-the-author endpoint and component** (plan §3 rule 3):
    - `GET /api/scans/{id}/authorship?path=&line=` returns:
      - **last modified by**, from blame;
      - **introduced by**, best effort with `git log -L … --reverse` and a `-S` fallback. It returns `unknown` with a reason when the history is too tangled.
    - Each person has name, email, GitHub login (via `GET /repos/{o}/{r}/commits/{sha}`), date, and message.
    - Build the shared Svelte component `AskAuthor.svelte`:
      - a `mailto:` with a pre-filled subject and body;
      - a GitHub profile link;
      - "copy question";
      - caveats for `noreply` emails and last activity;
      - it never sends anything automatically.
11. **Shells for all four tabs:**
    - Routes and empty states.
    - Every remaining §6.1 endpoint exists and returns `501`, or mock data that matches the final shape.
    - Tab 1 can already show the deterministic parts:
      - signals list;
      - critical-parts ranking with explanations;
      - scope and coverage note.

## Out of scope

Out of scope here: any LLM call (that's 01b), graph rendering (03), the PR review engine (02), and chat (04).

## Quality bar

- Write vitest tests for:
  - **Signal detection** on small C/C++ fixtures: ISR, `volatile` MMIO, delay/timeout, errata comment, retry loop.
  - **Edge resolution:**
    - a unique direct call is `resolved`;
    - an overloaded or same-named method is `ambiguous` with its candidates;
    - a function-pointer call is `unresolved`.
  - **Git mining** on a tiny fixture repo created in the test: bug-fix detection, blame, introduced-by, and introduced-by → `unknown` after a file move plus rewrite.
  - **Completeness:**
    - an impact query that reaches an unresolved edge or an out-of-scope reference must not return `complete`;
    - `co_changes` edges are never traversed.
  - **Snapshot ID:** changing the scope or config changes the ID.
- Scan the demo subpath end to end and report:
  - wall-clock time;
  - LOC in the deep scope;
  - files in the reference scope;
  - signals by kind;
  - edge resolution stats;
  - the top 10 critical symbols with their explanations.
- No secrets in git.
- When you're done, update `AGENTS.md` (stack, run/build/test commands, folder structure) and tick off what was built in `docs/plan.md` §7.
