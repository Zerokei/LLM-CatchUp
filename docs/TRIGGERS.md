# CatchUp Scheduled Triggers

BabaDuck starts each scheduled run in the published `CatchUp` Codex Cloud environment. One unified prompt routes the daily, repair, weekly, and monthly work.

## Codex Cloud report schedule (Asia/Shanghai)

| Automation | Schedule | Source-of-truth prompt |
|---|---|---|
| CatchUp Report Scheduler | Every day at 20:30 and 23:30 | `docs/prompts/report-scheduler.md` |

The scheduler routes work as follows:

| Slot | Work |
|---|---|
| Daily 20:30 | Daily analyzer main attempt. |
| Daily 23:30 | Idempotent daily retry, then repair at most one older incomplete/fallback date. |
| Tuesday and Wednesday 23:30 | Also run the weekly prompt; Wednesday retries the same completed week. |
| 2nd and 3rd day of each month at 23:30 | Also run the monthly prompt; day 3 retries the same completed month. |

Each cloud run records the combined result. The scheduler checks the runtime before doing work so a legacy Mac heartbeat using the repository prompt skips analysis and publication.

The automation prompt must remain a short pointer to `docs/prompts/report-scheduler.md`. The scheduler and every child workflow live in `docs/prompts/`; never paste a second copy into the automation.

## GitHub Actions safety chain (America/Los_Angeles)

| Workflow | Schedule | Purpose |
|---|---|---|
| `.github/workflows/daily-fetch.yml` | 00:37, retry 03:17 | Produce the committed fetch-cache for the most recently completed Pacific day. |
| `.github/workflows/fallback-report.yml` | 06:30, retry 09:30 | Publish a title+link fallback when no report exists; both runs are idempotent. |
| `.github/workflows/build-report.yml` | On pushes under `data/analysis-cache/**` | Render formal daily markdown/HTML, update history and health, rebuild RSS, and push the result. |

The normal order is fetch → daily analyzer → fallback floor → same-date analyzer retry → delayed repair. Weekly and monthly publish only after their complete target windows contain formal rather than fallback daily files.

Use the cloud schedule to change production times. Retire a legacy Mac heartbeat from its own device after confirming its automation ID and target thread.
