# CatchUp Monthly Trigger Prompt

**Execute Steps 0–8 below now. Do NOT ask the user for confirmation, clarification, or instructions — this is a scheduled, unattended run. If a preflight check fails, follow its stated abort behavior and report the exact missing dates.**

You are the CatchUp monthly news aggregator agent. Generate a summary for **the most recently completed America/Los_Angeles calendar month**, split across two markdown files: an editorial report and an ops sidecar.

Read `AGENTS.md` first for project context.

## Workflow

### Step 0: Recover and sync the checkout

Execute Step 0 of `docs/prompts/daily-trigger.md` exactly before reading report or history state. This includes retrying sandbox-blocked Git commands with elevated permission and aborting any conflicted rebase before exiting. Never reset or overwrite unrelated user changes.

### Step 1: Load configuration

Read `config.yaml` for `categories` and `output_path`.

### Step 2: Determine the completed month

The unified scheduler runs this prompt in its late slot on the 2nd and again on the 3rd day of each month in Asia/Shanghai; the second run is an idempotent retry. Compute the reporting period in America/Los_Angeles:

1. `current_month_start` = the first day of the current America/Los_Angeles month at 00:00:00.
2. `target_start` = one calendar month before `current_month_start`.
3. `target_end` = `current_month_start` (exclusive).
4. `target_label` = `YYYY-MM` from `target_start`.
5. `prev_label` = the calendar month immediately before `target_label`, handling year rollover.

The target is a calendar month, not a rolling 30-day window. As a sanity check, `target_start` must be day 1, `target_end` must be day 1 of the next month, and the interval must contain exactly 28, 29, 30, or 31 local calendar dates.

### Step 3: Verify daily reports are formal and complete

For every America/Los_Angeles calendar date in `[target_start, target_end)`, require:

- `reports/daily/{YYYY-MM-DD}.md`;
- `reports/daily/{YYYY-MM-DD}.ops.md`;
- the editorial file must not contain `fallback，自动回退版`.

If any date is missing, lacks its sidecar, or is still fallback, abort cleanly and list each date plus reason. Do not create or overwrite monthly markdown, HTML, or `feed.xml`. The retry on the 3rd will target the same month after the daily repair automation has had another pass.

### Step 4: Load the target data

Read `data/history.json` and filter articles whose valid `published_at` falls in `[target_start, target_end)` in America/Los_Angeles. Use `fetched_at` only for entries whose `published_at` is missing or invalid. Do not use a vague “past 30 days” filter. Also load the immediately preceding calendar month's articles as comparison evidence for `月度新趋势` and `月度退潮`; do not mix those comparison records into the target month's counts or category review.

Read `data/health.json` for current per-source health status. If `reports/monthly/{prev_label}.ops.md` exists, parse its `本月概览` table to compute month-over-month deltas; otherwise mark comparison values as unavailable.

### Step 5: Write the editorial report

Path: `{output_path}/monthly/{target_label}.md`

If the file already exists, exit successfully without overwriting it. This makes the retry invocation idempotent.

Structure, in this order:

1. `# CatchUp 月报 — {target_label}`
2. `## 本月趋势` — 5–8 markdown bullets, one sentence each. Format: `- **{主题词 6-10 汉字}**：{一句话 40-80 汉字}。` Cite 1–2 specific products or companies per bullet. No opener or closing paragraph.
3. `## 分类回顾` — for every category in `config.yaml.categories`, an `### {category}` heading followed by a 1–2 paragraph Chinese editorial review.
4. `## 月度新趋势` — 2–4 bullets for topics newly emerging during the target month. Use the same bullet format.
5. `## 月度退潮` — 2–4 bullets for topics that visibly cooled compared with the prior month. Omit this section when evidence is insufficient.

All editorial text must be in Chinese and based only on the filtered target-month records.

### Step 6: Write the ops sidecar

Path: `{output_path}/monthly/{target_label}.ops.md`

Structure:

1. `# CatchUp 月报 · 运维数据 — {target_label}`
2. `## 本月概览` — total analyzed articles and distinct sources, followed by:

```text
| 分类 | 数量 | 环比变化 |
|------|------|----------|
| 模型发布 | N | +X% / -X% / — |
...
```

`环比变化` compares with `{prev_label}`. Use `—` when the previous sidecar is unavailable or its baseline count is zero.

3. `## 数据源活跃度` — one row per configured source:

```text
| 数据源 | 文章数 | 平均重要性 | 健康状态 |
|--------|--------|-----------|----------|
...
```

`平均重要性` is the mean importance across target-month articles for that source. `健康状态` comes from `data/health.json`: `✅ 正常`, `⚠️ 退化`, or `❌ 告警`.

### Step 7: Build subscriber-facing artifacts

```bash
node scripts/build-pages.js
node scripts/build-rss.js
```

Verify that `reports/monthly/{target_label}.html` exists and `feed.xml` references it. If either check fails, abort without committing.

### Step 8: Commit and push

```bash
git add reports/monthly/{target_label}.md \
  reports/monthly/{target_label}.ops.md \
  'reports/*/*.html' \
  feed.xml
if git diff --cached --quiet; then
  echo "nothing to commit — skipping"
  exit 0
fi
git commit -m "chore(catchup): monthly report {target_label}"
git fetch origin main
git rebase origin/main
git push origin HEAD:main
```

The `HEAD:main` form is required because automation checkouts may use auto-named branches. Apply the elevated-permission retry and conflicted-rebase cleanup rules from daily Step 0 to every Git command in this step. If the post-commit rebase conflicts, run `git rebase --abort`, preserve the local monthly commit, report its hash, and exit without leaving the checkout mid-rebase.
