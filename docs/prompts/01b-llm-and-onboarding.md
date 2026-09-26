# Prompt 01b: LLM layer, claim validation, and Tab 1 Onboarding

> **Status: mostly done (Fri 25 Sep). Don't re-run this prompt as a whole.**
>
> Built:
> - the LLM client with retry, fallback and the input-hash cache (`src/lib/server/llm/`);
> - the claim validator per plan §4.5.5 (`src/lib/server/evidence/validate.ts`, with tests);
> - Tab 1 as a deterministic onboarding pack, with Markdown export.
>
> Not built:
> - bottom-up LLM summaries (stage 5); only an on-demand system overview endpoint exists, `POST /api/scans/{id}/summary`, with no UI yet;
> - the FTS5 search index (stage 7);
> - measurement of the skeleton token ratio.
>
> The LLM parts haven't been run against the live broker. See `docs/status.md`.
>
> Copy everything below the line into a coding agent running in this repo. It assumes Prompt 01a is merged: the scaffold, snapshots, stages 0–4, the reference index and the impact/completeness engine all exist. This prompt adds scan stages 5–7, the evidence validator, and the full Onboarding tab.

---

Read `AGENTS.md`, `docs/plan.md` and `docs/spike-results.md` before writing any code. **Priority: it works first, it looks good later.** Keep the UI functional and plain. These sections are binding: §3 rule 1 (claim labels), §4.1 (token strategy), §4.4 (`Claim`, `LLMCall`), and **§4.5.4–§4.5.5 (LLM cache and claim validation)**.

## Scope

1. **LLM client** (`src/lib/server/llm/`):
   - The `openai` npm SDK, OpenAI-compatible, configured from `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL_FAST` and `LLM_MODEL_STRONG`.
   - On a 429, retry with backoff, then fall back to the other model.
   - Count tokens for every call.
   - Prompts live as versioned files (`prompts/<id>.v<N>.md`).
2. **LLM cache:**
   - The key is `hash(complete normalized input messages + prompt id/version + model + generation params)`.
   - Store it in SQLite, and record each `LLMCall` (input hash, prompt, model, tokens, cached).
   - Don't key on file blob SHA. Parent summaries must invalidate automatically when any child summary, signal, dependency or history input changes.
3. **Evidence packets:** every LLM call gets an explicit evidence packet, which is a list of items with stable IDs. Items are:
   - code excerpts with `{snapshot_id, path, start, end, text}`;
   - commits with `{sha, message}`;
   - signals;
   - child claims.

   The prompt tells the model to cite **only** by evidence-item ID.
4. **Claim schema:**

   ```
   {text, status: verified|inferred|unknown, confidence, basis: code_fact|commit_statement|comment_statement|inference, citations[]}
   ```

   The system prompt requires:
   - "Unknown" whenever the evidence is insufficient;
   - Verified only for facts the cited evidence directly states;
   - rationale and intent claims are Inferred unless a comment or commit message states them.
5. **Claim validator** (`src/lib/server/evidence/`), implementing plan §4.5.5 exactly:
   - Citations must resolve in the snapshot (path exists, line range is valid, SHA exists).
   - Citations must be in the call's evidence packet.
   - Quoted code must appear in the cited lines.
   - `verified` requires a `basis` other than `inference` and a valid citation. Otherwise it's downgraded to `inferred`.
   - `inferred` with no valid citation is downgraded to `unknown`.
   - Parent claims can't be more certain than their child claims.
   - Log every downgrade, and show a count in the scan stats.
6. **Stage 5: summaries**, bottom-up (file → component → system):
   - use skeletons (signatures, comments, macros/constants, signals, a git summary);
   - include full bodies only for the top-N critical symbols;
   - enforce a hard per-scan token budget;
   - use the fast model for file summaries and the strong model for components and the system.
   - **Measure** the actual ratio of skeleton tokens to raw tokens, and report it. It replaces the "10–20%" estimate in the plan.
7. **Stage 6: docs.** Generate the onboarding pack (plan §5 Tab 1):
   - system overview with a Mermaid component diagram;
   - components;
   - critical-parts register;
   - external interfaces;
   - timing and HW assumptions;
   - open questions / unknowns;
   - **scope and coverage**;
   - reading order.

   Every statement is a validated claim.
8. **Stage 7: search index.** Build SQLite FTS5 over AST chunks (function/struct level), symbol names, summaries, and commit messages.
9. **Tab 1 UI:**
   - render the pack;
   - make the Verified / Inferred / Unknown labels visually distinct, and show confidence;
   - citations open the code viewer at the right snapshot, with the lines highlighted, plus a GitHub permalink pinned to the commit SHA;
   - put Ask-the-author on every citation;
   - show a token counter and the downgrade count;
   - add "Export Markdown".

## Out of scope

The PR review engine (02), graph rendering (03), and the chat agent (04).

## Quality bar

- Write vitest tests for the validator:
  - a verified claim whose citation isn't in the evidence packet is downgraded;
  - a real-but-unrelated citation with a quote that doesn't match is downgraded;
  - `basis: inference` marked verified is downgraded to inferred;
  - an inferred claim with no citation becomes unknown;
  - a parent can't be more certain than its children.
- Write vitest tests for the cache: identical input is a hit; changing a child summary misses the parent.
- Scan the demo target end to end and report:
  - tokens used;
  - the measured skeleton ratio;
  - cache hit rate on a second run (should be about 100%);
  - the claim counts by status;
  - the downgrade count;
  - 5 sample claims from the critical-parts register with their citations.
- Update `AGENTS.md` and tick off `docs/plan.md` §7.
