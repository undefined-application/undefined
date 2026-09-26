# Demo pitch

- See [GTW Chalmers Hackathon - Challenge to Pitch Crash Course.pdf](event/GTW%20Chalmers%20Hackathon%20-%20Challenge%20to%20Pitch%20Crash%20Course.pdf)
- Focus on the *Why*, not just rewriting code
- Pick 1 gnarly-looking function/workaround, show AI surface why it exists (citing an old commit/bug fix), then show it flag as "don't touch — breaks cert" — that's the whole challenge in 60 seconds.
- 5-question demo pitch flow:
    - Problem: Retiring engineers leave behind undocumented, hardware-dependent legacy code.
    - Evidence: Modifying legacy code without knowing intent breaks critical hardware/safety functions.
    - Solution & Prototype: a web app that **scans a legacy repo once** and builds a system model with four views. Demo script: `docs/plan.md` §8.
        1. **Onboarding:** architecture, critical parts, timing and HW assumptions, unknowns.
        2. **Chat:** a grounded Q&A bot with a "can I change this?" mode.
        3. **Dependency graph.**
        4. **PR Reviewer:** the climax of the demo. It gives a PR a verdict (safe / risky / dangerous / stop) backed by cited evidence: everything that depends on the changed code, git blame and history, why the line was written, and the tests it's missing.

        Every claim is labelled Verified / Inferred / Unknown. Every line has an "ask the author" button. This directly answers SAAB's own example: "redundant-looking line may guard a 15-yr-old HW anomaly."
    - Learning: What did testing prove? The answer so far, measured on ArduPilot (details in `docs/status.md`):
        - PR #21937 was merged in real life and reverted 10 days later for bad IMU data. The reviewer gives it **STOP** in ~6 s and cites the 2016 commit that introduced the check: "catch FIFO alignment errors using temperature reading".
        - Blame alone would have missed it. At the PR's merge base, the changed line is blamed on a refactor commit; only the line's full history reaches the reason.
        - Three real comment/typo-only changes come out **SAFE**, each proven behaviour-free by a token-level comparison.
        - The scan found a coupling no file mentions: the barometer driver `AP_Baro_ICM20789` includes the IMU driver's register header.
        - A full scan of the IMU subsystem (59 files, 1,355 commits of history) takes ~20 s.
    - Next Step: **CI gate.** The same review engine as a GitHub Action that comments blast radius and criticality on every PR before merge. After that: hardware-change impact from datasheets and errata, and generated characterization test suites. See `docs/ideas.md`.

## Demo prep checklist

- **Pick the target line/function in advance, don't discover live.** Test it beforehand so the on-stage run is a known-good rerun, not a gamble on 5 min of wifi. See `docs/repos.md` for candidate repo/file, and `docs/spike-results.md` (written by prompt 01a) for the chosen target and workaround line.
- **Prep two contrasting verdicts**, not one: a "safe to remove" example and a "dangerous, don't touch" example. The contrast is what sells the tool. A single verdict is easy to shrug off.
    - **STOP: ready.** Review upstream `ArduPilot/ardupilot` PR **#21937** directly in Tab 4 ("Or review PR #"). No fork is needed; the engine was verified to give STOP.
    - **SAFE: to do.** Open one PR in a team fork that only touches comments, whitespace or log strings. Suggestion: fix the typo in `// use temperatue to detect FIFO corruption` in the same driver, so both verdicts come from the same code.
        - It has to be behaviour-free: `docs/plan.md` §5 Tab 4 blocks SAFE for anything else when the analysis is incomplete, and a subdirectory scan is incomplete.
        - Verified on the real commits `e25a391a8f`, `12c10dce32` and `3ad346a3af`: comment-only changes come out SAFE.
- **Verify the citation is real** before demo day — the commit/blame link the tool shows on stage must resolve to an actual commit message, not a fabricated one. If judges click through, it has to hold up.
- **Ground-truth check:** the STOP line has a real public history: ArduPilot [PR #21937](https://github.com/ArduPilot/ardupilot/pull/21937) disabled the check and was merged, and [PR #22034](https://github.com/ArduPilot/ardupilot/pull/22034) reverted it 10 days later ("this leads to bad IMU data on ICM20602"). Open both live as independent confirmation that the tool isn't hallucinating. Details are in `docs/spike-results.md`.
- **Record a backup demo video** the night before, in case venue wifi or the LLM broker (429s etc, see CLAUDE.md) flakes during the live pitch window (17:00–17:50 Sat).
- **Cache/pre-run results** for the chosen target so the live version can fall back to a warmed cache instead of a cold API call if latency is bad on stage.
    - Scan once on the demo machine. Rescanning the same snapshot is instant, because the stored model is reused.
    - Run each demo review and chat question once, so the LLM answers come from the input-hash cache.
    - Cold numbers: clone ~6 s, scan ~20 s, review ~6 s.
- **Assign demo roles**: one person drives the keyboard, one narrates, one watches the clock (5 min slot), one fields Q&A — decide before Saturday 16:00 prep window, not during it.
- **Rehearse the 60-second judge-ready check** (crash course): what problem matters / what evidence / what built / what learned / what's next — no slides needed for this part.