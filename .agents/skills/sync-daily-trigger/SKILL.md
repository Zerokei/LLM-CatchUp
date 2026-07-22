---
name: sync-daily-trigger
description: Use when the live CatchUp unified Codex report automation needs to be verified or repaired, especially after automation recreation, schedule changes, task changes, or docs/prompts/report-scheduler.md path changes.
disable-model-invocation: true
---

# sync-daily-trigger

Verifies or repairs the live CatchUp report heartbeat so it executes `docs/prompts/report-scheduler.md` from the repo. The scheduler invokes daily, repair, weekly, and monthly prompts inside one pinned task.

## Why this skill exists

The previous scheduled routine embedded the full prompt, so every prompt edit required a sync. The Codex automation should instead keep a short prompt that tells the job to execute `docs/prompts/report-scheduler.md` from the repo. That makes the repo files the real source of truth: after prompt edits are committed and pushed, no automation update is needed unless the automation wiring itself changed.

Codex allows only one active heartbeat per task. Because the user wants all report results in the pinned `CatchUp Daily Report` task, do not create separate weekly/monthly heartbeats for that task. The unified scheduler performs the routing.

**Prompt shape (as of 2026-07-22):** the scheduler routes one heartbeat into the analysis-only daily prompt plus repair/weekly/monthly prompts. Daily produces `data/analysis-cache/{date}.json`; a separate GH Actions workflow (`build-report.yml`) renders the final markdown report and updates history/health. Do not move those deterministic steps back into the daily analyzer.

## Procedure

### 1. Find the existing report automation

Inspect `${CODEX_HOME:-$HOME/.codex}/automations/*/automation.toml` and find the automation with a name matching `CatchUp Report Scheduler`. For migration only, accept a legacy name matching `CatchUp Daily Analyzer` or `CatchUp Daily Report`, then rename it during update.

Record:
- `id`
- `name`
- `rrule`
- `status`
- `target_thread_id`
- `notification_policy`

Do NOT hardcode the automation ID in this skill — the user may re-create the automation and the ID will change.

### 2. Verify the local prompt files

```bash
test -f docs/prompts/report-scheduler.md && head -5 docs/prompts/report-scheduler.md
test -f docs/prompts/daily-trigger.md && head -5 docs/prompts/daily-trigger.md
```

Confirm both files exist, the scheduler starts with the CatchUp unified scheduler heading, and it explicitly invokes `docs/prompts/daily-trigger.md`.

### 3. Call automation_update

Use the `automation_update` tool with `mode: "update"` and preserve every existing schedule/workspace field unless the user asked to change it.

```json
{
  "mode": "update",
  "kind": "heartbeat",
  "id": "<id from step 1>",
  "name": "CatchUp Report Scheduler",
  "prompt": "Execute `docs/prompts/report-scheduler.md` as the CatchUp unified report scheduler. Treat that repo file as the source-of-truth prompt, follow it straight through, and report the combined final status.",
  "rrule": "<preserved>",
  "status": "<preserved>",
  "targetThreadId": "<preserved pinned task id>",
  "notificationPolicy": "<preserved>"
}
```

### 4. Verify the response

- The returned automation should still target the pinned `CatchUp Daily Report` task and keep the requested schedule.
- The prompt should tell the automation to execute `docs/prompts/report-scheduler.md`, not paste stale copies of any trigger body.
- If the update creates a duplicate automation instead of updating the existing one, pause and ask the user which one to keep.

### 5. Report

Print a concise summary to the user: "Verified/repaired report scheduler <id>. It points at docs/prompts/report-scheduler.md and targets the pinned CatchUp Daily Report task."

## Common pitfalls

- **Creating duplicates**: inspect existing automation TOMLs before calling create. Prefer updating the existing report scheduler. A task can have only one active heartbeat.
- **Dropping schedule/task fields**: preserve `rrule`, `targetThreadId`, `notificationPolicy`, and `status` unless the user asked to change them.
- **Pasting stale prompt bodies**: keep the automation prompt as a pointer to `docs/prompts/report-scheduler.md`; the repo files remain the source of truth after commit/push.
- **Creating separate report heartbeats**: do not work around the one-heartbeat-per-task limit. The scheduler owns daily, repair, weekly, and monthly routing.
