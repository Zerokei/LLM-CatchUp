# CatchUp Daily Repair Trigger

**Execute this repair workflow now. Do NOT ask the user for confirmation, clarification, or instructions — this is a scheduled, unattended run. Never fetch or fabricate source content; repair only from committed fetch-cache files.**

You detect and repair one recent daily report that is missing, still a fallback, missing its ops sidecar, or backed by an incomplete/missing analysis-cache. The normal analyzer remains the primary path; this trigger is its delayed self-healing pass.

Read `AGENTS.md` and `docs/prompts/daily-trigger.md` first. Treat the daily prompt as the source of truth for sync, analysis, validation, clustering, report re-triggering, and commit/push behavior.

## Workflow

### Step 1: Recover and sync

Execute Step 0 of `docs/prompts/daily-trigger.md` exactly, including its elevated-permission retry and rebase-abort rules. Do not reset or overwrite unrelated user changes.

### Step 2: Find one repair target

Compute the normal daily target date: yesterday in America/Los_Angeles. The unified scheduler has already run the normal analyzer for that date, so do not select it here.

Inspect the 40 America/Los_Angeles calendar dates immediately preceding the normal target. The horizon covers an entire prior calendar month so monthly preflight gaps can self-heal. A date is repairable only when `data/fetch-cache/{date}.json` exists.

First determine whether its report output is formal: both `reports/daily/{date}.md` and `.ops.md` exist, and the editorial file does not contain `fallback，自动回退版`.

A date needs repair when:

- its report output is not formal; or
- analysis-cache is partial **and** `data/history.json` contains at least one entry with `report_date === date`, proving it was produced by the retry-safe reporter introduced on 2026-07-22.

Do not repair an older formal report merely because its analysis-cache is missing or incomplete. Reports created by the legacy pipeline may legitimately have no complete analysis-cache, and their history entries lack `report_date`; rebuilding those dates would incorrectly filter their already-reported articles.

Choose at most one date per run. First prioritize repairable dates inside the most recently completed America/Los_Angeles ISO week, oldest first, because weekly aggregation may be waiting for them. Next prioritize repairable dates inside the most recently completed America/Los_Angeles calendar month, oldest first. Otherwise choose the oldest repairable date in the window so gaps eventually drain.

If no repairable date exists, exit successfully without modifying files.

### Step 3: Run the normal analyzer for the chosen date

Set `TARGET_DATE={chosen_date}` explicitly and execute Steps 2–10 of `docs/prompts/daily-trigger.md` for that date. Do not re-run its Step 0 because Step 1 above already synchronized the checkout.

The normal workflow is intentionally idempotent:

- missing or partial analysis is resumed from fetch-cache;
- complete analysis plus a missing/fallback report updates `report_retry_requested_at`, causing `build-report.yml` to run again;
- a complete formal report exits without changes.

Do not directly edit `data/history.json`, `data/health.json`, `feed.xml`, or rendered report files. The reporter workflow owns those deterministic outputs.

### Step 4: Report final status

Report the selected date, why it needed repair, analyzed article count, whether the reporter was re-triggered, any remaining failed chunks, commit hash, and push result. If no repair was needed, say so explicitly.
