# UI spec: the premium pass

> Written Sat 26 Sep 2026, ~01:30, before the redesign. Scope: every screen of the app, no change to
> the analysis. Source of truth for how the app looks and where each feature lives. `docs/plan.md`
> still owns *what* the product does.

## 1. Design read

**Reading this as:** a dense engineering product (a dev tool) for maintainers of legacy embedded
code and for the judges watching them, with a calm, precise "instrument" language, built on
shadcn-svelte (Mira style, preset `b5deNMQ2S`) with stone neutrals, no accent colour, IBM Plex Sans and
IBM Plex Mono.

- **Skills applied.** Taste skill (anti-slop rules, dark-mode protocol, pre-flight check; its
  landing-page rules only on the login page, since the rest is product UI), Anthropic's frontend-design
  skill (subject-grounded choices, one bold element, restraint, UX writing) and Emil Kowalski's
  apple-design skill (instant press feedback, interruptible motion, anchored origins, translucent
  chrome, reduced motion and transparency, size-specific tracking).
- **Dials.** `DESIGN_VARIANCE 4` (predictable product grids; the login page is the one asymmetric
  moment), `MOTION_INTENSITY 5` (fluid CSS and camera moves, nothing loops for show),
  `VISUAL_DENSITY 7` (cockpit-leaning: compact Mira controls, mono tabular numbers).
- **Preset `b5deNMQ2S`.** The official shadcn CLI decodes it as style `mira`, base colour `stone`,
  theme `teal`, chart colour `teal`, icons `lucide`, font `ibm-plex-sans`, default radius, subtle menu
  accent. We take shadcn-svelte's Mira components and swap the teal theme for stone's neutral
  primary: no accent colour anywhere. Links are foreground with an underline.
- **The one bold element.** The 3D system graph: the thing people remember. Everything around it
  stays quiet.

## 2. What the app does today (audit)

Every feature below must survive the redesign.

| Area | Features |
|---|---|
| Auth | GitHub OAuth; dev email/password; login gate (pages redirect, API 401); sign out |
| Scans | New scan: own repos (filterable), any public repo, ArduPilot demo prefill, branch picker, deep scope (subpath), reference scope. Recent scans with status |
| Scan header | repo, ref, commit, deep and reference scope, tokens used; polling while running |
| Overview | Critical-parts register (rank, file:lines, score, level, factors, cited claims, Ask author); components; external interfaces; timing and HW assumptions (10 + show all); unknowns; reading order; stage progress and error; scope and coverage; history stats; signals by kind; claim legend; Markdown export |
| Chat | Starter questions, thread, answer + validated claims + citations, tool lookups, validator downgrades, disabled until the scan is done |
| Graph | Component/file/symbol levels, double-click drill-down, file filter, co-change toggle, search, criticality colours, boundary nodes, edge styles by resolution, legend. Node panel: criticality + factors, Ask author, edge counts, blast radius (depth 1-5, counts, list), signals with GitHub links, recent commits with fix/revert/HW tags, authors, co-change |
| PR reviews | Repo input with own-repo suggestions, open/closed lists, review by PR number, recent reviews with verdicts |
| Review | Running stage, failure; verdict + completeness; floor, model raise, overrides; rationale (model or rules, errors, downgrades); findings (severity, claims, Ask author); blast radius (touched symbols, impact tree); test impact; unwritten assumptions; open questions; pinned SHAs; completeness reasons; change classes; stats; rules fired; human override form |
| API only | `POST /summary` (model system overview), `GET /authorship` (introduced / last modified by) |

**Missing today:** deleting anything; light/dark mode; a 3D graph; any measure of how much of the
system a node affects; a diff view for reviews.

## 3. Information architecture: no tabs

The four-tab bar goes. A scanned repository becomes a **system**, laid out like DeepWiki: a sidebar,
one readable document, and a chat composer docked at the bottom of every system page.

```
/login                        GitHub only
/                             Systems: every scanned repo, new scan, delete
/scans/[id]/overview          System wiki (was Tab 1); /scans/[id] and /scans/[id]/chat redirect here
/scans/[id]/graph             3D system graph (was Tab 3)
/scans/[id]/pulls             Pull requests of this system's repo (new, GitHub-like)
/scans/[id]/pulls/[review]    One review, GitHub-like (was Tab 4), inside the system shell
```

- Chat (was Tab 2) is the **bottom dock** on every `/scans/[id]/*` page. The thread survives moving
  between wiki, graph and pull requests.
- No top-level tabs: the top bar is logo, breadcrumb, theme, account. Reviews only exist inside
  a system; there is no cross-system reviews page.
- Old URLs keep working (redirects), so shared links and bookmarks don't break.

### App shell

```
┌────────────────────────────────────────────────────────────────────────────┐
│ ▣ undefined   Systems / ArduPilot/ardupilot / AP_InertialSensor   Reviews ◐ ◉ │  translucent, 48px
├──────────────┬─────────────────────────────────────────────────────────────┤
│ SYSTEM       │                                                             │
│  Overview    │                    page content                             │
│  · Critical  │                                                             │
│  · Components│                                                             │
│  · Interfaces│                                                             │
│  · Timing    │                                                             │
│  · Questions │                                                             │
│  · Reading   │            ╭──────────────────────────────────────╮         │
│ EXPLORE      │            │ Ask about AP_InertialSensor…       ↑ │         │
│  Graph       │            ╰──────────────────────────────────────╯         │
│  Pull reqs   │                                                             │
│ commit · ref │                                                             │
└──────────────┴─────────────────────────────────────────────────────────────┘
```

- Top bar: logo, breadcrumb (where am I), "Reviews", theme toggle (light / dark / system), avatar
  menu (name, email, sign out). Glass material with a hairline, content scrolls under it.
- Sidebar only in a system context. Collapses to a sheet below `lg`. From `lg` up, the panel button at the bottom right of the sidebar (next to Delete) folds it away (remembered); while folded, a handle on the left edge marks it and it floats in when the pointer reaches the edge; the same button or the handle docks it again. A click on the sidebar's blank space does what the button does: docks it while floating, folds it while docked. Opening the chat as a side panel folds it too, and closing the panel restores it.

## 4. Screens

### 4.1 Login

Split screen (the one asymmetric layout): left, the pitch and the only button; right, a slowly
turning 3D graph where one node lights up its blast radius every few seconds, the product's core
moment rendered for real. Static under reduced motion.

- Headline: "Define the unknown." / "Change with confidence." (first line muted)
- Sub: "Legacy embedded code hides its intent, timing tricks and hardware workarounds. undefined
  finds them, explains them, and links each one to the line and commit behind it."
- Button: "Continue with GitHub". Fine print about the `repo` scope. No email/password UI.

### 4.2 Systems (home)

```
Systems                                                       [+ New scan]
┌───────────────────────────────┐ ┌───────────────────────────────┐
│ ArduPilot/ardupilot       ⋯   │ │ …                             │
│ libraries/AP_InertialSensor   │ │                               │
│ 59 files  2,428 symbols  …    │ │                               │
│ master @ 9f648cc   2 h ago    │ │                               │
└───────────────────────────────┘ └───────────────────────────────┘
```

- One card per repository (its latest scan; a "+N more" count for older scans and other scopes).
  Running scans show the live stage. Card menu: Scan again, Open on GitHub, **Delete repository…**
- **Delete** opens an alert dialog naming what goes: every scan and review of that repo for you, the
  local clone and cached analysis (shared snapshots are kept if another user still has a scan). The
  destructive button repeats the verb: "Delete repository". Blocked (409) while a scan or review of
  that repo is running.
- New scan: a dialog. Repository picker (search your repos, or any public `owner/name`, or the
  ArduPilot demo), branch, deep scope, reference scope (segmented), "Start scan".
- Empty state: what a scan gives you, plus "New scan" and "Try the ArduPilot demo".

### 4.3 System wiki (`/overview`)

A document, not a dashboard. Title = deep scope, lede sentence from the stats, then sections:
Critical parts (expandable rows; the first one open, each with "Blast radius" into the graph),
Components ("Show in graph"), External interfaces, Timing and hardware assumptions, Open questions,
Where to start reading. The sidebar lists the sections with scroll spy; the right rail holds scan
facts (coverage, history, signals, claim legend). "Generate overview" (the existing `/summary`
endpoint, explicit click) sits above the sections when a model is configured. Export Markdown,
Scan again and Delete live in the sidebar footer.

- Running: a stage timeline (Acquire, Static analysis, Git mining, Signals, Components) with the live
  step, and skeletons shaped like the sections.
- Failed: the error, "Scan again", "Delete".

### 4.4 Chat dock

- Collapsed: a floating composer (glass, 640px max), placeholder "Ask about <scope>…", send button,
  starter questions as chips when the thread is empty and the composer is focused.
- Asking expands it upward into a panel (origin: the composer; 70vh max) showing the thread: user
  bubbles, answers with Verified / Inferred / Unknown claims and citation chips, the lookups the agent
  made, validator downgrades. Esc or the chevron collapses it; the composer stays.
- Header: the conversation's title (its first question) opens a menu of every conversation about
  this system (newest first, with a delete) and "New conversation". One button on the right:
  minimise. Conversations live in localStorage; the server keeps none.
- No model configured: the composer says so and is disabled. Scan still running: disabled with the
  reason.

### 4.5 System graph (`/graph`)

Full-bleed 3D canvas (3d-force-graph on three.js) with floating glass controls.

- Levels: Components, Files, Functions (segmented). Double-click drills down (component → files,
  file → its functions). Search jumps the camera to a node. Co-change toggle.
- Nodes: size = fan-in / files, colour = criticality (high red, medium amber, low stone), boundary
  nodes hollow and grey. Edges: resolved solid, ambiguous and unresolved in amber, co-change violet
  (only when on).
- **Click a node:** the camera flies to it; the node, its direct neighbours and everything that
  transitively depends on it light up (depth fades the brightness); every other node dims to a ghost.
  Lit edges carry the link, no moving particles.
- **Inspector** (right glass panel): name, kind, file:lines link, criticality and factors, Ask author,
  **blast radius meter**, dependents by depth, signals, recent commits, people and co-change, "Ask
  about this" (fills the chat composer).
- **Blast radius meter:** a radial gauge with the share of the analysed system that transitively
  depends on the node (functions and classes), plus files and components reached, the deepest path,
  and what the number can't see (ambiguous, unresolved, outside the scope). Plan §3 rule 7: when
  anything is unresolved or outside the scope, the meter says "at least".

### 4.6 Pull requests (`/pulls`)

GitHub's list, verbatim in structure: Open / Closed toggles, one row per PR (state icon, title,
`#number by author`, `head → base`, updated), the verdict chip if reviewed, else a "Review" button.
"Review PR #…" input for any number (merged upstream PRs like #21937 included). Reviews of PRs not on
the current page are listed above.

### 4.7 Review (`/scans/[id]/pulls/[review]`)

GitHub's PR page.

```
disable temperature based fifo check on ICM20602  #21937
(⎇ Merged) tridge merged into master from icm20602-fifo

[ Conversation ]  [ Files changed 2 ]                          │ Verdict   STOP
                                                               │ Labels    code
◉ undefined reviewed: STOP, needs human sign-off               │ Ask       Andrew Tridgell
  rationale … (by model X / from rules)                        │ Snapshots merge base, base, head
  ├ finding: STOP  Removes a workaround … [claims] [Ask]       │ Completeness partial
  ├ finding: DANGEROUS …                                       │
  Blast radius  (meter + dependents)                           │
  Tests · Assumptions · Open questions                         │
┌ merge box ───────────────────────────────────────────────┐   │
│ ⛔ Merging is blocked until a person signs off   [Override]│   │
│ ✗ rule …  ✗ rule …  ! completeness partial  ✓ …          │   │
└──────────────────────────────────────────────────────────┘   │
```

- **Files changed:** a unified diff with 3 lines of context per hunk, file list with change class, and
  each finding shown inline under the lines it cites (GitHub review comment style). Stored with the
  review (`result.diff`); older reviews say "Run the review again to see the diff".
- **Override:** a dialog (verdict + written reason, 10+ characters); shows up in the timeline.

## 5. Tokens

| Token | Light | Dark |
|---|---|---|
| background | stone-50-ish `oklch(0.993 0.0015 106)` | stone-950 `oklch(0.147 0.004 49.25)` |
| card / popover | white | stone-900 |
| foreground | stone-950 | stone-50 |
| primary | stone-900 | stone-200 |
| link | foreground + underline | foreground + underline |
| muted-foreground | stone-500 | stone-400 |
| border | stone-200 | white 10% |

- **Status colours (semantic, never decoration):** STOP red, DANGEROUS orange, RISKY amber, SAFE
  green; criticality high red, medium amber, low stone; claims verified green (solid), inferred amber
  (dashed), unknown stone (dotted, italic). GitHub state colours on PR icons (open green, merged
  violet, closed red) because that is what reviewers already read.
- **Type:** IBM Plex Sans for UI (13/14 px body in Mira), IBM Plex Mono only for source code (diff
  body, code snippets); paths, SHAs, repo names and numbers stay in Plex Sans (numbers tabular). Headings tighten (-0.02em), small labels open up slightly. Sentence case
  everywhere, no all-caps labels, no em dashes in UI copy.
- **Shape lock:** containers `rounded-xl`, controls `rounded-md`, chips `rounded-sm`, avatars round.
- **Materials:** top bar, chat dock and graph panels are glass (`backdrop-blur` + translucent fill +
  hairline). `prefers-reduced-transparency` makes them solid.
- **Motion:** buttons scale to 0.98 on press (pointer-down, 100 ms). Panels move on transform and
  opacity with the iOS sheet curve `cubic-bezier(0.32, 0.72, 0, 1)`, entering and leaving along the
  same path, from their trigger. Graph camera flies 900 ms. `prefers-reduced-motion`: no camera
  flights, no auto-rotate, fades only.

## 6. Logo

`undefined` is C's scariest word, and the product's job is to make the undefined parts of a system
defined. The wordmark is `undefined` in a condensed serif, with `un` in grey (`--brand-un`) and `defined`
in foreground: the prefix fades, the defined part stays. It ships as alpha masks in `static/brand/`
(`un.png`, `defined.png`) painted in `currentColor` via the `brand-mask` utility, so it follows the
theme. The small mark is just `un` (`un-mark.png`, `LogoMark`). Favicon: a light `un` on a stone-950
tile.

## 7. Build notes

- shadcn-svelte `init --preset b5deNMQ2S` (Mira), then stone's neutral primary in place of the teal theme.
  `mode-watcher` for the theme, `@lucide/svelte` icons, `3d-force-graph` + `three-spritetext`.
- New API: `DELETE /api/repos/{owner}/{name}`; `reach` (system share) on `GET /api/scans/{id}/node`;
  `diff` (display hunks, capped) in the review result; `llm` flag in the layout data.
