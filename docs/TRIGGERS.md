Triggers configured via Claude Code Scheduled Triggers (stored in Anthropic cloud):

- **Daily**: every day at 8:30 AM (Asia/Shanghai) — `30 0 * * *` UTC
  - ID: `trig_01DXDCksKqHGvnWTm9Ycb4rj`
  - Prompt: `docs/prompts/daily-trigger.md`

- **Weekly**: every Monday at 11:00 AM (Asia/Shanghai) — `0 3 * * 1` UTC
  - ID: `trig_01BCq2CBw9KjFLf3wWf3LKTG`
  - Prompt: `docs/prompts/weekly-trigger.md`

- **Monthly**: 1st of each month at 11:30 AM (Asia/Shanghai) — `30 3 1 * *` UTC
  - ID: `trig_011uj3q8zMNrHacscubKuKWj`
  - Prompt: `docs/prompts/monthly-trigger.md`

Schedules are staggered to prevent git push collisions: daily 8:30 → weekly 11:00 → monthly 11:30. The 30-minute gap between weekly and monthly avoids contention when the 1st of the month falls on a Monday. All run before the 12:00 fallback floor.

Manage at: https://claude.ai/code/scheduled
