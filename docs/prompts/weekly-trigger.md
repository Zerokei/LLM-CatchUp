# CatchUp Weekly Trigger Prompt

You are the CatchUp weekly news aggregator agent. Generate a weekly summary covering **the most recently completed ISO week** (Mon–Sun, Asia/Shanghai), split across **two** markdown files: an editorial report (read by subscribers and shown on the website) and an ops sidecar (counts only — not surfaced to readers).

Read `CLAUDE.md` first for project context.

## Workflow

### Step 1: Load configuration

Read `config.yaml` for `categories` and `output_path`.

### Step 2: Determine the target week (ISO-aligned)

The trigger runs Monday morning Asia/Shanghai. The target is **the ISO week that just ended** — never the in-progress week.

Compute as follows (all timestamps Asia/Shanghai):

1. Let `now` = current time. Let `today` = `now`'s date.
2. Let `last_monday` = the most recent **Monday** strictly before `today` (not `today` itself even if today is Monday). Equivalently: `today - ((today.weekday + 6) % 7 + 1)` days where Monday=0; or simply "today minus 7 days" when today is a Monday.
3. `target_week_start` = `last_monday` at 00:00:00 Asia/Shanghai.
4. `target_week_end` = `target_week_start + 7 days` (exclusive).
5. `target_label` = `{YYYY}-W{NN}` from the ISO calendar of `target_week_start` (since it's a Monday, the ISO week is unambiguous).
6. `target_range` = `{MM}/{DD} - {MM}/{DD}` from `target_week_start` to `target_week_start + 6 days` (inclusive Sunday).

**Sanity check before continuing.** Verify the range spans exactly 7 days Mon→Sun, and matches one of these known anchors for 2026:

| ISO label | Date range |
|-----------|-----------|
| 2026-W15 | 04/06 - 04/12 |
| 2026-W16 | 04/13 - 04/19 |
| 2026-W17 | 04/20 - 04/26 |
| 2026-W18 | 04/27 - 05/03 |

If the computed range does NOT have the form `Mon/DD - Sun/DD` (7 consecutive days, Monday-Sunday), abort and re-derive — the report MUST NOT use a half-week or off-by-one range.

### Step 3: Load history into the target window

Read `data/history.json`. Filter to articles whose `fetched_at` falls in `[target_week_start, target_week_end)` (Asia/Shanghai). Use this filtered list for everything below — do NOT use a vague "past 7 days from now" filter, which will leak in or out the ISO week boundary.

### Step 4: Write the editorial report

Path: `{output_path}/weekly/{target_label}.md`

If the file already exists, abort cleanly — this run has already produced output for this week. Do NOT overwrite.

Structure (in this order):

1. `# CatchUp 周报 — {target_label} ({target_range})`

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

Path: `{output_path}/weekly/{target_label}.ops.md`

Structure:

1. `# CatchUp 周报 · 运维数据 — {target_label}`
2. `## 本周概览` — short prose: total articles, distinct sources covered. Followed by a category table:

```
| 分类 | 数量 | 趋势 |
|------|------|------|
| 模型发布 | N | ↑/↓/→ |
...
```

The 趋势 column compares to the previous week's count. The previous-week label is `{YYYY}-W{NN-1}` derived from `target_week_start - 7 days` (handle year rollover via the ISO calendar). If `reports/weekly/{prev_label}.ops.md` exists, parse its 本周概览 table for prior counts and compute deltas (`↑` if up, `↓` if down, `→` if equal). If not available (first weekly run, missing prior sidecar), mark every cell as `—` and add a one-line note under the table: `> 注：上周（{prev_label}）报告缺失，无法计算环比。`

### Step 6: Commit and push

```bash
git add reports/weekly/
git commit -m "chore(catchup): weekly report {target_label}"
git push
```
