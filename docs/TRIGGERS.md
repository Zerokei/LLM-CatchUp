Triggers configured as Codex automations:

- **Backfill**: every day at 6:00 PM (Asia/Shanghai)
  - Automation ID: `catchup-backfill-scan`
  - Prompt: `docs/prompts/backfill-trigger.md`
  - RRULE: `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU;BYHOUR=18;BYMINUTE=0`
  - Purpose: scan the last 7 days before the current America/Los_Angeles target date and backfill at most the oldest missing daily report

- **Daily Analyzer**: every day at 6:30 PM (Asia/Shanghai) — `30 10 * * *` UTC
  - Automation ID: `catchup-daily-updates`
  - Prompt: `docs/prompts/daily-trigger.md`
  - RRULE: `FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR,SA,SU;BYHOUR=18;BYMINUTE=30;BYSECOND=0`
  - Target date: yesterday in America/Los_Angeles

- **Daily Fetch**: every day at 1:37 AM (America/Los_Angeles)
  - Workflow: `.github/workflows/daily-fetch.yml`
  - Cron: `37 1 * * *`
  - Timezone: `America/Los_Angeles`
  - Target date: yesterday in America/Los_Angeles

- **Weekly**: every Monday at 11:00 AM (Asia/Shanghai) — `0 3 * * 1` UTC
  - Automation ID: `catchup-weekly-report`
  - Prompt: `docs/prompts/weekly-trigger.md`
  - RRULE: `FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;BYHOUR=11;BYMINUTE=0;BYSECOND=0`

- **Monthly**: 1st of each month at 11:30 AM (Asia/Shanghai) — `30 3 1 * *` UTC
  - Automation ID: `catchup-monthly-report`
  - Prompt: `docs/prompts/monthly-trigger.md`
  - RRULE: `FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=1;BYHOUR=11;BYMINUTE=30;BYSECOND=0`

Schedules are staggered to prevent git push collisions: daily fetch 01:37 America/Los_Angeles → daily analyzer 18:30 Asia/Shanghai → fallback 06:00 America/Los_Angeles. Weekly and monthly reports remain at 11:00/11:30 Asia/Shanghai. The 30-minute gap between weekly and monthly avoids contention when the 1st of the month falls on a Monday.

Each automation prompt is intentionally short and points at the corresponding `docs/prompts/*.md` file in this repo. Keep the repo prompt files as source of truth; update the automation only when the schedule, workspace, model, or prompt path changes.

Manage in the Codex app Automations view. Local automation definitions are stored under `${CODEX_HOME:-$HOME/.codex}/automations/<automation-id>/automation.toml`.
