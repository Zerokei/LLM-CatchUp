# CatchUp Scheduled Triggers

Codex permits only one active heartbeat per task. To keep every result in the pinned `CatchUp Daily Report` task, CatchUp uses one unified heartbeat rather than separate daily, repair, weekly, and monthly heartbeats.

## Unified Codex heartbeat (Asia/Shanghai)

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

The heartbeat uses failed-run-only notifications. Successful run details still accumulate in the pinned task without producing routine success notifications.

The automation prompt must remain a short pointer to `docs/prompts/report-scheduler.md`. The scheduler and every child workflow live in `docs/prompts/`; never paste a second copy into the automation.

## GitHub Actions safety chain (America/Los_Angeles)

| Workflow | Schedule | Purpose |
|---|---|---|
| `.github/workflows/daily-fetch.yml` | 00:37, retry 03:17 | Produce the committed fetch-cache for the most recently completed Pacific day. |
| `.github/workflows/fallback-report.yml` | 06:30, retry 09:30 | Publish a title+link fallback when no report exists; both runs are idempotent. |
| `.github/workflows/build-report.yml` | On pushes under `data/analysis-cache/**` | Render formal daily markdown/HTML, update history and health, rebuild RSS, and push the result. |

The normal order is fetch → daily analyzer → fallback floor → same-date analyzer retry → delayed repair. Weekly and monthly publish only after their complete target windows contain formal rather than fallback daily files.

Local automation definitions live under the Codex automations directory. Discover the live automation ID before updating it rather than relying on an old ID in documentation.
