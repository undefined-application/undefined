# Ideas

> **Status (Fri 25 Sep, 23:45): both ideas are built**, as part of the 4-tab product in `docs/plan.md`.
>
> - **Fence Checker** is the chat's `change_risk` tool in Tab 2. Ask "Can I change `<file>` line N?" and it returns the line history, signals and dependents under the same rules as the reviewer. In Tab 3, the graph node panel shows the blast radius of any function.
> - **PR Gate** is Tab 4 (PR Reviewer), triggered manually from the web app. It was verified to give STOP on the real ArduPilot PR #21937. The CI / GitHub Action trigger and "post as PR comment" stay the pitch's next step.
>
> This file is kept as the original rationale.

Two candidate builds, same underlying engine (codebase exploration + git history mining), different interface/trigger.

## 1. Chesterton's Fence Checker

Single-question tool. Developer points at a specific line/function (not the whole repo) and asks *"I want to change/remove/refactor this."*

Tool returns a verdict — **safe / risky / dangerous / stop** — with cited evidence:
- everything that depends on it / calls it (deep reference exploration, not just direct callers)
- git history: blame, who wrote it, why (commit messages, related fixes)

Solves literally what SAAB gave as the example: *"redundant-looking line may guard a 15-yr-old HW anomaly."*

> Chesterton's Fence, for context: before you remove something that seems pointless, first understand why it was put there.

To work needs: codebase exploration + git history search — the two core pieces to build first. Can extend later if this isn't enough on its own.

## 2. PR Gate

Same underlying tech, different interface. Next logical step from the Fence Checker: works on **larger diffs** instead of one queried line, runs **before a PR merges**.

- CI/CD plugin (e.g. GitHub Action) — same steps as Fence Checker, run automatically on a diff
- Leaves PR comments: blast radius + criticality — *"this touches N callers, 2 flagged critical"* — with cited commits
- Can also generate a PDF (or other format) report
- Underlying tech/tooling identical to Fence Checker, just a different interface/trigger (push vs. pull)

## Sequencing

Build Fence Checker first (sharpest live demo, most direct hit on SAAB's brief). PR Gate reuses the same engine wrapped in a CI trigger — cheap to add after, and covers the "scalability / next steps" judging criterion without a second build.
