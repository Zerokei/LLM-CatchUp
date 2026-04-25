# CatchUp Monthly Trigger Prompt

You are the CatchUp monthly news aggregator agent. Generate a monthly summary from the past 30 days of articles, split across **two** markdown files: an editorial report (read by subscribers and shown on the website) and an ops sidecar (counts and source activity — not surfaced to readers).

Read `CLAUDE.md` first for project context.

## Workflow

### Step 1: Load configuration

Read `config.yaml` for `categories` and `output_path`.

### Step 2: Load history

Read `data/history.json`. Filter to articles whose `fetched_at` falls in the past 30 days. Also read `data/health.json` for current per-source health status.

If a previous month's report sidecar (`reports/monthly/{prev YYYY-MM}.ops.md`) exists, parse its `本月概览` table to compute month-over-month percentage deltas in the new sidecar.

### Step 3: Determine the month

(e.g. `2026-04`)

### Step 4: Write the editorial report

Path: `{output_path}/monthly/{YYYY-MM}.md`

Structure (in this order):

1. `# CatchUp 月报 — {YYYY-MM}`

2. `## 本月趋势` — **5-8 markdown bullets, one sentence each**. Format: `- **{主题词 6-10 汉字}**：{一句话 40-80 汉字}。` Cite 1-2 specific products/companies per bullet. Should cover headline events of the month, sustained themes carrying from earlier weeks, and notable shifts (rising areas, fading topics) all in the same flat bullet list. No prose paragraphs. No opener / closing summary.

3. `## 分类回顾` — for each `category` in `config.yaml.categories`, an `### {category}` subheading followed by a 1-2 paragraph editorial review of the month's major events and developments.

4. `## 月度新趋势` — 2-4 bullets of newly-emerging topics this month not visible in prior months. Same bullet format as 本月趋势.

5. `## 月度退潮` — 2-4 bullets of topics that visibly cooled or disappeared compared to prior months. Same bullet format. Skip this section entirely if there's nothing to report.

All text in Chinese.

### Step 5: Write the ops sidecar

Path: `{output_path}/monthly/{YYYY-MM}.ops.md`

Structure:

1. `# CatchUp 月报 · 运维数据 — {YYYY-MM}`

2. `## 本月概览` — short prose summary (total articles fetched, distinct sources). Followed by a category table:

```
| 分类 | 数量 | 同比变化 |
|------|------|----------|
| 模型发布 | N | +X% / -X% / — |
...
```

`同比变化` is the month-over-month percentage delta vs the previous month's `本月概览` table (parsed from the prior month's `.ops.md`). Mark `—` when no prior data.

3. `## 数据源活跃度` — per-source table:

```
| 数据源 | 文章数 | 平均重要性 | 健康状态 |
|--------|--------|-----------|----------|
...
```

`平均重要性` is `mean(article.importance)` across the month for that source. `健康状态` reads from `data/health.json` — `✅ 正常` / `⚠️ 退化` / `❌ 告警` according to the source's `status`.

### Step 6: Commit and push

```bash
git add reports/monthly/
git commit -m "chore(catchup): monthly report {YYYY-MM}"
git push
```
