# Gothenburg Tech Week x Chalmers Hackathon 2026 — SAAB Track

Event page: https://builderbase.com/track-dashboard/saab-how-might-we-use-ai-to-understand-legacy-embedded-systems/event-site

## Repo layout

- `docs/event/` — event PDFs (brief, schedule, crash course, credits) + research notes. Source of truth, read direct if detail need.
- `docs/plan.md` — agreed product direction, core system-understanding foundation, differentiating workflows, and implementation priority. Treat as the source of truth for current product scope.
- `docs/status.md` — what's built, measured numbers, how the build differs from the plan, known limitations, and the TODO list. Read it before starting work.
- `docs/demo.md` — pitch flow and demo prep checklist. `docs/spike-results.md` / `docs/repos.md` — demo target evidence.
- `docs/prior-research.md` — survey of existing AI/LLM work on legacy code & embedded/firmware understanding, done pre-hackathon. Check before re-inventing.
- Product name: **undefined** (repo, package, `APP_NAME`). Remote: `https://github.com/d1minik/undefined.git`. All code/build work happen here.

## Challenge (SAAB)

**Title:** How might we use AI to understand legacy embedded systems?

**Context:** Industrial systems run for decades. Original devs gone, docs stale, tools disappear, architecture reasoning lost. Software still need maintain — new defect fix, discontinued component swap, new interface/cybersec/hardware requirement.

**Real problem:** Not "AI rewrite old code." It's — how AI help new eng team reconstruct system's intent, dependencies, risk *before* touch code.

**Source code hide:**
- Why architecture built this way
- Which behavior intentional vs accidental
- What depend on obsolete HW/timing assumption
- Why weird workaround exist
- Which interface external systems use
- What must stay same for certification/compat
- Which functions safety/mission/business critical
- What past failures taught original devs

Warn: redundant-looking line may guard 15-yr-old HW anomaly. Remove = cleaner code, less reliable system.

**Scope:** In — system design, SW engineer angle. Out — none flagged (no legal/tech/strategic constraint given).

**Success = going from black box (SW/FW/HW) → system interface description w/ dependencies + highlight critical parts/behaviors in SW/FW, given input about digital platform.**

**Deliverable:** Concept or prototype. No format mandate.

**Data/materials:** None provided — must use open source. Expert (Lars-Erik Lindberg, Innovation Leader) available on-site for Q&A.

**Upside:** Internship opportunity post-event for strong team.

## Event logistics

- **Dates:** 25–26 Sep 2026. **Venue:** FUSE, Chalmers, Gothenburg.
- **Tracks:** NVIDIA, Saab, SKF, Ambidex, Open Track. Teams 3–5 ppl, fixed track assignment.
- **Builderbase** = Resources + Help Desk portal. Confirm team/track there, check tools/data/credits before Friday.

**Fri 25 Sep**
- 16:30 check-in (seated by 17:15)
- 17:15–17:30 welcome
- 17:30–~19:05 case presentations
- After stage: food, team formation, hacking start
- Case-provider Q&A after stage, venue open till ≥21:00

**Sat 26 Sep**
- 09:00 breakfast/hacking
- 12:00–13:00 rolling lunch
- 14:00 pitch workshop
- 16:00–17:00 final pitch prep (in pitch room by 17:00)
- 17:00–17:50 track pitches (5 min/team, parallel)
- 17:50–18:10 jury deliberation
- 18:10 track winners announced
- 18:15–18:40 winner pitches (all-hands)
- 18:40–18:50 closing
- 18:50–19:00 certs/photos
- 19:00 event ends

**Judging areas:** relevance/problem understanding, innovation, feasibility, user value/impact, technical quality/prototype, scalability/next steps, presentation clarity.

**Post-event:** Strongest solutions present at Tech Blueprint, 13 Oct 2026, World of Volvo.

**Contact:** Isabella Robertsson (Project Leader) — isabella@gbgtechweek.com, +46 72 309 00 65.

## Design-thinking process (Challenge → Pitch crash course)

4 moves, 9 steps, timebox each. Rule: if behind, cut scope not validation.

1. **Discover** — Understand → Empathize → Define. Checkpoint: explain problem w/o naming tech; from customer POV; team aligned on same challenge.
2. **Choose** — Create (multiple concepts) → De-risk (list desirability/feasibility/viability assumptions, pick weakest).
3. **Prove** — Build (lightest prototype, must-demonstrate only) → Test (real scenario, observe, capture confusion/evidence/change).
4. **Make it real** — Make it real (who owns/funds/uses after) → Pitch (problem, evidence, solution, proof, next step).

**Judge-ready check (60s, no slides):** what problem matters / what evidence / what built / what learned / what's next.

Apply to this challenge: don't jump straight to "build an AI code analyzer." Start with concrete SAAB-style scenario (a maintainer facing an unfamiliar embedded codebase), pick one narrow proof (e.g. dependency/critical-path extraction on a real open-source legacy embedded repo), and be ready to show evidence it actually helped someone reconstruct intent — not just that it summarizes code.

## Tools & credits

**Lovable** (headline sponsor, use as primary tool):
- Pro Plan 1 (100 credits) free via code `COMM-GOTH-T6VY` at lovable.dev → Settings → Plans & Credits. Redeem before event ends, don't share code outside event. May ask card, 1 month to cancel free.

**Gonka compute** (use alongside Lovable, not instead — e.g. backend/agent logic):
- Models: `MiniMaxAI/MiniMax-M2.7` (weak, high volume ok), `deepseek-ai/DeepSeek-V4-Flash-0731` (strong, coding/agents), `zai-org/GLM-5.3-Flash` (strong, coding/agents).
- Error 429 = network temp out of capacity, retry or switch model.
- Connect = base URL + model ID + API key (broker-specific).

Brokers (per-team codes at organizer help desk unless noted):
| Broker | Site | Tokens/credit | Note |
|---|---|---|---|
| Dahl | inference.dahl.global | 100M tokens | API key, no registration, ask help desk |
| Proxy (Gonka.gg) | proxy.gonka.gg | 150M tokens | register, promo code from help desk |
| Gonka-api | gonka-api.org | 150M tokens | shared code `HACKATHON26`, first 200 regs |
| JoinGonka | gate.joingonka.ai | ~50M tokens | referral code from help desk |
| Hyperfusion | console.hyperfusion.io | $50 credit | shared code `GOTHENBURGTECH`, up to 300 users, pricier models |
| Gonka24 | gonka24.com | $10 free | no code, just register |
| Gonkarouter | gonkarouter.io | $20 free | no code, docs at gonkarouter.io/docs |

Credits/tokens NOT transferable between brokers.

## Working notes

- Full docs live in `docs/` as PDF — re-read direct if this summary insufficient (e.g. exact judging weight, fine print).
- Stack decided (plan §6) — see **App** below. Keep this section current as structure grows.
- Build status, measured numbers and the TODO list: `docs/status.md`. Update it when you finish something.
- **Never commit (or push) unless explicitly asked to.** Leave changes in the working tree; suggesting a commit message is fine.

## App

**Stack:** SvelteKit 2 + Svelte 5 + TS, `adapter-node`, Tailwind v4 (typography), Better Auth (GitHub only), Drizzle ORM on `better-sqlite3`, Vitest (unit + browser component), Playwright (e2e), ESLint + Prettier. Scaffolded with `sv@0.17.1`.
Analysis: own syntax-level C/C++ scanner (`cparse.ts`, no tree-sitter), `graphology` + `graphology-communities-louvain` (components), `git` CLI via `execFile`. LLM: `openai` SDK against an OpenAI-compatible Gonka broker.
UI: shadcn-svelte, style **Mira**, preset `b5deNMQ2S` (stone, no accent colour, IBM Plex Sans/Mono, Lucide) in `src/lib/components/ui` (we own the code; add more with `npx shadcn-svelte@latest add <name>`), `mode-watcher` (light/dark/system), `3d-force-graph` + `three` + `three-spritetext` (3D graph), `svelte-sonner` (toasts). Design rules and every screen: `docs/ui-spec.md`.

**Run:**
```sh
npm install
cp .env.example .env         # fill GITHUB_CLIENT_ID/SECRET (optional, else guest mode), BETTER_AUTH_SECRET, LLM_BASE_URL/LLM_API_KEY
npm run db:push              # create/update tables in local.db (rerun after schema changes; confirm the prompt)
npm run dev                  # http://localhost:5173
npm run check                # svelte-check / types
npm run lint                 # prettier --check + eslint
npm run format
npm run test:unit -- --run   # vitest (server tests: npx vitest run --project server)
npm run test:e2e             # playwright (build + preview)
npm run auth:schema          # regenerate Better Auth drizzle schema after auth config changes
```
Without `LLM_BASE_URL` / `LLM_API_KEY` everything deterministic still works; chat and the model rationale are disabled.

**Scans:**
- Clones go to `$DATA_DIR/repos/<owner>/<name>.git` (bare, `--filter=blob:none`, gitignored). Deleting `data/repos` is safe; the next scan re-clones (~6 s for ArduPilot).
- Never ask a blobless clone for blob data one file at a time (`ls-tree -l`, per-file `cat-file`, `blame` / `log -L` on unfetched history): each triggers a lazy fetch, minutes on ArduPilot. Batch-fetch first: `ensureBlobs()` (current files) and `prefetchHistory()` (every historical blob of some paths, one `fetch --stdin`, ~1 s on ArduPilot).
- Scans run inside the web server process. Any CPU-heavy loop must `await tick()` from `jobs/yield.ts`, or the whole app freezes while it runs (measured: max freeze ~0.1 s with it, 2–13 s without).
- Deep scope is limited to 500 C/C++ files (`MAX_DEEP_SOURCES`); scopes with no C/C++ files fail fast. The rest of the repo is only indexed (names + includes).
- A snapshot (commit + scopes + config + `PARSER_VERSION`) is analysed once; rescans reuse it. Bump `PARSER_VERSION` in `snapshot.ts` when analysis output changes.
- Jobs are in-memory (concurrency 1); server start marks unfinished scans and reviews failed.

**GitHub OAuth app:** https://github.com/settings/applications/new, callback `<ORIGIN>/api/auth/callback/github`. Not configured → guest mode (`server/guest.ts`, public repos only).

**UI rules (docs/ui-spec.md):**
- Colours are tokens in `src/routes/layout.css`: `bg-background`, `text-link` (foreground + underline on links), status `stop / dangerous / risky / safe`, PR states `pr-open / pr-merged / pr-closed`. Status colour always comes with an icon and a word.
- No monospace in the UI (paths, SHAs, repo names, numbers are all IBM Plex Sans); only source code (diff body, code snippets) is mono. Numbers get `tabular-nums`. Sentence case, no all-caps labels, no em dashes in UI copy.
- Chrome that floats over content uses `glass` / `glass-card`; buttons that act get `pressable`.
- Everything clickable shows `cursor: pointer` (global rule in `layout.css`); no per-element `cursor-pointer` needed.
- The 3D canvas is opaque: pass `background` matching the surface it sits on (`Graph3D`).

**Layout (current):**
```
src/hooks.server.ts                 Better Auth handler + login gate (pages → /login, /api → 401); marks interrupted jobs failed
src/lib/config.ts                   APP_NAME (product name)
src/lib/auth-client.ts              better-auth/svelte client (unused)
src/lib/api.ts                      apiFetch/getJson: 401 → reload into /login
src/lib/github.ts                   RepoSummary / BranchSummary / PullSummary (shared API shapes)
src/lib/scan.ts                     ScanSummary, ScanStats, SCAN_STAGES, IMPLEMENTED_STAGES (shared)
src/lib/claims.ts                   Claim / Citation / Person (Verified·Inferred·Unknown), permalinks (shared)
src/lib/model.ts                    onboarding pack, graph, node-details shapes (shared)
src/lib/review.ts                   Verdict, ReviewResult, ReviewSummary (shared)
src/lib/format.ts                   num, pct, plural, ago, shortSha, basename
src/lib/components/ui/              shadcn-svelte (Mira) components
src/lib/components/                 AppHeader, UserMenu, ThemeToggle, ClaimBadge, ClaimList, CitationChip, AskAuthor (popover), VerdictChip, LevelBadge, shell.svelte.ts
  brand/                            LogoMark ("un"), Logo (wordmark, masks in static/brand), GithubMark
  chat/                             ChatDock (bottom composer + thread), thread.svelte.ts (per-scan conversations, localStorage)
  graph/                            Graph3D (3d-force-graph wrapper), scene.ts (palettes, focusOf), NodeInspector, BlastMeter, HeroGraph (login)
  scan/                             SystemNav, SystemCard, NewScanDialog, DeleteRepoDialog, ScanProgress, ScanFacts, CriticalPart, SystemSummary, toc.svelte.ts, actions.ts
  review/                           PullList, PullStateIcon, ReviewRows, DiffView, ImpactGraph, OverrideDialog, DeleteReviewDialog
src/lib/server/auth.ts              betterAuth config (GitHub only), githubAuthEnabled
src/lib/server/guest.ts             guest mode: shared local user + cookie (no OAuth app configured)
src/lib/server/github.ts            GitHub REST via user's OAuth token: repos, branches, pulls, commit → login
src/lib/server/jobs/                queue.ts (in-memory, concurrency 1); yield.ts (tick() for CPU-heavy loops)
src/lib/server/db/                  drizzle client + schema: auth (generated), scan.schema.ts, review.schema.ts
src/lib/server/scan/
  index.ts                          createScan / runScan / getScan / listScans (stage 0 + guards + snapshot reuse)
  snapshot.ts                       snapshot_id, ANALYSIS_CONFIG, PARSER_VERSION
  git.ts                            git() execFile wrapper, ensureBlobs(), readBlobs()
  acquire.ts                        clone/fetch, PR heads, merge-base, ls-tree inventory
  pipeline.ts                       analyzeSnapshot(): stages 1–4 (shared by scans and PR reviews)
  cparse.ts, structure.ts           stage 1: C/C++ scanner; symbols, edges (method + resolution), reference index
  gitmine.ts                        stage 2: commits, blame, co-change, authors; lineHistory() (git log -L)
  signals.ts                        stage 3: embedded signals + criticality score with explanation
  components.ts                     stage 4: directories + Louvain
  store.ts                          persist a model (chunked, yielding)
  model.ts, views.ts                read side: onboarding pack, graph, node details, impact, reach (blast radius share), authorship
  remove.ts                         deleteRepo(): user's scans + reviews, orphaned snapshots, the clone when unused
  summary.ts                        on-demand LLM system overview ("Generate overview" on the wiki)
src/lib/server/evidence/            validate.ts (claim validator, plan §4.5.5), impact.ts (blast radius + counts)
src/lib/server/llm/                 core.ts (client, retry → other model, input-hash cache), index.ts (env instance)
src/lib/server/review/              engine.ts (Tab 4 analysis), rules.ts (verdict floor), diff.ts (diff, display diff, change class), explain.ts (LLM rationale), index.ts (jobs, overrides)
src/lib/server/chat/                agent.ts (JSON tool loop), tools.ts (search, get_symbol, get_code, callers/callees, signals, history, change_risk)
src/routes/logout/                  POST: server-side sign-out → /login
src/routes/api/github/repos/        GET user repos; [owner]/[repo] GET any repo; /branches; /pulls?state=
src/routes/api/scans/               GET list, POST create; [id] GET (polled); [id]/docs (?format=md), graph, node?id=&impact= (details + reach), authorship, chat, summary
src/routes/api/reviews/             GET list, POST create; [id] GET (polled), DELETE (undo); [id]/override POST
src/routes/api/repos/[owner]/[name] DELETE: the repo's scans, reviews, analysis and clone (409 while a job runs)
src/routes/login/                   GitHub-only sign-in, split screen with the live 3D graph
src/routes/(app)/                   gated shell: glass top bar (logo, breadcrumb, theme, account)
  +page.svelte                      Systems: one card per scanned repo (rescan, delete), new-scan dialog
  scans/[id]/+layout.svelte         system shell: sidebar (wiki sections, graph, PRs) + ChatDock on every page
  scans/[id]/overview               the wiki: critical parts, components, interfaces, timing/HW, questions, reading order, facts
  scans/[id]/chat                   redirects to overview (chat is the dock)
  scans/[id]/graph                  3D graph: levels, drill-down, search, lit blast radius, inspector + blast meter; ?level=&file=&focus=
  scans/[id]/pulls                  GitHub-style PR list for the repo, reviewed PRs first
  scans/[id]/pulls/[review]         GitHub-style review (conversation timeline, merge box, files changed with inline findings)
```

## Svelte MCP

You are able to use the Svelte MCP server, where you have access to comprehensive Svelte 5 and SvelteKit documentation. Here's how to use the available tools effectively:

### 1. list-sections

Use this FIRST to discover all available documentation sections. Returns a structured list with titles, use_cases, and paths.
When asked about Svelte or SvelteKit topics, ALWAYS use this tool at the start of the chat to find relevant sections.

### 2. get-documentation

Retrieves full documentation content for specific sections. Accepts single or multiple sections.
After calling the list-sections tool, you MUST analyze the returned documentation sections (especially the use_cases field) and then use the get-documentation tool to fetch ALL documentation sections that are relevant for the user's task.

### 3. svelte-autofixer

Analyzes Svelte code and returns issues and suggestions.
You MUST use this tool whenever writing Svelte code before sending it to the user. Keep calling it until no issues or suggestions are returned.

### 4. playground-link

Generates a Svelte Playground link with the provided code.
After completing the code, ask the user if they want a playground link. Only call this tool after user confirmation and NEVER if code was written to files in their project.
