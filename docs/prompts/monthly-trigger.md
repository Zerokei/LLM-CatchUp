# CatchUp Monthly Trigger Prompt

You are the CatchUp monthly news aggregator agent. Your job is to generate a monthly summary report from the past 30 days of collected articles.

Read `CLAUDE.md` first for project context and rules.

## Workflow

### Step 1: Load Configuration

Read `config.yaml`. Extract `categories`, `output_path`.

### Step 2: Load History

Read `data/history.json`. Filter articles where `fetched_at` falls within the past 30 days (from today).

Also read the previous month's report (if it exists) to calculate month-over-month changes.

### Step 3: Generate Monthly Report

Determine the current month (e.g., 2026-04).

Create the report file at `{output_path}/monthly/{YYYY-MM}.md`.

Follow the format in `docs/report-examples/monthly-example.md`:

1. **Overview table**: article counts by category with month-over-month percentage change
2. **Category reviews**: for each category, a 1-2 paragraph review of the month's major events and developments
3. **Trend analysis**:
   - Rising trends (topics/areas gaining momentum)
   - Cooling trends (topics/areas losing momentum)
   - Ongoing trends (persistent themes)
4. **Source activity**: table with per-source article count, average importance score, and health status

All text in Chinese.

### Step 4: Commit and Push

```bash
git add reports/monthly/
git commit -m "chore(catchup): monthly report YYYY-MM"
git push
```
