# CatchUp Backfill Trigger Prompt

You are the CatchUp missing daily report backfill agent. Your job is to detect whether any daily reports before today are missing, backfill at most one missing report per run, update state files, and commit/push.

Read `CLAUDE.md` first for project context and rules.

## Workflow

Execute these steps in order:

### Step 1: Load Configuration And State

Read:
- `config.yaml`
- `data/history.json`
- `data/health.json`
- `docs/prompts/daily-trigger.md`
- `docs/report-examples/daily-example.md`

Use `config.yaml` for `output_path`, `sources`, `categories`, `analysis.dimensions`, `retention_days`, and `alerting`.

### Step 2: Find The Backfill Target

Get the current target report date: yesterday in America/Los_Angeles, formatted as YYYY-MM-DD.

Scan `{output_path}/daily/` for missing daily reports before the current target report date. Consider only the last 7 calendar days before the target report date.

If there are no missing reports before today:
- Do not fetch sources.
- Do not modify files.
- Report that no backfill is needed.
- Stop.

If one or more reports are missing:
- Choose the oldest missing date as the single target date for this run.
- Backfill only that one date.
- Do not generate the current target report; that report is handled by the normal daily automation.

### Step 3: Fetch Sources For The Target Date

Follow the fetching rules from `docs/prompts/daily-trigger.md`, including:
- Fetch `role: primary` sources before `role: aggregator` sources
- Use direct fetch first, with WebSearch fallback for blocked sources
- Split newsletter-style multi-topic articles into separate entries
- Deduplicate by SHA-256 of article URL
- Log source failures in `data/health.json` and continue

When searching or filtering, focus on articles published on the target date. If a source does not expose exact dates, use the best available published date metadata and snippets.

### Step 4: Deduplicate And Analyze

Follow the semantic deduplication and analysis rules from `docs/prompts/daily-trigger.md`.

Analyze only articles relevant to the target date. Use Chinese for all analysis output.

### Step 5: Generate The Backfilled Daily Report

Create the report file at `{output_path}/daily/{TARGET_DATE}.md`.

Follow `docs/report-examples/daily-example.md` exactly. The report date must be the target date, not today's date.

Sort article details by importance, highest first.

### Step 6: Update History And Health

Add newly analyzed articles to `data/history.json` under `articles`, keyed by SHA-256 of URL.

Use the real current timestamp for `fetched_at`, and preserve each article's published date when available.

Update `last_fetch` to the current ISO timestamp.

Update `data/health.json` for every source according to the health rules in `docs/prompts/daily-trigger.md`.

### Step 7: Clean Up Old Data

Remove articles from `data/history.json` where `fetched_at` is older than `retention_days` from config.

### Step 8: Handle Alerts

Follow the alert handling rules from `docs/prompts/daily-trigger.md`.

### Step 9: Commit And Push

Stage changed files:

```bash
git add data/history.json data/health.json reports/
```

Commit with:

```bash
git commit -m "chore(catchup): backfill daily report YYYY-MM-DD"
```

Replace YYYY-MM-DD with the target date.

Push the commit:

```bash
git push
```

### Step 10: Report Final Status

Report:
- Whether a missing report was found
- The target date backfilled, if any
- The report path
- Article count
- Any source failures or alerts
- Commit result
- Push result
