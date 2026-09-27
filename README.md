<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/wordmark-dark.png">
  <img alt="undefined" src="assets/wordmark-light.png" width="300">
</picture>

<h3>Define the unknown. Change with confidence.</h3>

<p>
Turn unknown legacy code into a system you can change with confidence.<br>
<b>undefined</b> uncovers hidden intent, timing assumptions and hardware workarounds, cited to the line.
</p>

<p>
<a href="https://builderbase.com/event/gothenburg-tech-week-x-chalmers-hackathon"><img alt="Gothenburg Tech Week x Chalmers Hackathon 2026" src="https://img.shields.io/badge/Chalmers%20Hackathon-2026-79716b?style=flat-square&labelColor=e7e5e4"></a>
<a href="https://www.saab.com/"><img alt="Saab Challenge" src="https://img.shields.io/badge/Saab-Challenge-79716b?style=flat-square&labelColor=e7e5e4"></a>
</p>

<br>

<video src="https://raw.githubusercontent.com/undefined-application/undefined/main/assets/demo-raw.mp4" controls muted width="100%"></video>

</div>

<br>

## Why

Industrial systems run for decades. The original developers are gone, the docs are stale, and a
line that looks redundant may be guarding a 15-year-old hardware anomaly. Remove it and the code
gets cleaner while the system gets less reliable.

undefined helps a new team rebuild a system's **intent, dependencies and risk before they touch the
code**. It scans a legacy embedded C/C++ repository once and builds a system model: structure,
dependencies, embedded signals, git-derived intent, and who to ask.

## What you get

|                     |                                                                                                                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **System wiki**     | Critical-parts register with scores and reasons, components, external interfaces, timing and hardware assumptions, open questions, and a reading order. Exports to Markdown. |
| **3D system graph** | Components, files and symbols. Click a node to light up everything that depends on it; the blast meter shows how much of the system it reaches.                              |
| **Chat**            | Ask about the system from any page. The agent looks things up with tools (symbols, callers, signals, history) and cites what it finds.                                       |
| **PR reviewer**     | A GitHub-style review of any pull request with a verdict, findings inline on the diff, blast radius, missing tests and the history behind the touched lines.                 |

Every PR gets one of four verdicts:

<p>
<img alt="Stop" src="https://img.shields.io/badge/%E2%97%8F-Stop-e7000b?style=flat-square&labelColor=e7000b&color=fcfcfb">
<img alt="Dangerous" src="https://img.shields.io/badge/%E2%97%8F-Dangerous-f54900?style=flat-square&labelColor=f54900&color=fcfcfb">
<img alt="Risky" src="https://img.shields.io/badge/%E2%97%8F-Risky-e17100?style=flat-square&labelColor=e17100&color=fcfcfb">
<img alt="Safe" src="https://img.shields.io/badge/%E2%97%8F-Safe-00a63e?style=flat-square&labelColor=00a63e&color=fcfcfb">
</p>

And every statement carries a label: **Verified** (checked against code or git), **Inferred** (a
reasoned guess, with its evidence) or **Unknown** (a question for a human). Each one cites a line or
a commit you can click through to.

## How it works

One scan runs five stages, then everything in the app reads from the model they build.

| Stage          | What it does                                                                                                                                               |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Acquire**    | Blobless clone, batch-fetched blobs, inventory of the tree                                                                                                 |
| **Structure**  | Our own syntax-level C/C++ scanner: symbols, call and reference edges                                                                                      |
| **Git mining** | Commits, blame, co-change and authors, down to the history of single lines                                                                                 |
| **Signals**    | Interrupt handlers, hardware registers, bus I/O, timing constants, watchdogs and workaround comments, rolled into a criticality score that explains itself |
| **Components** | Directories plus Louvain communities over the graph                                                                                                        |

The deterministic core needs no model. An LLM (any OpenAI-compatible endpoint) only adds chat, the
review rationale and the generated overview, and a validator downgrades any claim it cannot back up.

## Try it

```sh
npm install
cp .env.example .env   # optional GitHub OAuth app, BETTER_AUTH_SECRET, optional LLM_BASE_URL / LLM_API_KEY
npm run db:push        # create or update the tables in local.db (confirm the prompt)
npm run dev            # http://localhost:5173
```

GitHub sign-in needs an [OAuth app](https://github.com/settings/applications/new) (callback
`<ORIGIN>/api/auth/callback/github`). Without one, only guest mode is avaliable: no account, public repositories only.

## Stack

SvelteKit 2, Svelte 5, TypeScript, Tailwind v4 and shadcn-svelte (Mira, stone, IBM Plex) ·
Better Auth (GitHub) · Drizzle on SQLite · graphology + Louvain · 3d-force-graph · `git` CLI ·
OpenAI SDK against a Gonka broker · Vitest and Playwright.

<div align="center">
<sub>Built at <a href="https://builderbase.com/event/gothenburg-tech-week-x-chalmers-hackathon">Gothenburg Tech Week × Chalmers Hackathon 2026</a>, for <a href="https://www.saab.com/">Saab</a>'s challenge:<br><i>How might we use AI to understand legacy embedded systems?</i></sub>
</div>
