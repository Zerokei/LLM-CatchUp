# CatchUp Weekly Trigger Prompt

**Execute Steps 0–8 below now. Do NOT ask the user for confirmation, clarification, or instructions — this is a scheduled, unattended run. If a preflight check fails, follow its stated abort behavior and report the exact missing dates.**

You are the CatchUp weekly news aggregator agent. Generate a weekly summary covering **the most recently completed ISO week** (Mon–Sun, America/Los_Angeles), split across **two** markdown files: an editorial report (read by subscribers and shown on the website) and an ops sidecar (counts only — not surfaced to readers).

Read `AGENTS.md` first for project context.

## Workflow

### Step 0: Recover and sync the checkout

Execute Step 0 of `docs/prompts/daily-trigger.md` exactly before reading report or history state. This includes retrying sandbox-blocked Git commands with elevated permission and aborting any conflicted rebase before exiting. Never reset or overwrite unrelated user changes.

### Step 1: Load configuration

Read `config.yaml` for `categories` and `output_path`.

### Step 2: Determine the target week (ISO-aligned)

The unified scheduler runs this prompt in its Tuesday and Wednesday late slots (Asia/Shanghai). Wednesday is an idempotent retry. Both invocations target **the ISO week that just ended** — never the in-progress week.

Compute as follows (all timestamps America/Los_Angeles):

1. Let `now` = current time. Let `today` = `now`'s America/Los_Angeles date.
2. Let `current_week_start` = the Monday 00:00:00 America/Los_Angeles at the start of the ISO week containing `today`.
3. `target_week_start` = `current_week_start - 7 days`.
4. `target_week_end` = `current_week_start` (exclusive).
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

### Step 3: Verify daily reports are complete

Before reading history or writing any weekly output, verify that all seven daily editorial reports exist for the target week:

```text
reports/daily/{YYYY-MM-DD}.md
```

Check every America/Los_Angeles calendar date from `target_week_start` through `target_week_start + 6 days`, inclusive. For each date, require both the editorial `.md` and `.ops.md` sidecar, and reject an editorial file containing `fallback，自动回退版`. If any date is missing, lacks its sidecar, or is still fallback, abort cleanly with a message listing the date and reason. Do NOT write weekly markdown, HTML, or `feed.xml`. The Wednesday retry will try the same week again after the daily repair automation has had another pass.

This gate ensures weekly aggregation only runs after the formal daily reporter has populated both the report files and `data/history.json`.

### Step 4: Load history into the target window

Read `data/history.json`. Filter to articles whose `published_at` falls in `[target_week_start, target_week_end)` in America/Los_Angeles. Use `fetched_at` only as a fallback for entries with missing or invalid `published_at`.

This is intentional: weekly reports are editorial period summaries, so an article belongs to the week it was published, not the later day it was fetched or backfilled into history. A delayed daily backfill may write `fetched_at` after the Monday boundary; using `fetched_at` as the primary weekly key would incorrectly exclude the prior week's articles.

Use this filtered list for everything below — do NOT use a vague "past 7 days from now" filter, which will leak in or out the ISO week boundary.

### Step 5: Write the editorial report

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

### Step 6: Write the ops sidecar

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

### Step 7: Build subscriber-facing artifacts

The homepage reads `feed.xml`, and report links point to rendered sibling HTML files. Generate both before committing:

```bash
node scripts/build-pages.js
node scripts/build-rss.js
```

Verify that `reports/weekly/{target_label}.html` exists and that `feed.xml` contains `reports/weekly/{target_label}.html`. Abort without committing if either check fails.

### Step 8: Commit and push

```bash
git add reports/weekly/{target_label}.md \
  reports/weekly/{target_label}.ops.md \
  'reports/*/*.html' \
  feed.xml
if git diff --cached --quiet; then
  echo "nothing to commit — skipping"
  exit 0
fi
git commit -m "chore(catchup): weekly report {target_label}"
git fetch origin main
git rebase origin/main
git push origin HEAD:main
```

The `HEAD:main` form is required. The Codex automation sandbox checks out an auto-named working branch (e.g. `codex/xxx` or `main-xxxx`), so a bare `git push` lands the commit on that working branch instead of `main` and the report is invisible to subscribers.

Apply the elevated-permission retry and conflicted-rebase cleanup rules from daily Step 0 to every Git command in this step. If the post-commit rebase conflicts, run `git rebase --abort`, preserve the local weekly commit, report its hash, and exit without leaving the checkout mid-rebase.
