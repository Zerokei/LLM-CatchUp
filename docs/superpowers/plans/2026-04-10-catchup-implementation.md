# CatchUp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fully Claude Code native AI news aggregator that runs via Cloud Scheduled Triggers, with no external code dependencies.

**Architecture:** Git repo stores all configuration, state, and output. Cloud Scheduled Triggers execute prompts that instruct Claude to fetch sources via WebFetch, analyze content, generate markdown reports, update state files, and commit/push. CLAUDE.md provides project context; trigger prompts contain the full workflow logic.

**Tech Stack:** Claude Code, Cloud Scheduled Triggers, WebFetch, Git/GitHub, YAML config, JSON state files, Markdown reports.

---

## File Map

| File | Purpose |
|------|---------|
| `config.yaml` | Data sources, categories, analysis dimensions, alerting config |
| `data/history.json` | Analyzed article records, keyed by URL hash, for dedup and aggregation |
| `data/health.json` | Per-source health status tracking |
| `CLAUDE.md` | Project context and rules for the trigger agent |
| `docs/prompts/daily-trigger.md` | Version-controlled copy of daily trigger prompt |
| `docs/prompts/weekly-trigger.md` | Version-controlled copy of weekly trigger prompt |
| `docs/prompts/monthly-trigger.md` | Version-controlled copy of monthly trigger prompt |
| `docs/report-examples/daily-example.md` | Reference format for daily reports |
| `docs/report-examples/weekly-example.md` | Reference format for weekly reports |
| `docs/report-examples/monthly-example.md` | Reference format for monthly reports |
| `reports/daily/` | Generated daily reports (by trigger) |
| `reports/weekly/` | Generated weekly reports (by trigger) |
| `reports/monthly/` | Generated monthly reports (by trigger) |
| `.gitignore` | Ignore patterns |

---

### Task 1: Repository Foundation

**Files:**
- Create: `config.yaml`
- Create: `data/history.json`
- Create: `data/health.json`
- Create: `reports/daily/.gitkeep`
- Create: `reports/weekly/.gitkeep`
- Create: `reports/monthly/.gitkeep`
- Create: `.gitignore`

- [ ] **Step 1: Create `.gitignore`**

```
.DS_Store
*.swp
*.swo
```

- [ ] **Step 2: Create `config.yaml`**

```yaml
output_path: "./reports"
retention_days: 90

categories:
  - "模型发布"
  - "研究"
  - "产品与功能"
  - "商业动态"
  - "政策与安全"
  - "教程与观点"

analysis:
  dimensions:
    - name: tags
      prompt: "提取 3-5 个关键词标签，用于关联分析"
      type: list
      render: inline_tags

    - name: practice_suggestions
      prompt: "如果涉及可上手尝试的产品或功能，给出 1-3 条具体的实践建议，包括操作步骤"
      condition: "category in ['模型发布', '产品与功能']"
      type: list
      render: callout_block

alerting:
  consecutive_failure_threshold: 3
  method: github_issue

sources:
  - name: "Berkeley RDI"
    type: rss
    url: "https://berkeleyrdi.substack.com/feed"

  - name: "The Batch"
    type: web_scraper
    url: "https://www.deeplearning.ai/the-batch"

  - name: "OpenAI Blog"
    type: rss
    url: "https://openai.com/blog/rss.xml"

  - name: "Google AI Blog"
    type: rss
    url: "https://blog.google/technology/ai/rss/"

  - name: "Anthropic Blog"
    type: rss
    url: "https://www.anthropic.com/blog/rss.xml"
```

- [ ] **Step 3: Create `data/history.json`**

```json
{
  "articles": {},
  "last_fetch": null
}
```

- [ ] **Step 4: Create `data/health.json`**

```json
{}
```

- [ ] **Step 5: Create `.gitkeep` files for report directories**

```bash
mkdir -p reports/daily reports/weekly reports/monthly
touch reports/daily/.gitkeep reports/weekly/.gitkeep reports/monthly/.gitkeep
```

- [ ] **Step 6: Verify structure**

Run: `find . -not -path './.git/*' -not -path './.claude/*' | sort`

Expected output should show:
```
.
./.gitignore
./config.yaml
./data
./data/health.json
./data/history.json
./docs
./docs/superpowers/...
./reports
./reports/daily
./reports/daily/.gitkeep
./reports/monthly
./reports/monthly/.gitkeep
./reports/weekly
./reports/weekly/.gitkeep
```

- [ ] **Step 7: Commit**

```bash
git add .gitignore config.yaml data/ reports/
git commit -m "feat: add project config and initial data/report structure"
```

---

### Task 2: CLAUDE.md — Project Instructions

**Files:**
- Create: `CLAUDE.md`

The CLAUDE.md is the "brain" of the system. It tells the scheduled trigger agent how the project works, what rules to follow, and where everything lives.

- [ ] **Step 1: Write `CLAUDE.md`**

```markdown
# CatchUp — AI News Aggregator

An automated AI news aggregation system powered by Claude Code Cloud Scheduled Triggers.

## How It Works

This repo IS the entire system. There is no application code. Cloud Scheduled Triggers run prompts that instruct Claude to:
1. Fetch sources listed in `config.yaml` using WebFetch
2. Analyze articles (summarize, categorize, score importance, suggest practice)
3. Generate markdown reports in `reports/`
4. Persist state to `data/history.json` and `data/health.json`
5. Commit and push

## Key Files

- `config.yaml` — all configuration (sources, categories, analysis dimensions, alerting)
- `data/history.json` — article records keyed by SHA-256 of URL, used for deduplication and report aggregation
- `data/health.json` — per-source health status (healthy / degraded / alert)
- `reports/daily/YYYY-MM-DD.md` — daily reports
- `reports/weekly/YYYY-WNN.md` — weekly reports
- `reports/monthly/YYYY-MM.md` — monthly reports
- `docs/prompts/` — version-controlled trigger prompts (source of truth for trigger configuration)
- `docs/report-examples/` — reference format for each report type

## Rules for Trigger Agents

### Fetching
- Read `config.yaml` for the source list
- For `type: rss` sources: WebFetch the URL, parse the XML to extract article entries
- For `type: web_scraper` sources: WebFetch the URL, extract article titles/links/content from HTML
- Only process articles not already in `data/history.json` (dedup by SHA-256 hash of article URL)
- If a source fails, log the error in `data/health.json` and continue with other sources

### Analysis
- For each new article, produce: summary (2-3 sentences), category (from config categories list), importance (1-5)
- Apply each analysis dimension from `config.yaml` `analysis.dimensions`, respecting `condition` fields
- Use Chinese for all analysis output

### Report Generation
- Follow the format in `docs/report-examples/` for the corresponding report type
- Daily: all today's articles sorted by importance
- Weekly: aggregate from `data/history.json` articles in the past 7 days
- Monthly: aggregate from `data/history.json` articles in the past 30 days

### Health Monitoring
- After fetching, update `data/health.json` for every source
- Success: set status to "healthy", reset consecutive_failures to 0
- Failure: increment consecutive_failures, set appropriate status
- If consecutive_failures >= threshold from `config.yaml` `alerting.consecutive_failure_threshold`:
  - Check if an open GitHub Issue with label `source-alert` already exists for this source
  - If not, create one with diagnosis and suggestions
- If a previously alerting source recovers, close the corresponding Issue

### Data Cleanup
- During daily runs, remove articles from `data/history.json` where `fetched_at` is older than `retention_days` from config

### Committing
- Stage all changed files: `data/history.json`, `data/health.json`, new report files
- Commit with message: `chore(catchup): daily report YYYY-MM-DD` (or weekly/monthly)
- Push to the repository
```

- [ ] **Step 2: Verify CLAUDE.md reads correctly**

Run: `wc -l CLAUDE.md`
Expected: approximately 60-70 lines, well-structured.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "feat: add CLAUDE.md with trigger agent instructions"
```

---

### Task 3: Daily Report Example

**Files:**
- Create: `docs/report-examples/daily-example.md`

This file serves as the reference template that Claude follows when generating daily reports.

- [ ] **Step 1: Create `docs/report-examples/daily-example.md`**

```markdown
# CatchUp 日报 — 2026-04-10

## 今日概览

共抓取 **12** 篇文章，来自 **5** 个数据源。

| 分类 | 数量 |
|------|------|
| 模型发布 | 2 |
| 研究 | 4 |
| 产品与功能 | 3 |
| 商业动态 | 1 |
| 政策与安全 | 1 |
| 教程与观点 | 1 |

---

## 文章详情

### 1. [文章标题](https://example.com/article-url)

- **来源**: OpenAI Blog
- **分类**: 模型发布
- **重要性**: ⭐⭐⭐⭐⭐ (5/5)
- **标签**: `GPT-5` `多模态` `推理能力`

**摘要**: 这是一段 2-3 句的文章摘要，概括文章的核心内容和关键发现。摘要应该让读者快速判断是否需要深入阅读原文。

> **实践建议**
> - 建议 1：具体的上手操作步骤
> - 建议 2：另一个可以尝试的方向

---

### 2. [另一篇文章标题](https://example.com/another-url)

- **来源**: Anthropic Blog
- **分类**: 研究
- **重要性**: ⭐⭐⭐⭐ (4/5)
- **标签**: `对齐` `RLHF` `安全性`

**摘要**: 这是另一篇文章的摘要内容。

---

(更多文章按重要性排序...)

---

## 今日趋势

简短的趋势分析段落（3-5 句），总结今天资讯反映的整体动向，指出值得关注的模式或关联。

---

## 数据源状态

| 数据源 | 状态 |
|--------|------|
| Berkeley RDI | ✅ 正常 |
| The Batch | ✅ 正常 |
| OpenAI Blog | ✅ 正常 |
| Google AI Blog | ✅ 正常 |
| Anthropic Blog | ⚠️ 抓取失败（HTTP 503） |
```

- [ ] **Step 2: Commit**

```bash
mkdir -p docs/report-examples
git add docs/report-examples/daily-example.md
git commit -m "feat: add daily report format example"
```

---

### Task 4: Weekly & Monthly Report Examples

**Files:**
- Create: `docs/report-examples/weekly-example.md`
- Create: `docs/report-examples/monthly-example.md`

- [ ] **Step 1: Create `docs/report-examples/weekly-example.md`**

```markdown
# CatchUp 周报 — 2026-W15 (04/07 - 04/13)

## 本周概览

本周共收录 **58** 篇文章，来自 **5** 个数据源。

| 分类 | 数量 | 趋势 |
|------|------|------|
| 模型发布 | 8 | ↑ |
| 研究 | 20 | → |
| 产品与功能 | 15 | ↑ |
| 商业动态 | 7 | → |
| 政策与安全 | 4 | ↓ |
| 教程与观点 | 4 | → |

---

## Top 10 最重要文章

### 1. [文章标题](https://example.com/url) ⭐⭐⭐⭐⭐

- **来源**: OpenAI Blog | **分类**: 模型发布 | **日期**: 04/10
- **标签**: `GPT-5` `多模态`

**摘要**: 2-3 句摘要。

---

(2-10 更多文章...)

---

## 分类概览

### 模型发布

本周模型发布动态的整体分析（3-5 句），包含重点事件和趋势。

### 研究

本周研究领域的整体分析。

### 产品与功能

本周产品与功能更新的整体分析。

(其他分类...)

---

## 本周值得上手试试

1. **[产品/功能名称]** — 具体的实践建议和操作步骤
2. **[另一个产品/功能]** — 实践建议

---

## 值得深读

推荐 3-5 篇值得花时间深入阅读的文章，附简短推荐理由。

1. [文章标题](url) — 推荐理由
2. [文章标题](url) — 推荐理由

---

## 本周趋势

3-5 句的趋势总结，跨文章的关联分析。指出本周 AI 领域的整体方向和值得关注的信号。
```

- [ ] **Step 2: Create `docs/report-examples/monthly-example.md`**

```markdown
# CatchUp 月报 — 2026-04

## 本月概览

本月共收录 **215** 篇文章，来自 **5** 个数据源。

| 分类 | 数量 | 环比变化 |
|------|------|---------|
| 模型发布 | 25 | +12% |
| 研究 | 78 | -3% |
| 产品与功能 | 55 | +20% |
| 商业动态 | 28 | +5% |
| 政策与安全 | 15 | -8% |
| 教程与观点 | 14 | +2% |

---

## 重大事件回顾

### 模型发布

本月模型发布领域的重大事件回顾（1-2 段），涵盖关键发布和影响。

### 研究

本月研究领域的重大进展回顾。

### 产品与功能

本月产品与功能领域的重要更新回顾。

### 商业动态

本月商业领域的重要动态回顾。

### 政策与安全

本月政策与安全领域的重要动态回顾。

---

## 月度趋势分析

### 升温方向 🔥

- **方向 1** — 具体分析为什么在升温
- **方向 2** — 分析

### 降温方向 ❄️

- **方向 1** — 具体分析
- **方向 2** — 分析

### 持续关注 👀

- **方向 1** — 分析

---

## 数据源活跃度

| 数据源 | 文章数 | 平均重要性 | 状态 |
|--------|--------|-----------|------|
| Berkeley RDI | 15 | 3.8 | ✅ 正常 |
| The Batch | 4 | 4.2 | ✅ 正常 |
| OpenAI Blog | 12 | 4.0 | ✅ 正常 |
| Google AI Blog | 8 | 3.5 | ✅ 正常 |
| Anthropic Blog | 10 | 4.1 | ✅ 正常 |
```

- [ ] **Step 3: Commit**

```bash
git add docs/report-examples/weekly-example.md docs/report-examples/monthly-example.md
git commit -m "feat: add weekly and monthly report format examples"
```

---

### Task 5: Daily Trigger Prompt

**Files:**
- Create: `docs/prompts/daily-trigger.md`

This is the most critical file — it contains the complete prompt that the daily Cloud Scheduled Trigger will execute. It must be self-contained because each trigger run is a fresh session.

- [ ] **Step 1: Create `docs/prompts/daily-trigger.md`**

```markdown
# CatchUp Daily Trigger Prompt

You are the CatchUp daily news aggregator agent. Your job is to fetch AI news from configured sources, analyze each article, generate a daily markdown report, update state files, and commit/push.

Read `CLAUDE.md` first for project context and rules.

## Workflow

Execute these steps in order:

### Step 1: Load Configuration

Read `config.yaml`. Extract:
- `sources`: list of data sources to fetch
- `categories`: the classification categories
- `analysis.dimensions`: extra analysis dimensions to apply
- `output_path`: where to write reports
- `retention_days`: how long to keep history
- `alerting`: failure threshold and alert method

### Step 2: Load State

Read `data/history.json`. This contains all previously processed articles keyed by SHA-256 hash of the article URL. You will use this for deduplication.

Read `data/health.json`. This tracks each source's health status.

### Step 3: Fetch Sources

For each source in config:

**If type is `rss`:**
- Use WebFetch to GET the source URL
- Parse the XML response to extract article entries (title, link, published date, content/description)
- For Substack feeds: entries are in `<item>` tags with `<title>`, `<link>`, `<pubDate>`, `<description>`
- For Atom feeds: entries are in `<entry>` tags with `<title>`, `<link href="...">`, `<published>`, `<content>`

**If type is `web_scraper`:**
- Use WebFetch to GET the source URL
- Examine the HTML structure to identify article listings
- Extract article titles, URLs, and publication dates
- For each article URL that is new (not in history), WebFetch the individual article page to get full content

**For all sources:**
- Compute SHA-256 hash of each article URL
- Skip articles whose hash already exists in `data/history.json`
- Record any fetch errors for health tracking

### Step 4: Analyze New Articles

For each new article, determine:
1. **summary**: 2-3 sentence Chinese summary capturing the key point
2. **category**: one of the categories from config (use Chinese names)
3. **importance**: 1-5 score based on:
   - 5: Major model release or breakthrough, will reshape the field
   - 4: Significant product update or important research result
   - 3: Notable news worth knowing about
   - 2: Incremental update or niche topic
   - 1: Minor or tangential

Then apply each dimension from `config.yaml` `analysis.dimensions`:
- Check the `condition` field — only apply if condition matches (e.g., category matches)
- Use the `prompt` field as guidance for generating the dimension's content
- Store result under the dimension's `name` in the article's `extras` object

### Step 5: Generate Daily Report

Get today's date in YYYY-MM-DD format.

Create the report file at `{output_path}/daily/{YYYY-MM-DD}.md`.

Follow the format in `docs/report-examples/daily-example.md` exactly:
- Header with date
- Overview table with article counts by category
- Article details sorted by importance (highest first), each with:
  - Title as link
  - Source, category, importance stars, tags (rendered as inline code)
  - Summary paragraph
  - Practice suggestions in blockquote (only if present in extras)
- Trend summary at the bottom
- Data source status table

### Step 6: Update History

Add each newly analyzed article to `data/history.json` under `articles`, keyed by the SHA-256 hash of the URL:

```json
{
  "title": "Article Title",
  "url": "https://...",
  "source": "Source Name",
  "published_at": "YYYY-MM-DD",
  "fetched_at": "YYYY-MM-DDTHH:MM:SSZ",
  "summary": "...",
  "category": "...",
  "importance": 4,
  "extras": {
    "tags": ["tag1", "tag2"],
    "practice_suggestions": ["suggestion1"]
  }
}
```

Update `last_fetch` to current ISO timestamp.

### Step 7: Clean Up Old Data

Calculate the cutoff date: today minus `retention_days` from config.

Remove any article from `data/history.json` where `fetched_at` is before the cutoff date.

### Step 8: Update Health Status

For each source in config, update `data/health.json`:

**If fetch succeeded:**
```json
{
  "status": "healthy",
  "last_success": "YYYY-MM-DDTHH:MM:SSZ",
  "consecutive_failures": 0
}
```

**If fetch failed:**
- Increment `consecutive_failures`
- Set `last_error` to a description of the error (HTTP status, timeout, parse error, etc.)
- If `consecutive_failures` < threshold: set `status` to `"degraded"`
- If `consecutive_failures` >= threshold: set `status` to `"alert"`

### Step 9: Handle Alerts

For each source with status `"alert"`:
1. Use `gh issue list --label source-alert --state open` to check for existing open issues for this source
2. If no existing issue, create one:
   ```
   gh issue create --title "CatchUp: [Source Name] 连续抓取失败" --label "source-alert" --body "..."
   ```
   Body should include: source name, URL, error type, consecutive failure count, diagnosis, and fix suggestions.

For each source that recovered (was in alert/degraded, now healthy):
1. Find the open issue for this source and close it:
   ```
   gh issue close <issue-number> --comment "Source recovered and is now healthy."
   ```

### Step 10: Commit and Push

```bash
git add data/history.json data/health.json reports/
git commit -m "chore(catchup): daily report YYYY-MM-DD"
git push
```

Replace YYYY-MM-DD with today's actual date.
```

- [ ] **Step 2: Verify the prompt is self-contained**

Read through `docs/prompts/daily-trigger.md` and check:
- Does it reference CLAUDE.md? Yes (Step 1)
- Does it cover all 5 sources types? Yes (rss + web_scraper)
- Does it handle dedup? Yes (Step 3, SHA-256 check)
- Does it handle analysis dimensions? Yes (Step 4)
- Does it generate the report? Yes (Step 5)
- Does it update state? Yes (Steps 6-8)
- Does it handle alerting? Yes (Step 9)
- Does it commit/push? Yes (Step 10)

- [ ] **Step 3: Commit**

```bash
mkdir -p docs/prompts
git add docs/prompts/daily-trigger.md
git commit -m "feat: add daily trigger prompt"
```

---

### Task 6: Weekly & Monthly Trigger Prompts

**Files:**
- Create: `docs/prompts/weekly-trigger.md`
- Create: `docs/prompts/monthly-trigger.md`

- [ ] **Step 1: Create `docs/prompts/weekly-trigger.md`**

```markdown
# CatchUp Weekly Trigger Prompt

You are the CatchUp weekly news aggregator agent. Your job is to generate a weekly summary report from the past 7 days of collected articles.

Read `CLAUDE.md` first for project context and rules.

## Workflow

### Step 1: Load Configuration

Read `config.yaml`. Extract `categories`, `analysis.dimensions`, `output_path`.

### Step 2: Load History

Read `data/history.json`. Filter articles where `fetched_at` falls within the past 7 days (from today).

### Step 3: Generate Weekly Report

Determine the ISO week number for the current week (e.g., 2026-W15).
Determine the date range (e.g., 04/07 - 04/13).

Create the report file at `{output_path}/weekly/{YYYY}-W{NN}.md`.

Follow the format in `docs/report-examples/weekly-example.md`:

1. **Overview table**: article counts by category with trend arrows (compare to previous week if data available)
2. **Top 10**: the 10 highest-importance articles from the week, with summary and metadata
3. **Category overviews**: for each category, a 3-5 sentence analysis of the week's developments in that area
4. **Practice suggestions**: aggregate all practice_suggestions from the week's articles into a "本周值得上手试试" section
5. **Deep reads**: recommend 3-5 articles worth reading in full, with reason
6. **Trend summary**: cross-article correlation analysis, overall direction of the AI field this week

All text in Chinese.

### Step 4: Commit and Push

```bash
git add reports/weekly/
git commit -m "chore(catchup): weekly report YYYY-WNN"
git push
```
```

- [ ] **Step 2: Create `docs/prompts/monthly-trigger.md`**

```markdown
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
```

- [ ] **Step 3: Commit**

```bash
git add docs/prompts/weekly-trigger.md docs/prompts/monthly-trigger.md
git commit -m "feat: add weekly and monthly trigger prompts"
```

---

### Task 7: Manual Test — Single Source Fetch

This task validates the core workflow by running the daily trigger prompt manually against a single source.

- [ ] **Step 1: Create a minimal test config**

Temporarily edit `config.yaml` to only have one source (Berkeley RDI) to keep the test focused. Save the original file first:

```bash
cp config.yaml config.yaml.bak
```

Then edit `config.yaml` to only keep:

```yaml
output_path: "./reports"
retention_days: 90

categories:
  - "模型发布"
  - "研究"
  - "产品与功能"
  - "商业动态"
  - "政策与安全"
  - "教程与观点"

analysis:
  dimensions:
    - name: tags
      prompt: "提取 3-5 个关键词标签，用于关联分析"
      type: list
      render: inline_tags

    - name: practice_suggestions
      prompt: "如果涉及可上手尝试的产品或功能，给出 1-3 条具体的实践建议，包括操作步骤"
      condition: "category in ['模型发布', '产品与功能']"
      type: list
      render: callout_block

alerting:
  consecutive_failure_threshold: 3
  method: github_issue

sources:
  - name: "Berkeley RDI"
    type: rss
    url: "https://berkeleyrdi.substack.com/feed"
```

- [ ] **Step 2: Run the daily workflow manually**

In Claude Code, execute the daily trigger prompt manually. Run it as a prompt:

```
Read docs/prompts/daily-trigger.md and execute the workflow described in it. This is a manual test run — skip Step 9 (alerting) and Step 10 (commit/push) for now.
```

- [ ] **Step 3: Verify results**

Check that:
1. `data/history.json` now contains article entries with the correct structure
2. `data/health.json` shows Berkeley RDI as "healthy"
3. A daily report file exists at `reports/daily/{today's date}.md`
4. The report follows the format in `docs/report-examples/daily-example.md`
5. Articles have summaries in Chinese, valid categories, importance scores, tags

Run:
```bash
cat data/history.json | head -50
cat data/health.json
ls reports/daily/
```

- [ ] **Step 4: Review and note any issues**

If the report format doesn't match expectations, note what needs to be adjusted in the prompts or report examples.

- [ ] **Step 5: Restore full config**

```bash
mv config.yaml.bak config.yaml
```

- [ ] **Step 6: Commit test results (if successful)**

```bash
git add data/ reports/
git commit -m "test: manual single-source fetch validation"
```

---

### Task 8: Manual Test — Full Daily Workflow

Now test with all 5 sources to validate the complete daily workflow.

- [ ] **Step 1: Run full daily workflow**

In Claude Code:

```
Read docs/prompts/daily-trigger.md and execute the workflow described in it. Use all sources from config.yaml. Skip Step 9 (alerting) and Step 10 (commit/push).
```

- [ ] **Step 2: Verify results**

Check:
1. `data/history.json` has articles from multiple sources
2. `data/health.json` has entries for all 5 sources
3. Daily report covers articles from multiple sources
4. Articles are sorted by importance in the report
5. Practice suggestions appear for "模型发布" and "产品与功能" articles
6. Trend summary is present

```bash
cat data/health.json
wc -l reports/daily/*.md
```

- [ ] **Step 3: Test weekly report generation**

```
Read docs/prompts/weekly-trigger.md and execute the workflow described in it. Skip commit/push.
```

Verify a weekly report was created in `reports/weekly/`.

- [ ] **Step 4: Commit**

```bash
git add data/ reports/
git commit -m "test: full daily and weekly workflow validation"
```

---

### Task 9: Push to GitHub

Cloud Scheduled Triggers need a GitHub repo to clone from.

- [ ] **Step 1: Create GitHub repository**

```bash
gh repo create CatchUp --private --source=. --push
```

This creates a private repo and pushes the current local content.

- [ ] **Step 2: Verify the repo exists**

```bash
gh repo view --json name,url
```

Expected: repo name is "CatchUp" and URL is shown.

- [ ] **Step 3: Verify remote is set**

```bash
git remote -v
```

Expected: origin points to the new GitHub repo.

---

### Task 10: Set Up Scheduled Triggers

Create three Cloud Scheduled Triggers using `/schedule`.

- [ ] **Step 1: Create daily trigger**

Use `/schedule` in Claude Code:

```
/schedule daily CatchUp news aggregation at 8am
```

When prompted for the task prompt, paste the full content of `docs/prompts/daily-trigger.md`.

Set the repository to the CatchUp GitHub repo. Configure to allow network access (for WebFetch) and GitHub Issue creation (for alerting).

- [ ] **Step 2: Create weekly trigger**

```
/schedule weekly CatchUp summary every Monday at 9am
```

When prompted, paste the content of `docs/prompts/weekly-trigger.md`.

- [ ] **Step 3: Create monthly trigger**

```
/schedule monthly CatchUp summary on the 1st at 9am
```

When prompted, paste the content of `docs/prompts/monthly-trigger.md`.

- [ ] **Step 4: Verify all triggers are registered**

```
/schedule list
```

Expected: three triggers listed — daily, weekly, monthly — with correct schedules.

- [ ] **Step 5: Commit a note about trigger setup**

```bash
echo "Triggers configured via /schedule (stored in Anthropic cloud):" > docs/TRIGGERS.md
echo "" >> docs/TRIGGERS.md
echo "- daily: every day at 8:00 AM" >> docs/TRIGGERS.md
echo "- weekly: every Monday at 9:00 AM" >> docs/TRIGGERS.md
echo "- monthly: 1st of each month at 9:00 AM" >> docs/TRIGGERS.md
echo "" >> docs/TRIGGERS.md
echo "Manage with: /schedule list, /schedule update, /schedule delete" >> docs/TRIGGERS.md
git add docs/TRIGGERS.md
git commit -m "docs: record scheduled trigger configuration"
git push
```

---

### Task 11: End-to-End Verification

Verify the system works by triggering one manual run of the daily trigger from the cloud.

- [ ] **Step 1: Trigger a manual run**

```
/schedule run daily
```

(Or use the equivalent command to manually trigger the daily task.)

- [ ] **Step 2: Wait for completion and check results**

After the run completes, pull the latest changes:

```bash
git pull
```

Verify:
- New daily report exists in `reports/daily/`
- `data/history.json` has been updated
- `data/health.json` shows source statuses
- Commit was made by the trigger agent

```bash
git log --oneline -3
ls reports/daily/
cat data/health.json
```

- [ ] **Step 3: Review the generated report**

Open the latest daily report and verify quality:
- Chinese summaries are coherent
- Categories are correct
- Importance scores are reasonable
- Practice suggestions are actionable
- Format matches the example template

If issues are found, adjust the trigger prompt in `docs/prompts/daily-trigger.md`, update the cloud trigger, and re-test.
