# CatchUp Scheduled Triggers

All Codex automations below are heartbeat automations attached to the pinned `CatchUp Daily Report` task. Their prompts are intentionally short pointers to version-controlled files in `docs/prompts/`; never paste a second copy of a workflow into an automation.

## Codex automations (Asia/Shanghai)

| Automation | Schedule | Source-of-truth prompt | Purpose |
|---|---|---|---|
| CatchUp Daily Analyzer | Every day at 20:30 and 23:30 | `docs/prompts/daily-trigger.md` | Main analysis plus same-date retry; the second run resumes missing URLs or re-triggers the reporter when a fallback remains. |
| CatchUp Daily Repair | Every day at 10:00 | `docs/prompts/backfill-trigger.md` | Inspect a 40-day window and repair at most one missing, partial, or fallback day. |
| CatchUp Weekly Report | Tuesday and Wednesday at 11:30 | `docs/prompts/weekly-trigger.md` | Generate the most recently completed Pacific ISO week; Wednesday retries idempotently. |
| CatchUp Monthly Report | 2nd and 3rd day of each month at 13:30 | `docs/prompts/monthly-trigger.md` | Generate the most recently completed Pacific calendar month; the 3rd retries idempotently. |

All four automations target the same pinned task and use failed-run-only notifications. Successful run details still accumulate in that task without producing routine success notifications.

## GitHub Actions safety chain (America/Los_Angeles)

| Workflow | Schedule | Purpose |
|---|---|---|
| `.github/workflows/daily-fetch.yml` | 00:37, retry 03:17 | Produce the committed fetch-cache for the most recently completed Pacific day. |
| `.github/workflows/fallback-report.yml` | 06:30, retry 09:30 | Publish a title+link fallback when no report exists; both runs are idempotent. |
| `.github/workflows/build-report.yml` | On pushes under `data/analysis-cache/**` | Render formal daily markdown/HTML, update history and health, rebuild RSS, and push the result. |

The normal order is fetch → analyzer → fallback floor → same-date analyzer retry → delayed repair. Weekly and monthly run only after their target daily files are formal rather than fallback, so incomplete history cannot silently produce an incomplete aggregate.

Local automation definitions live under the Codex automations directory. When repairing them, discover IDs from the live definitions rather than relying on old IDs in documentation.
