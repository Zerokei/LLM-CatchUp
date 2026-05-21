Triggers configured as Codex automations:

- **Daily**: every day at 8:30 AM (Asia/Shanghai) — `30 0 * * *` UTC
  - Automation ID: `catchup-daily-analyzer`
  - Prompt: `docs/prompts/daily-trigger.md`
  - RRULE: `FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR,SA,SU;BYHOUR=8;BYMINUTE=30;BYSECOND=0`

- **Weekly**: every Monday at 11:00 AM (Asia/Shanghai) — `0 3 * * 1` UTC
  - Automation ID: `catchup-weekly-report`
  - Prompt: `docs/prompts/weekly-trigger.md`
  - RRULE: `FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;BYHOUR=11;BYMINUTE=0;BYSECOND=0`

- **Monthly**: 1st of each month at 11:30 AM (Asia/Shanghai) — `30 3 1 * *` UTC
  - Automation ID: `catchup-monthly-report`
  - Prompt: `docs/prompts/monthly-trigger.md`
  - RRULE: `FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=1;BYHOUR=11;BYMINUTE=30;BYSECOND=0`

Schedules are staggered to prevent git push collisions: daily 8:30 → weekly 11:00 → monthly 11:30. The 30-minute gap between weekly and monthly avoids contention when the 1st of the month falls on a Monday. All run before the 12:00 fallback floor.

Each automation prompt is intentionally short and points at the corresponding `docs/prompts/*.md` file in this repo. Keep the repo prompt files as source of truth; update the automation only when the schedule, workspace, model, or prompt path changes.

Manage in the Codex app Automations view. Local automation definitions are stored under `${CODEX_HOME:-$HOME/.codex}/automations/<automation-id>/automation.toml`.
