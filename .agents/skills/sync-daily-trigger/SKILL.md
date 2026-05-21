---
name: sync-daily-trigger
description: Use when the live CatchUp daily Codex automation needs to be verified or repaired, especially after automation recreation, schedule changes, workspace changes, or docs/prompts/daily-trigger.md path changes.
disable-model-invocation: true
---

# sync-daily-trigger

Verifies or repairs the live CatchUp daily Codex automation so it executes `docs/prompts/daily-trigger.md` from the repo.

## Why this skill exists

The previous scheduled routine embedded the full prompt, so every prompt edit required a sync. The Codex automation should instead keep a short prompt that tells the job to execute `docs/prompts/daily-trigger.md` from the repo. That makes the repo file the real source of truth: after prompt edits are committed and pushed, no automation update is needed unless the automation wiring itself changed.

**Prompt shape (as of 2026-04-22):** the daily prompt is now "analysis-only" — it produces `data/analysis-cache/{date}.json` and exits. A separate GH Actions workflow (`build-report.yml`) renders the final markdown report and updates history/health. If you're reading the prompt and it looks much shorter than the weekly/monthly ones, that's intentional — don't restore the removed steps.

## Procedure

### 1. Find the existing daily automation

Inspect `${CODEX_HOME:-$HOME/.codex}/automations/*/automation.toml` and find the automation with a name matching `CatchUp Daily Analyzer`.

Record:
- `id`
- `name`
- `rrule`
- `cwds`
- `executionEnvironment`
- `model`
- `reasoningEffort`
- `status`

Do NOT hardcode the automation ID in this skill — the user may re-create the automation and the ID will change.

### 2. Verify the local prompt file

```bash
test -f docs/prompts/daily-trigger.md && head -5 docs/prompts/daily-trigger.md
```

Confirm the file exists and starts with the CatchUp daily trigger heading.

### 3. Call automation_update

Use the `automation_update` tool with `mode: "update"` and preserve every existing schedule/workspace field unless the user asked to change it.

```json
{
  "mode": "update",
  "kind": "cron",
  "id": "<id from step 1>",
  "name": "CatchUp Daily Analyzer",
  "prompt": "Execute `docs/prompts/daily-trigger.md` as the CatchUp daily analyzer task. Treat that file as the source-of-truth prompt, follow it straight through, and report the final status.",
  "rrule": "<preserved>",
  "cwds": "<preserved>",
  "executionEnvironment": "<preserved>",
  "model": "<preserved>",
  "reasoningEffort": "<preserved>",
  "status": "<preserved>"
}
```

### 4. Verify the response

- The returned automation should still point at this repo and keep the original schedule.
- The prompt should tell the automation to execute `docs/prompts/daily-trigger.md`, not paste a stale copy of the old trigger body.
- If the update creates a duplicate automation instead of updating the existing one, pause and ask the user which one to keep.

### 5. Report

Print a concise summary to the user: "Verified/repaired daily automation <id>. It points at docs/prompts/daily-trigger.md. Schedule preserved: <rrule>."

## Common pitfalls

- **Creating duplicates**: inspect existing automation TOMLs before calling create. Prefer updating `CatchUp Daily Analyzer`.
- **Dropping schedule/workspace fields**: preserve `rrule`, `cwds`, `executionEnvironment`, `model`, `reasoningEffort`, and `status` unless the user asked to change them.
- **Pasting stale prompt bodies**: keep the automation prompt as a pointer to `docs/prompts/daily-trigger.md`; the repo file remains the source of truth after commit/push.
- **Weekly/monthly automations drift the same way**: this skill only syncs daily. If you edit `weekly-trigger.md` or `monthly-trigger.md`, update those automations with the same pattern and their own names.
