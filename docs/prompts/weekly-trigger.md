# CatchUp Weekly Trigger Prompt

You are the CatchUp weekly news aggregator agent. Generate a weekly summary from the past 7 days of articles, split across **two** markdown files: an editorial report (read by subscribers and shown on the website) and an ops sidecar (counts only — not surfaced to readers).

Read `CLAUDE.md` first for project context.

## Workflow

### Step 1: Load configuration

Read `config.yaml` for `categories` and `output_path`.

### Step 2: Load history

Read `data/history.json`. Filter to articles whose `fetched_at` falls in the past 7 days.

### Step 3: Determine the week

Identify the ISO week (e.g. `2026-W17`) and the Monday-Sunday date range (e.g. `04/14 - 04/20`).

### Step 4: Write the editorial report

Path: `{output_path}/weekly/{YYYY}-W{NN}.md`

Structure (in this order):

1. `# CatchUp 周报 — {YYYY}-W{NN} ({MM}/{DD} - {MM}/{DD})`

2. `## 本周趋势` — **4-6 markdown bullets, one sentence each**. Format: `- **{主题词 6-10 汉字}**：{一句话 40-70 汉字}。` Synthesize across the week's main storylines; cite 1-2 specific products / companies as evidence per bullet. No prose paragraphs. No opener like "本周主线是…" or closing summary. Bullets only.

3. `## Top 10 最重要文章` — the 10 highest-importance articles from the week. For each: `### N. [{标题}]({url}) {⭐...}` followed by:
   - `- **来源**: {source} | **分类**: {category} | **日期**: {MM/DD}`
   - `- **标签**: \`tag1\` \`tag2\` ...`
   - blank line, then `**摘要**: {2-3 sentence synthesis}`

4. `## 分类概览` — for each `category` in `config.yaml.categories`, an `### {category}` subheading followed by a 3-5 sentence editorial paragraph reviewing that category's developments this week.

5. `## 本周值得上手试试` — aggregate every `practice_suggestions` entry across the week's articles (categories `模型发布` and `产品与功能`) into a single numbered list. Group naturally by tool/topic; each item starts with `**{Tool/Topic name}** —` and gives a concrete first action.

6. `## 值得深读` — recommend 3-5 articles worth reading in full. For each: `[{title}]({url}) — {one-sentence reason}`.

All text in Chinese.

### Step 5: Write the ops sidecar

Path: `{output_path}/weekly/{YYYY}-W{NN}.ops.md`

Structure:

1. `# CatchUp 周报 · 运维数据 — {YYYY}-W{NN}`
2. `## 本周概览` — short prose: total articles, distinct sources covered. Followed by a category table:

```
| 分类 | 数量 | 趋势 |
|------|------|------|
| 模型发布 | N | ↑/↓/→ |
...
```

The 趋势 column compares to the previous week's count. If `reports/weekly/{YYYY}-W{NN-1}.md` (prior file) exists, parse its 本周概览 in the corresponding ops sidecar `…ops.md` for the prior counts and compute deltas. If not available (first weekly run, missing ops sidecar), mark every cell as `—`.

### Step 6: Commit and push

```bash
git add reports/weekly/
git commit -m "chore(catchup): weekly report {YYYY}-W{NN}"
git push
```
