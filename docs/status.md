# Build status

> Snapshot of Fri 25 Sep 2026, ~23:45, plus the UI pass of Sat 26 Sep ~02:00 (see *UI pass*). Update this file when you finish something.
> Scope is defined in `docs/plan.md`; this file says what exists, what was measured, where the build
> differs from the plan, and what's left.

## Summary

- All four tabs exist end to end: **Overview** (Tab 1), **Chat** (Tab 2), **Graph** (Tab 3) and **PR Review** (Tab 4). Scan stages 0–4 are fully built; stages 5–7 only partly (see *How the build differs*).
- The deterministic core (scan, graph, signals, git mining, verdict rules, claim validator) is **verified on real ArduPilot data** with scripts and 71 unit tests.
- **Not verified yet:**
  - the full flow clicked through the UI by a signed-in user;
  - any LLM call against the real Gonka broker (review rationale, chat, system overview), which has only been tested against a fake server.

## UI pass (Sat 26 Sep, ~02:00)

The whole UI was redone to `docs/ui-spec.md`: shadcn-svelte (Mira, preset `b5deNMQ2S`), light and dark mode, no tab bar. Nothing in the analysis changed.

- **Login:** GitHub only, split screen with a live 3D graph lighting up a blast radius. The email/password form is gone.
- **Systems** (home): one card per scanned repo with stats, rescan, **delete** (alert dialog; `DELETE /api/repos/{owner}/{name}` removes the user's scans and reviews, snapshots nobody else uses and the clone once unused; 409 while a job runs), new-scan dialog. No top tabs; reviews live only inside a system (`/scans/[id]/pulls/[review]`).
- **System wiki** (was Tab 1): DeepWiki layout, sidebar with section scroll-spy, expandable critical parts, "Generate overview" button for the existing `/summary` endpoint (explicit click, only with a model configured).
- **Chat** (was Tab 2): a composer docked at the bottom of every system page; the thread grows upward and survives moving between pages. Several conversations per system (localStorage), listed from the header title with New conversation and a confirmed delete. Answers render as sanitised markdown (`Markdown.svelte`: marked + DOMPurify, `[E1]` as small markers, inline code in Plex Sans like the claim chips). The system prompt (`chat-agent.v3`) has a style guide plus one JSON example reply: direct answer first, bold-labelled bullets only for parallel points, identifiers in backticks, 60-180 words, no evidence ids or em dashes in the answer, 2-6 atomic cited claims. Measured live on "What breaks if we replace the sensor chip?" (DeepSeek V4 Flash, 2026-09-26): v2 gave one wall of text and claims downgraded to Unknown because the model joined quote pieces with "..."; v3 gave a one-line answer plus bullets, JSON only, 0 downgrades. The validator now accepts "..."-elided quotes when every piece is in the cited item, in order. Select text in any message to reply to that passage; the model gets it as a blockquote above the question. On wide screens (`xl`+) the dock can become a side panel (a third layout column, remembered per browser); the box flies between the two as a view transition (`chat` in layout.css), and a thread opens already scrolled to the end. A grip on the dividing line (`PanelResizer`, an ARIA splitter) resizes it: drag anywhere on the line, double-click for 26rem, arrow keys; 320 px to what leaves the page 30rem, remembered per browser; on the overview the facts column moves below the article meanwhile. No full-screen mode.
- **Graph** (was Tab 3): 3D with `3d-force-graph`. Clicking a node lights up its transitive dependents (depth-faded), dims the rest and frames the lit set. Inspector with a **blast radius meter**: share of the analysed files that depend on the node (`reach` on `GET /node`), functions, components, depth histogram, "at least" when references are unresolved or outside the scope.
- **Pull requests / review** (was Tab 4): GitHub-style PR list per system; review page with conversation timeline (the review as a bot comment, findings, 3D blast radius, tests, assumptions, questions, overrides), a merge box listing the rules that fired, an override dialog, and **Files changed**: the diff with context and each finding inline under the lines it cites (`result.diff`, stored with new reviews).
- **Logo:** a timing-diagram bus transition, hatched (undefined) to teal (defined). Favicon to match.
- **Verified:** `npm run check` and `npm run lint` clean; 76 server tests (5 new: display diff, reach); every page clicked through in the browser in dark mode on a real ArduPilot scan and the #21937 review (STOP).
- **Not verified:** light mode on every page, chat and "Generate overview" against a real model (no broker configured locally), the Playwright e2e run.

## Verified results

Demo target: ArduPilot `libraries/AP_InertialSensor` at `9f648ccabc`.

### Scan timings

| Step | Cold | Warm |
|---|---|---|
| Clone (blobless, first scan of the repo only) | ~6 s | — |
| 0 Fetch + read sources (59 deep + 3,352 reference C/C++ files) | ~2 s | 0.2 s |
| 1 Structure + reference index | ~2 s | ~2 s |
| 2 Git mining (history blob prefetch ~0.8 s, blame ~5 s) | ~7 s | ~6 s |
| 3–4 Signals, criticality, components | <0.1 s | <0.1 s |
| **Total** | **~20 s** | **~9 s** |

- Scanning the same snapshot (commit + scopes + config) again is instant: the stored model is reused.
- **Server responsiveness:** the web server stays responsive during a scan; the longest freeze is ~0.1 s. Before the fix it froze for 2 s per scan, 13 s for a whole-repo analysis, and forever on repos without C/C++ files (infinite loop, now fixed and tested).

### What the scan finds

- **Structure:** 2,428 symbols; 2,014 resolved and 892 ambiguous edges (overloads, same-named methods, names matched from outside the scope).
- **History:** 1,355 commits: 261 bug-fix, 3 reverts, 75 with a HW/timing reason in the message. 101 author emails, 6,165 blame ranges, 177 co-change pairs.
- **Most critical functions:** `AP_InertialSensor_Invensense::_read_fifo`, `_hardware_init`, `_fifo_reset`, `start`.
- **External interfaces:**
  - `AP_InertialSensor.h` is included by 41 files outside the driver (`Copter.h`, `Plane.h`, `Sub.h`…);
  - `AP_InertialSensor_Invensense_registers.h` is also included by the barometer driver `AP_Baro_ICM20789.cpp`. That is a hidden cross-driver coupling, and a good pitch detail.

### PR reviews

The review engine was run from a script against the real clone:

- **Upstream PR #21937** ("disable temperature based fifo check on ICM20602") → **STOP** in ~6 s.
  - It cites `d2f6a514b9` ("catch FIFO alignment errors using temperature reading") and the comment "use temperatue to detect FIFO corruption".
  - Rules that also fired: partial completeness, critical functions touched, no related tests.
  - Ask-the-author: Andrew Tridgell.
  - No fork is needed for this demo: the reviewer works on any PR, including merged upstream ones.
- **Comment/typo-only commits** `e25a391a8f`, `12c10dce32`, `3ad346a3af` → **SAFE**, each with a Verified "behaviour-free (token-level comparison)" finding.

### Quality checks

- 71 server unit tests covering:
  - acquire, snapshot identity, git mining on a blobless fixture repo;
  - the C/C++ scanner, edge resolution, signals, components;
  - the claim validator, LLM client (cache, 429 fallback);
  - diff and change class, rule floor, the chat agent loop.
- `npm run check` and `npm run lint` are clean.

## How the build differs from the plan

| Plan | As built | Why |
|---|---|---|
| tree-sitter (WASM) for stage 1 | Own syntax-level scanner `cparse.ts` with the same edge contract (method, resolution, candidates) | No native/WASM setup; 59 files in 0.36 s, all 3.4k ArduPilot C/C++ files in ~2.5 s |
| PageRank ranking | Fan-in plus signals plus git history | Enough for ranking; `graphology-metrics` is installed but unused |
| Parse cache by content hash | Whole-snapshot reuse | A full re-analysis is ~9 s warm; reuse makes rescans instant |
| Stage 5 LLM summaries (file → component → system) | Only the system overview: generated as the scan's last step ("AI overview", best effort, cached) and requested again by the wiki on open (`POST /api/scans/{id}/summary`) | Time |
| Stage 6 docs | Deterministic onboarding pack; Markdown export | All content is cited facts from the model |
| Stage 7 FTS5 search index | Not built; chat uses in-memory keyword search over symbols, signals and commits | Time |
| SSE progress (`/events`) | Polling every 1.5 s | Simpler |
| Chat with native tool calling, streamed | JSON tool protocol (one tool per turn, max 6), not streamed | The broker's tool-calling support is undocumented |
| 3D graph + 2D toggle | 3D only (`3d-force-graph`), no 2D toggle | The 3D view carries the blast radius; 2D was dropped |
| shadcn-svelte | shadcn-svelte, Mira style, preset `b5deNMQ2S` | UI pass |
| STOP rule on blame | STOP/DANGEROUS use `git log -L` line history (key commit per hunk) plus workaround comments | At #21937's merge base, blame points at a refactor ("reduced number of SPI transfers"); only the line history reaches the FIFO-check origin |
| `/nodes/{id}`, `/impact/{id}` | `/node?id=…&impact=<depth>` | Node ids contain `/` and `#` |
| Unlimited deep scope | Max 500 C/C++ files; no-C/C++ scopes fail fast | A whole-repo ArduPilot deep scan would take the better part of an hour |

## Known limitations

- **Keyword heuristics are noisy.** "fixed build warning" counts as a bug fix. Signals and flags are shown as evidence, never as proof.
- **Authors are keyed by email.** Andrew Tridgell appears twice. GitHub logins are looked up only for review findings and the authorship endpoint.
- **The reference index is name/include based.** Names also defined outside the scope are skipped. Methods named without their object are ambiguous.
- **`#else` / `#elif` platform variants are not analysed**; the first `#if` branch wins.
- **Blast radius meter** counts files and functions in the analysed scope. Dependents outside the scope are listed as a number, not included in the share.
- **Ask-the-author "introduced by"** (`GET /api/scans/{id}/authorship`, via `git log -L`) has no UI yet. The Ask buttons use the commit already cited in the claim.
- **Test impact** is a static match only. "Suggested tests" is a generic sentence; no characterization tests are generated.
- **The "tokens used" counter** on a scan counts chat and system-overview tokens. Review tokens are shown on the review itself. There is no per-scan token budget.
- **One process:** the job queue has concurrency 1. A server restart marks running scans and reviews failed.
- **Code goes to the broker.** Chat, review rationale and system overview send code snippets and commit messages to the external LLM broker. That's fine for public repos. For SAAB-internal code this needs an on-prem model; mention it in the pitch.

## TODO

### P0: before the 14:00 freeze

- [ ] Commit the work: the whole pipeline, tabs, tests and these docs are uncommitted.
- [ ] Restart the dev server. Check that `.env` has `LLM_BASE_URL` and `LLM_API_KEY` exactly once.
- [ ] End-to-end run in the UI:
  - use "Fill in the demo: ArduPilot IMU drivers" and scan;
  - check Overview and Graph;
  - PR Reviews → `ArduPilot/ardupilot` #21937 should give STOP.
- [ ] SAFE demo PR: open one comment-only PR in a team fork. For example, fix the typo in `// use temperatue to detect FIFO corruption` in the same driver, so STOP and SAFE come from the same code. Any comment/whitespace/log-string-only change works.
- [ ] LLM smoke test against the broker:
  - ask the chat one starter question;
  - run one review and check that the rationale comes from the model;
  - check JSON compliance, latency and 429 behaviour, and pick the models.
  - Latency measured 2026-09-26 (~3k-token prompt, uncached, streaming): DeepSeek V4 Flash takes ~3 s a call on Hyperfusion but 21-42 s on gonka-api, gonkarouter and gonka24 (one 120 s timeout); MiniMax 5 s vs 7-40 s. A chat answer is up to 7 sequential calls, so Hyperfusion is now first (the default order in `brokers.ts` and `LLM_BROKER_ORDER`). Hyperfusion also serves `openai/gpt-oss-120b` (~2 s), untested for JSON compliance.
- [ ] Decide whether sending code snippets to the broker is OK. The "Generate overview" button now exists (explicit click, only with a model configured); hide it if the answer is no.

### P1

- [ ] Pre-run the demo scan and reviews on the demo machine. Rescans are then instant (snapshot reuse), and repeated LLM answers come from the cache.
- [ ] Record a backup demo video.
- [ ] Pitch: 60-second judge-ready check (`docs/demo.md`), demo roles, timing.
- [ ] Decide on Lovable usage (plan §9).

### P2: nice to have (cut first)

- [ ] Ask-the-author panel using `/authorship` (introduced-by + last-modified-by, GitHub login).
- [ ] Merge author identities by GitHub login.
- [ ] Per-stage progress text (e.g. "blaming 23/59 files") and SSE instead of polling.
- [ ] Stage 7 FTS5 index for chat search.
- [ ] Suggested characterization / timing tests in reviews.
- [x] 3D graph (no 2D toggle). Still open: remove `graphology-metrics` or use PageRank.
- [ ] Playwright e2e for scan → review.
- [ ] "Post as PR comment" (explicit click) and the GitHub Action "PR Gate": the pitch's next step.
