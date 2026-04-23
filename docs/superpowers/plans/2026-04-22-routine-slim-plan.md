# CatchUp Routine Slim-Down Implementation Plan (PR 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shrink the Claude Cloud Scheduled Trigger's prompt from 11 sequential steps to 1 (produce a structured analysis JSON), moving all deterministic work (markdown rendering, history/health updates, gh-issue alerts, commit+push) into `scripts/build-report.js` (new) which runs in GH Actions. Add `scripts/fallback-report.js` (cron, +4h after fetch) as a guaranteed-delivery floor.

**Architecture:** Daily trigger writes `data/analysis-cache/{date}.json` with per-article analyses + trend paragraph, commits, exits. A push to `data/analysis-cache/**` fires `.github/workflows/build-report.yml`, which reads fetch-cache + analysis-cache, renders the markdown report, and updates history/health/issues. A separate `.github/workflows/fallback-report.yml` runs at 12:00 CST daily; if no report for today exists, it renders a title-only report from fetch-cache.

**Tech Stack:** Node 20 (via nvm), pnpm, built-in `node --test`, existing `scripts/lib/http.js`, `gh` CLI for issue management, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-04-22-enrichment-and-routine-slim-design.md`

**Depends on:** PR 1 (enrichment) must be merged first. The slim prompt's summary-source priority references `linked_content` / `full_text` from PR 1.

**Toolchain note:** Prepend `source /opt/homebrew/opt/nvm/nvm.sh &&` to any command that needs node/pnpm.

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `data/analysis-cache/.gitkeep` | create | new directory the trigger writes to |
| `scripts/build-report.js` | create | deterministic post-processor: render report + update history/health/issues + commit+push |
| `scripts/build-report.test.js` | create | unit tests (rendering, dedup, thread merge, retention, health state machine) |
| `scripts/lib/render-report.js` | create | pure markdown-rendering function, exported for tests |
| `scripts/lib/render-report.test.js` | create | unit tests for markdown rendering |
| `scripts/lib/health.js` | create | pure health-state-machine function, exported for tests |
| `scripts/lib/health.test.js` | create | unit tests for health transitions |
| `scripts/fallback-report.js` | create | guaranteed-delivery floor: render title-only report if normal one is missing |
| `scripts/fallback-report.test.js` | create | unit tests |
| `.github/workflows/build-report.yml` | create | triggers on push to `data/analysis-cache/**` |
| `.github/workflows/fallback-report.yml` | create | daily cron at 04:00 UTC (12:00 CST); also manual dispatch |
| `docs/prompts/daily-trigger.md` | rewrite | slim prompt producing analysis-cache JSON only |
| `.claude/skills/sync-daily-trigger/SKILL.md` | modify | note the new prompt shape (behavioral change, not procedure change) |
| `CLAUDE.md` | modify | update pipeline description for the new two-step flow |

---

## Task 1: Scaffold `data/analysis-cache/` directory

**Files:**
- Create: `data/analysis-cache/.gitkeep`

- [ ] **Step 1: Create the directory with a keep file**

```bash
mkdir -p data/analysis-cache && touch data/analysis-cache/.gitkeep
```

- [ ] **Step 2: Commit**

```bash
git add data/analysis-cache/.gitkeep
git commit -m "chore: scaffold data/analysis-cache/ for slim-trigger output"
```

---

## Task 2: `scripts/lib/render-report.js` — pure markdown rendering (TDD)

**Files:**
- Create: `scripts/lib/render-report.js`
- Create: `scripts/lib/render-report.test.js`

The current daily-trigger prompt relies on Claude freehand-rendering the markdown following the example. We lock that format into a pure function here so both `build-report.js` and tests produce identical output.

- [ ] **Step 1: Write failing tests for article block rendering**

Create `scripts/lib/render-report.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { renderArticleBlock, renderReport, CATEGORIES } = require('./render-report');

const SAMPLE_ARTICLE = {
  title: 'Introducing Claude Opus 4.7',
  url: 'https://www.anthropic.com/news/claude-opus-4-7',
  source: 'Anthropic Blog',
  category: '模型发布',
  importance: 5,
  tags: ['Claude', 'Opus', '模型发布'],
  summary: 'Anthropic 发布 Claude Opus 4.7，在 reasoning 与工具使用上较 4.6 显著提升。',
  practice_suggestions: ['在 Claude.ai 切换到 Opus 4.7 运行一组你已有的编码基准', '对比 Sonnet 4.6 的成本差'],
};

test('renderArticleBlock: includes title as link, source, category, stars, tags', () => {
  const md = renderArticleBlock(SAMPLE_ARTICLE, 1);
  assert.match(md, /### 1\. \[Introducing Claude Opus 4\.7\]\(https:\/\/www\.anthropic\.com\/news\/claude-opus-4-7\)/);
  assert.match(md, /- \*\*来源\*\*: Anthropic Blog/);
  assert.match(md, /- \*\*分类\*\*: 模型发布/);
  assert.match(md, /- \*\*重要性\*\*: ⭐⭐⭐⭐⭐ \(5\/5\)/);
  assert.match(md, /- \*\*标签\*\*: `Claude` `Opus` `模型发布`/);
  assert.match(md, /\*\*摘要\*\*: Anthropic 发布 Claude Opus 4\.7/);
});

test('renderArticleBlock: emits practice_suggestions as blockquote when present', () => {
  const md = renderArticleBlock(SAMPLE_ARTICLE, 1);
  assert.match(md, /> \*\*实践建议\*\*/);
  assert.match(md, /> - 在 Claude\.ai 切换到 Opus 4\.7/);
  assert.match(md, /> - 对比 Sonnet 4\.6 的成本差/);
});

test('renderArticleBlock: omits practice_suggestions block when absent', () => {
  const a = { ...SAMPLE_ARTICLE, practice_suggestions: null };
  const md = renderArticleBlock(a, 1);
  assert.doesNotMatch(md, /实践建议/);
});

test('renderArticleBlock: adds "也被 X, Y 报道" when also_covered_by present', () => {
  const a = { ...SAMPLE_ARTICLE, also_covered_by: ['Berkeley RDI', 'The Batch'] };
  const md = renderArticleBlock(a, 1);
  assert.match(md, /\| 📡 也被 Berkeley RDI, The Batch 报道/);
});

test('CATEGORIES: matches config category order', () => {
  assert.deepEqual(CATEGORIES, ['模型发布', '研究', '产品与功能', '商业动态', '政策与安全', '教程与观点']);
});
```

- [ ] **Step 2: Run tests, confirm they fail**

Run: `source /opt/homebrew/opt/nvm/nvm.sh && node --test scripts/lib/render-report.test.js`

Expected: fails — module doesn't exist.

- [ ] **Step 3: Implement `renderArticleBlock`**

Create `scripts/lib/render-report.js`:

```js
const CATEGORIES = ['模型发布', '研究', '产品与功能', '商业动态', '政策与安全', '教程与观点'];

function stars(n) { return '⭐'.repeat(Math.max(1, Math.min(5, n))); }

function renderArticleBlock(a, idx) {
  const sourceLine = a.also_covered_by?.length
    ? `- **来源**: ${a.source} | 📡 也被 ${a.also_covered_by.join(', ')} 报道\n`
    : `- **来源**: ${a.source}\n`;
  const tags = (a.tags || []).map((t) => '`' + t + '`').join(' ');
  let md = '';
  md += `### ${idx}. [${a.title}](${a.url})\n\n`;
  md += sourceLine;
  md += `- **分类**: ${a.category}\n`;
  md += `- **重要性**: ${stars(a.importance)} (${a.importance}/5)\n`;
  md += `- **标签**: ${tags}\n\n`;
  md += `**摘要**: ${a.summary}\n\n`;
  if (a.practice_suggestions && a.practice_suggestions.length) {
    md += '> **实践建议**\n';
    for (const s of a.practice_suggestions) md += `> - ${s}\n`;
    md += '\n';
  }
  md += '---\n\n';
  return md;
}

module.exports = { renderArticleBlock, CATEGORIES };
```

- [ ] **Step 4: Run tests, confirm they pass**

Run: `source /opt/homebrew/opt/nvm/nvm.sh && node --test scripts/lib/render-report.test.js`

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/render-report.js scripts/lib/render-report.test.js
git commit -m "feat(render-report): extract article-block rendering as pure function"
```

---

## Task 3: `renderReport` — full daily report rendering (TDD)

**Files:**
- Modify: `scripts/lib/render-report.js`
- Modify: `scripts/lib/render-report.test.js`

- [ ] **Step 1: Append failing tests for `renderReport`**

Add to `scripts/lib/render-report.test.js`:

```js
function makeArticle(n, overrides = {}) {
  return {
    title: `文章 ${n}`,
    url: `https://example.com/${n}`,
    source: 'OpenAI Blog',
    category: '模型发布',
    importance: 3,
    tags: ['t1'],
    summary: `摘要 ${n}`,
    ...overrides,
  };
}

test('renderReport: header with date + totals + category table', () => {
  const md = renderReport({
    date: '2026-04-22',
    articlesInReport: [makeArticle(1), makeArticle(2, { category: '研究' })],
    rawFetched: 10,
    mergedCount: 7,
    sourcesWithContent: 3,
    filteredLowImportance: 2,
    trendParagraph: '今日主题是模型更新。',
    sourceStatuses: [
      { name: 'OpenAI Blog', status_note: '✅ 正常（窗口内 2 文）' },
      { name: 'Google AI Blog', status_note: '✅ 正常（窗口内 0 文）' },
    ],
  });
  assert.match(md, /^# CatchUp 日报 — 2026-04-22/);
  assert.match(md, /共抓取 \*\*10\*\* 篇文章/);
  assert.match(md, /合并多推文线程后为 7 条/);
  assert.match(md, /来自 \*\*3\*\* 个数据源/);
  assert.match(md, /过滤后在报告中展示 \*\*2\*\* 篇/);
  assert.match(md, /\| 模型发布 \| 1 \|/);
  assert.match(md, /\| 研究 \| 1 \|/);
  assert.match(md, /\| 产品与功能 \| 0 \|/);
});

test('renderReport: includes each article in body, trend, source status table', () => {
  const md = renderReport({
    date: '2026-04-22',
    articlesInReport: [makeArticle(1)],
    rawFetched: 1, mergedCount: 1, sourcesWithContent: 1,
    filteredLowImportance: 0,
    trendParagraph: '今日 trend.',
    sourceStatuses: [{ name: 'OpenAI Blog', status_note: '✅ 正常（窗口内 1 文）' }],
  });
  assert.match(md, /### 1\. \[文章 1\]/);
  assert.match(md, /## 今日趋势[\s\S]*?今日 trend\./);
  assert.match(md, /## 数据源状态[\s\S]*?\| OpenAI Blog \| ✅ 正常/);
  assert.match(md, /共过滤 0 篇低重要度条目/);
});

test('renderReport: zero-article day renders placeholder section', () => {
  const md = renderReport({
    date: '2026-04-22',
    articlesInReport: [],
    rawFetched: 0, mergedCount: 0, sourcesWithContent: 0,
    filteredLowImportance: 0,
    trendParagraph: '今日所有数据源窗口内均无新内容。',
    sourceStatuses: [{ name: 'OpenAI Blog', status_note: '✅ 正常（窗口内 0 文）' }],
  });
  assert.match(md, /今日 30h 抓取窗口内全部 \d+ 个数据源均未产出新内容/);
});
```

- [ ] **Step 2: Run tests, confirm they fail**

Run: `source /opt/homebrew/opt/nvm/nvm.sh && node --test scripts/lib/render-report.test.js`

Expected: 3 new tests fail — `renderReport` not exported.

- [ ] **Step 3: Implement `renderReport`**

Append to `scripts/lib/render-report.js` (before `module.exports`):

```js
function renderReport({
  date,
  articlesInReport,
  rawFetched,
  mergedCount,
  sourcesWithContent,
  filteredLowImportance,
  trendParagraph,
  sourceStatuses,
}) {
  const catCounts = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
  for (const a of articlesInReport) {
    if (catCounts[a.category] !== undefined) catCounts[a.category]++;
  }

  let md = '';
  md += `# CatchUp 日报 — ${date}\n\n## 今日概览\n\n`;
  if (mergedCount === rawFetched) {
    md += `共抓取 **${rawFetched}** 篇文章，来自 **${sourcesWithContent}** 个数据源（过滤后在报告中展示 **${articlesInReport.length}** 篇）。\n\n`;
  } else {
    md += `共抓取 **${rawFetched}** 篇文章（合并多推文线程后为 ${mergedCount} 条独立条目），来自 **${sourcesWithContent}** 个数据源（过滤后在报告中展示 **${articlesInReport.length}** 篇）。\n\n`;
  }
  md += '| 分类 | 数量 |\n|------|------|\n';
  for (const c of CATEGORIES) md += `| ${c} | ${catCounts[c]} |\n`;
  md += '\n---\n\n## 文章详情\n\n';

  if (articlesInReport.length === 0) {
    md += `今日 30h 抓取窗口内全部 ${sourceStatuses.length} 个数据源均未产出新内容，无条目可展示。\n\n---\n\n`;
  } else {
    articlesInReport.forEach((a, i) => { md += renderArticleBlock(a, i + 1); });
  }

  md += '## 今日趋势\n\n';
  md += trendParagraph.trim() + '\n\n';
  md += '---\n\n## 数据源状态\n\n| 数据源 | 状态 |\n|--------|------|\n';
  for (const s of sourceStatuses) md += `| ${s.name} | ${s.status_note} |\n`;
  md += `\n注：共过滤 ${filteredLowImportance} 篇低重要度条目（importance < 2）——这些条目仍记入 history.json。\n`;
  return md;
}
```

Update `module.exports`:

```js
module.exports = { renderArticleBlock, renderReport, CATEGORIES };
```

- [ ] **Step 4: Run tests, confirm they pass**

Run: `source /opt/homebrew/opt/nvm/nvm.sh && node --test scripts/lib/render-report.test.js`

Expected: 8 tests pass (5 from Task 2 + 3 new).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/render-report.js scripts/lib/render-report.test.js
git commit -m "feat(render-report): renderReport assembles full daily report markdown"
```

---

## Task 4: `scripts/lib/health.js` — pure state-machine function (TDD)

**Files:**
- Create: `scripts/lib/health.js`
- Create: `scripts/lib/health.test.js`

- [ ] **Step 1: Write failing tests**

Create `scripts/lib/health.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { updateSourceHealth } = require('./health');

const NOW = '2026-04-22T00:09:08Z';
const THRESHOLD = 3;

test('ok status → healthy, consecutive_failures reset', () => {
  const prior = { status: 'degraded', last_success: '2026-04-18T00:00:00Z', consecutive_failures: 2, last_error: 'old error' };
  const fc = { status: 'ok', error: null };
  const next = updateSourceHealth(prior, fc, NOW, THRESHOLD);
  assert.deepEqual(next, {
    status: 'healthy', last_success: NOW, consecutive_failures: 0, last_error: null,
  });
});

test('error status → degraded when below threshold, increments failures, copies error', () => {
  const prior = { status: 'healthy', last_success: '2026-04-20T00:00:00Z', consecutive_failures: 0, last_error: null };
  const fc = { status: 'error', error: 'HTTP 500' };
  const next = updateSourceHealth(prior, fc, NOW, THRESHOLD);
  assert.deepEqual(next, {
    status: 'degraded', last_success: '2026-04-20T00:00:00Z', consecutive_failures: 1, last_error: 'HTTP 500',
  });
});

test('error status → alert when failures reach threshold', () => {
  const prior = { status: 'degraded', last_success: '2026-04-19T00:00:00Z', consecutive_failures: 2, last_error: 'HTTP 500' };
  const fc = { status: 'error', error: 'HTTP 500' };
  const next = updateSourceHealth(prior, fc, NOW, THRESHOLD);
  assert.equal(next.status, 'alert');
  assert.equal(next.consecutive_failures, 3);
});

test('degraded_stale status is treated like error (increments + eventually alerts)', () => {
  const prior = { status: 'healthy', last_success: '2026-04-20T00:00:00Z', consecutive_failures: 0, last_error: null };
  const fc = { status: 'degraded_stale', error: 'newest item is 823h old' };
  const next = updateSourceHealth(prior, fc, NOW, THRESHOLD);
  assert.equal(next.status, 'degraded');
  assert.equal(next.consecutive_failures, 1);
  assert.equal(next.last_error, 'newest item is 823h old');
});

test('missing prior entry (new source) is treated as healthy baseline', () => {
  const fc = { status: 'ok', error: null };
  const next = updateSourceHealth(undefined, fc, NOW, THRESHOLD);
  assert.deepEqual(next, {
    status: 'healthy', last_success: NOW, consecutive_failures: 0, last_error: null,
  });
});
```

- [ ] **Step 2: Run tests, confirm they fail**

Run: `source /opt/homebrew/opt/nvm/nvm.sh && node --test scripts/lib/health.test.js`

Expected: fails — module doesn't exist.

- [ ] **Step 3: Implement `updateSourceHealth`**

Create `scripts/lib/health.js`:

```js
function updateSourceHealth(prior, fetchCacheEntry, now, failureThreshold) {
  const prev = prior || { status: 'healthy', last_success: null, consecutive_failures: 0, last_error: null };
  const s = fetchCacheEntry.status;
  if (s === 'ok') {
    return {
      status: 'healthy',
      last_success: now,
      consecutive_failures: 0,
      last_error: null,
    };
  }
  // s === 'error' | 'degraded_stale' → accumulate failures
  const failures = (prev.consecutive_failures || 0) + 1;
  const status = failures >= failureThreshold ? 'alert' : 'degraded';
  return {
    status,
    last_success: prev.last_success,
    consecutive_failures: failures,
    last_error: fetchCacheEntry.error || null,
  };
}

module.exports = { updateSourceHealth };
```

- [ ] **Step 4: Run tests, confirm they pass**

Run: `source /opt/homebrew/opt/nvm/nvm.sh && node --test scripts/lib/health.test.js`

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/health.js scripts/lib/health.test.js
git commit -m "feat(health): extract health state machine as pure function"
```

---

## Task 5: `scripts/build-report.js` core — dedup, thread merge, importance filter (TDD)

**Files:**
- Create: `scripts/build-report.js`
- Create: `scripts/build-report.test.js`

This task implements the *pure transform* functions (no file I/O, no git, no gh). We cover the I/O orchestration in Task 9.

- [ ] **Step 1: Write failing tests for the transforms**

Create `scripts/build-report.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  filterAlreadyReported,
  mergeThreads,
  applyDuplicateOf,
  filterByImportance,
  urlHash,
} = require('./build-report');

test('urlHash: sha256 hex of URL — 64-char, deterministic, differs per URL', () => {
  assert.match(urlHash('https://example.com/a'), /^[0-9a-f]{64}$/);
  assert.equal(urlHash('https://example.com/a'), urlHash('https://example.com/a'));
  assert.notEqual(urlHash('https://example.com/a'), urlHash('https://example.com/b'));
});

test('filterAlreadyReported: drops articles whose url-hash is in history', () => {
  const history = { articles: { [urlHash('https://example.com/old')]: { title: 'old' } } };
  const input = [
    { url: 'https://example.com/old' },
    { url: 'https://example.com/new' },
  ];
  assert.deepEqual(filterAlreadyReported(input, history).map((a) => a.url),
    ['https://example.com/new']);
});

test('mergeThreads: groups articles with same thread_group_id under the earliest', () => {
  const input = [
    { url: 'https://x.com/a/1', thread_group_id: 't1', published_at: '2026-04-22T10:02Z', summary: 'B', title: 'second' },
    { url: 'https://x.com/a/0', thread_group_id: 't1', published_at: '2026-04-22T10:00Z', summary: 'A', title: 'first' },
    { url: 'https://x.com/a/2', thread_group_id: 't1', published_at: '2026-04-22T10:04Z', summary: 'C', title: 'third' },
    { url: 'https://x.com/b/0', thread_group_id: null, summary: 'D', title: 'standalone' },
  ];
  const out = mergeThreads(input);
  assert.equal(out.length, 2, 'one thread merged + one standalone');
  const thread = out.find((a) => a.url === 'https://x.com/a/0');
  assert.ok(thread, 'canonical is earliest-published article in the thread');
  assert.match(thread.summary, /A[\s\S]*B[\s\S]*C/, 'summaries concatenated in time order');
});

test('applyDuplicateOf: canonical gets also_covered_by entries; duplicates dropped', () => {
  const input = [
    { url: 'https://anthropic.com/news/x', source: 'Anthropic Blog', duplicate_of: null },
    { url: 'https://x.com/AnthropicAI/status/1', source: 'Anthropic (Twitter)', duplicate_of: 'https://anthropic.com/news/x' },
    { url: 'https://deeplearning.ai/the-batch/issue-350', source: 'The Batch', duplicate_of: 'https://anthropic.com/news/x' },
  ];
  const out = applyDuplicateOf(input);
  assert.equal(out.length, 1);
  assert.equal(out[0].url, 'https://anthropic.com/news/x');
  assert.deepEqual(out[0].also_covered_by, ['Anthropic (Twitter)', 'The Batch']);
});

test('filterByImportance: removes articles below threshold', () => {
  const input = [
    { url: '1', importance: 5 },
    { url: '2', importance: 2 },
    { url: '3', importance: 1 },
  ];
  assert.deepEqual(filterByImportance(input, 2).map((a) => a.url), ['1', '2']);
});
```

- [ ] **Step 2: Run tests, confirm they fail**

Run: `source /opt/homebrew/opt/nvm/nvm.sh && node --test scripts/build-report.test.js`

Expected: fails — module doesn't exist.

- [ ] **Step 3: Implement the transforms**

Create `scripts/build-report.js`:

```js
const crypto = require('node:crypto');

function urlHash(url) {
  return crypto.createHash('sha256').update(url).digest('hex');
}

function filterAlreadyReported(articles, history) {
  const known = new Set(Object.keys(history.articles || {}));
  return articles.filter((a) => !known.has(urlHash(a.url)));
}

function mergeThreads(articles) {
  const byId = new Map();
  const standalone = [];
  for (const a of articles) {
    if (!a.thread_group_id) { standalone.push(a); continue; }
    const group = byId.get(a.thread_group_id) || [];
    group.push(a);
    byId.set(a.thread_group_id, group);
  }
  const merged = [];
  for (const group of byId.values()) {
    group.sort((x, y) => String(x.published_at).localeCompare(String(y.published_at)));
    const [canonical, ...rest] = group;
    const summary = [canonical.summary, ...rest.map((r) => r.summary).filter(Boolean)].filter(Boolean).join(' ');
    merged.push({ ...canonical, summary, extras: { ...(canonical.extras || {}), thread_urls: group.map((g) => g.url) } });
  }
  return [...merged, ...standalone];
}

function applyDuplicateOf(articles) {
  const byUrl = new Map(articles.map((a) => [a.url, a]));
  const surviving = [];
  for (const a of articles) {
    if (!a.duplicate_of) { surviving.push(a); continue; }
    const canonical = byUrl.get(a.duplicate_of);
    if (!canonical) { surviving.push(a); continue; }  // canonical missing: keep the duplicate
    canonical.also_covered_by = [...(canonical.also_covered_by || []), a.source];
  }
  return surviving.filter((a) => !a.duplicate_of || !byUrl.get(a.duplicate_of));
}

function filterByImportance(articles, minImportance) {
  return articles.filter((a) => (a.importance || 0) >= minImportance);
}

module.exports = { urlHash, filterAlreadyReported, mergeThreads, applyDuplicateOf, filterByImportance };
```

- [ ] **Step 4: Run tests, confirm they pass**

Run: `source /opt/homebrew/opt/nvm/nvm.sh && node --test scripts/build-report.test.js`

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/build-report.js scripts/build-report.test.js
git commit -m "feat(build-report): pure transforms for dedup, thread merge, filter"
```

---

## Task 6: History update + retention cleanup (TDD)

**Files:**
- Modify: `scripts/build-report.js`
- Modify: `scripts/build-report.test.js`

- [ ] **Step 1: Append failing tests**

Add to `scripts/build-report.test.js`:

```js
const { appendToHistory, applyRetention } = require('./build-report');

test('appendToHistory: adds entries keyed by url-hash, preserves existing', () => {
  const history = { articles: { 'existing-hash': { title: 'old' } } };
  const articles = [
    { url: 'https://example.com/a', title: 'A', source: 'X', published_at: '2026-04-22', summary: 'sA', category: '研究', importance: 3, tags: ['t'] },
    { url: 'https://example.com/b', title: 'B', source: 'X', published_at: '2026-04-22', summary: 'sB', category: '研究', importance: 2, tags: [] },
  ];
  const fetchedAtISO = '2026-04-22T00:09:08Z';
  appendToHistory(history, articles, fetchedAtISO);
  const keys = Object.keys(history.articles);
  assert.equal(keys.length, 3);
  const hashA = urlHash('https://example.com/a');
  assert.equal(history.articles[hashA].title, 'A');
  assert.equal(history.articles[hashA].fetched_at, fetchedAtISO);
  assert.equal(history.articles[hashA].extras.tags.length, 1);
});

test('appendToHistory: stores extras.practice_suggestions when present', () => {
  const history = { articles: {} };
  const articles = [
    { url: '1', title: 't', source: 's', published_at: 'p', summary: 'sx', category: '模型发布', importance: 5, tags: ['a'], practice_suggestions: ['step 1'] },
  ];
  appendToHistory(history, articles, '2026-04-22T00:00:00Z');
  const entry = Object.values(history.articles)[0];
  assert.deepEqual(entry.extras.practice_suggestions, ['step 1']);
});

test('applyRetention: removes entries older than cutoff', () => {
  const history = {
    articles: {
      h1: { fetched_at: '2026-01-01T00:00:00Z' },
      h2: { fetched_at: '2026-04-20T00:00:00Z' },
      h3: { fetched_at: '2026-04-21T00:00:00Z' },
    },
  };
  const now = new Date('2026-04-22T00:00:00Z');
  const removed = applyRetention(history, now, 90);
  assert.equal(removed, 1);
  assert.deepEqual(Object.keys(history.articles).sort(), ['h2', 'h3']);
});
```

- [ ] **Step 2: Run tests, confirm they fail**

Run: `source /opt/homebrew/opt/nvm/nvm.sh && node --test scripts/build-report.test.js`

Expected: 3 new tests fail.

- [ ] **Step 3: Implement `appendToHistory` and `applyRetention`**

Append to `scripts/build-report.js` (before `module.exports`):

```js
function appendToHistory(history, articles, fetchedAtISO) {
  for (const a of articles) {
    const extras = { tags: a.tags || [] };
    if (a.practice_suggestions?.length) extras.practice_suggestions = a.practice_suggestions;
    if (a.also_covered_by?.length) extras.also_covered_by = a.also_covered_by;
    if (a.extras?.thread_urls) extras.thread_urls = a.extras.thread_urls;
    history.articles[urlHash(a.url)] = {
      title: a.title,
      url: a.url,
      source: a.source,
      published_at: a.published_at,
      fetched_at: fetchedAtISO,
      summary: a.summary,
      category: a.category,
      importance: a.importance,
      extras,
    };
  }
  history.last_fetch = fetchedAtISO;
}

function applyRetention(history, now, retentionDays) {
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 3600 * 1000);
  let removed = 0;
  for (const [k, v] of Object.entries(history.articles)) {
    if (v.fetched_at && new Date(v.fetched_at) < cutoff) {
      delete history.articles[k];
      removed++;
    }
  }
  return removed;
}
```

Update `module.exports`:

```js
module.exports = {
  urlHash,
  filterAlreadyReported, mergeThreads, applyDuplicateOf, filterByImportance,
  appendToHistory, applyRetention,
};
```

- [ ] **Step 4: Run tests, confirm they pass**

Run: `source /opt/homebrew/opt/nvm/nvm.sh && node --test scripts/build-report.test.js`

Expected: 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/build-report.js scripts/build-report.test.js
git commit -m "feat(build-report): history update + retention cleanup transforms"
```

---

## Task 7: gh issue alert wrapper (TDD, with shell injection)

**Files:**
- Modify: `scripts/build-report.js`
- Modify: `scripts/build-report.test.js`

- [ ] **Step 1: Append failing tests**

Add to `scripts/build-report.test.js`:

```js
const { manageAlerts } = require('./build-report');

test('manageAlerts: opens new issue when alert source has no existing open issue', async () => {
  const shellCalls = [];
  const shell = async (cmd) => {
    shellCalls.push(cmd);
    if (cmd.startsWith('gh issue list')) return '[]';  // no existing
    if (cmd.startsWith('gh issue create')) return 'https://github.com/foo/bar/issues/42';
    return '';
  };
  const health = {
    'OpenAI Blog': { status: 'alert', consecutive_failures: 3, last_error: 'HTTP 500' },
    'Google AI Blog': { status: 'healthy', consecutive_failures: 0 },
  };
  const prevHealth = { 'OpenAI Blog': { status: 'degraded', consecutive_failures: 2 } };
  await manageAlerts(health, prevHealth, { shell });
  assert.ok(shellCalls.some((c) => c.includes('gh issue list')));
  assert.ok(shellCalls.some((c) => c.startsWith('gh issue create') && c.includes('OpenAI Blog')));
});

test('manageAlerts: closes issue when previously-alerting source is now healthy', async () => {
  const shellCalls = [];
  const shell = async (cmd) => {
    shellCalls.push(cmd);
    if (cmd.startsWith('gh issue list')) {
      return JSON.stringify([{ number: 7, title: 'CatchUp: OpenAI Blog 连续抓取失败' }]);
    }
    return '';
  };
  const health = { 'OpenAI Blog': { status: 'healthy', consecutive_failures: 0 } };
  const prevHealth = { 'OpenAI Blog': { status: 'alert', consecutive_failures: 3 } };
  await manageAlerts(health, prevHealth, { shell });
  assert.ok(shellCalls.some((c) => c.startsWith('gh issue close 7')));
});

test('manageAlerts: does nothing for sources that stayed healthy', async () => {
  const shellCalls = [];
  const shell = async (cmd) => { shellCalls.push(cmd); return '[]'; };
  const health = { 'OpenAI Blog': { status: 'healthy', consecutive_failures: 0 } };
  const prevHealth = { 'OpenAI Blog': { status: 'healthy', consecutive_failures: 0 } };
  await manageAlerts(health, prevHealth, { shell });
  assert.equal(shellCalls.length, 0);
});
```

- [ ] **Step 2: Run tests, confirm they fail**

Run: `source /opt/homebrew/opt/nvm/nvm.sh && node --test scripts/build-report.test.js`

Expected: 3 new tests fail.

- [ ] **Step 3: Implement `manageAlerts`**

Append to `scripts/build-report.js`:

```js
const { execSync } = require('node:child_process');

function defaultShell(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

async function manageAlerts(health, prevHealth, { shell } = {}) {
  const run = shell || defaultShell;
  for (const [name, h] of Object.entries(health)) {
    const prev = prevHealth[name] || { status: 'healthy' };
    if (h.status === 'alert' && prev.status !== 'alert') {
      const raw = await run(`gh issue list --label source-alert --state open --json number,title`);
      const issues = JSON.parse(raw || '[]');
      const hasOpen = issues.some((i) => i.title.includes(name));
      if (!hasOpen) {
        const title = `CatchUp: ${name} 连续抓取失败`;
        const body = `Source: ${name}\nConsecutive failures: ${h.consecutive_failures}\nLast error: ${h.last_error}`;
        await run(`gh issue create --title ${JSON.stringify(title)} --label source-alert --body ${JSON.stringify(body)}`);
      }
    }
    if (prev.status === 'alert' && h.status === 'healthy') {
      const raw = await run(`gh issue list --label source-alert --state open --json number,title`);
      const issues = JSON.parse(raw || '[]');
      const match = issues.find((i) => i.title.includes(name));
      if (match) {
        await run(`gh issue close ${match.number} --comment "Source recovered and is now healthy."`);
      }
    }
  }
}
```

Update `module.exports`:

```js
module.exports = {
  urlHash,
  filterAlreadyReported, mergeThreads, applyDuplicateOf, filterByImportance,
  appendToHistory, applyRetention,
  manageAlerts,
};
```

- [ ] **Step 4: Run tests, confirm they pass**

Run: `source /opt/homebrew/opt/nvm/nvm.sh && node --test scripts/build-report.test.js`

Expected: 11 tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/build-report.js scripts/build-report.test.js
git commit -m "feat(build-report): gh-issue alert management with shell injection for tests"
```

---

## Task 8: Main orchestration in `build-report.js`

**Files:**
- Modify: `scripts/build-report.js`

The orchestration function wires all the pure transforms together and calls the file/shell I/O.

- [ ] **Step 1: Append the `main` orchestration**

Append to `scripts/build-report.js`:

```js
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const { renderReport } = require('./lib/render-report');
const { updateSourceHealth } = require('./lib/health');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const FETCH_CACHE_DIR = path.join(PROJECT_ROOT, 'data/fetch-cache');
const ANALYSIS_CACHE_DIR = path.join(PROJECT_ROOT, 'data/analysis-cache');
const HISTORY_PATH = path.join(PROJECT_ROOT, 'data/history.json');
const HEALTH_PATH = path.join(PROJECT_ROOT, 'data/health.json');
const CONFIG_PATH = path.join(PROJECT_ROOT, 'config.yaml');
const REPORTS_DIR = path.join(PROJECT_ROOT, 'reports/daily');

function shanghaiDate() {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

async function main() {
  const date = process.env.REPORT_DATE || shanghaiDate();
  const fetchCachePath = path.join(FETCH_CACHE_DIR, `${date}.json`);
  const analysisCachePath = path.join(ANALYSIS_CACHE_DIR, `${date}.json`);

  if (!fs.existsSync(fetchCachePath)) {
    console.error(`fetch-cache missing: ${fetchCachePath}`);
    process.exit(1);
  }
  if (!fs.existsSync(analysisCachePath)) {
    console.error(`analysis-cache missing: ${analysisCachePath} — routine did not produce one; fallback-report.yml is expected to handle this`);
    process.exit(0);  // not an error condition for this workflow; the fallback path is what handles it
  }

  const fetchCache = JSON.parse(fs.readFileSync(fetchCachePath, 'utf8'));
  const analysisCache = JSON.parse(fs.readFileSync(analysisCachePath, 'utf8'));
  const history = fs.existsSync(HISTORY_PATH)
    ? JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8')) : { articles: {}, last_fetch: null };
  const healthBefore = fs.existsSync(HEALTH_PATH)
    ? JSON.parse(fs.readFileSync(HEALTH_PATH, 'utf8')) : {};
  const config = yaml.load(fs.readFileSync(CONFIG_PATH, 'utf8'));

  const minImportance = config.filtering?.min_importance ?? 2;
  const retentionDays = config.retention_days || 90;
  const failureThreshold = config.alerting?.consecutive_failure_threshold || 3;

  // Step 1 — filter out articles already reported (URL-hash dedup)
  const fresh = filterAlreadyReported(analysisCache.articles, history);

  // Step 2 — thread merge (by thread_group_id)
  const afterThreads = mergeThreads(fresh);

  // Step 3 — duplicate_of → also_covered_by
  const canonical = applyDuplicateOf(afterThreads);

  // Step 4 — sort by importance desc, then published_at desc
  canonical.sort((a, b) =>
    (b.importance - a.importance) || String(b.published_at).localeCompare(String(a.published_at)));

  // Step 5 — importance filter for the report body
  const articlesInReport = filterByImportance(canonical, minImportance);

  // Step 6 — render markdown
  const rawFetched = Object.values(fetchCache.sources).reduce((n, s) => n + (s.articles?.length || 0), 0);
  const sourcesWithContent = Object.values(fetchCache.sources).filter((s) => (s.articles?.length || 0) > 0).length;
  const sourceStatuses = Object.entries(fetchCache.sources).map(([name, s]) => ({
    name,
    status_note: s.status === 'ok'
      ? `✅ 正常（窗口内 ${s.articles.length} 文）`
      : s.status === 'degraded_stale'
        ? `⚠️ 过期（${s.error}）`
        : `❌ 错误（${s.error}）`,
  }));
  const md = renderReport({
    date,
    articlesInReport,
    rawFetched,
    mergedCount: canonical.length,
    sourcesWithContent,
    filteredLowImportance: canonical.length - articlesInReport.length,
    trendParagraph: analysisCache.trend_paragraph || '（无趋势段）',
    sourceStatuses,
  });
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(REPORTS_DIR, `${date}.md`), md);

  // Step 7 — append to history
  appendToHistory(history, canonical, analysisCache.analyzed_at || fetchCache.fetched_at);
  const removed = applyRetention(history, new Date(), retentionDays);
  console.error(`retention cleanup: removed ${removed} entries`);
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2) + '\n');

  // Step 8 — update health
  const healthAfter = {};
  for (const [name, entry] of Object.entries(fetchCache.sources)) {
    healthAfter[name] = updateSourceHealth(healthBefore[name], entry, fetchCache.fetched_at, failureThreshold);
  }
  // carry forward any entries in healthBefore that aren't in today's fetch-cache
  for (const [name, h] of Object.entries(healthBefore)) {
    if (!(name in healthAfter)) healthAfter[name] = h;
  }
  fs.writeFileSync(HEALTH_PATH, JSON.stringify(healthAfter, null, 2) + '\n');

  // Step 9 — issues
  await manageAlerts(healthAfter, healthBefore);

  // Step 10 — git add / commit / push
  const { execSync } = require('node:child_process');
  const run = (c) => execSync(c, { stdio: 'inherit' });
  run(`git add data/history.json data/health.json reports/daily/${date}.md`);
  // If the working tree has no changes (idempotent re-run), skip commit
  try {
    execSync('git diff --cached --quiet', { stdio: 'ignore' });
    console.error('no changes to commit');
  } catch {
    run(`git commit -m "chore(catchup): daily report ${date}"`);
    run('git push');
  }
}

if (require.main === module) {
  main().catch((err) => { console.error('fatal:', err); process.exit(2); });
}
```

- [ ] **Step 2: Dry-run locally against today's files**

```bash
source /opt/homebrew/opt/nvm/nvm.sh && REPORT_DATE=2026-04-21 node scripts/build-report.js
```

Expected behavior:
- If `data/analysis-cache/2026-04-21.json` does not exist: exits 0 with the "analysis-cache missing" message (correct — fallback handles this).
- If it exists (we haven't written one yet today; this dry-run will likely exit 0 with the missing message).

Don't commit the transient report file. Reset:

```bash
git checkout -- data/history.json data/health.json
rm -f reports/daily/2026-04-21.md  # if anything was produced
```

- [ ] **Step 3: Verify tests still pass**

Run: `source /opt/homebrew/opt/nvm/nvm.sh && node --test scripts/`

Expected: all tests across files pass.

- [ ] **Step 4: Commit**

```bash
git add scripts/build-report.js
git commit -m "feat(build-report): orchestration entry point — render + history + health + alerts"
```

---

## Task 9: `.github/workflows/build-report.yml`

**Files:**
- Create: `.github/workflows/build-report.yml`

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/build-report.yml`:

```yaml
name: Build Report

on:
  push:
    branches: [main]
    paths:
      - 'data/analysis-cache/**'
  workflow_dispatch:
    inputs:
      report_date:
        description: 'YYYY-MM-DD (Asia/Shanghai). Defaults to today if empty.'
        required: false
        type: string
        default: ''

permissions:
  contents: write
  issues: write

concurrency:
  group: build-report
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          token: ${{ secrets.GITHUB_TOKEN }}

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 10

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Configure git
        run: |
          git config user.name  "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

      - name: Build report
        run: node scripts/build-report.js
        env:
          REPORT_DATE: ${{ inputs.report_date }}
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/build-report.yml
git commit -m "ci: build-report workflow triggered by analysis-cache push"
```

---

## Task 10: `scripts/fallback-report.js` + tests (TDD)

**Files:**
- Create: `scripts/fallback-report.js`
- Create: `scripts/fallback-report.test.js`

- [ ] **Step 1: Write failing tests**

Create `scripts/fallback-report.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { renderFallbackReport } = require('./fallback-report');

test('renderFallbackReport: explicit fallback header and per-source article list', () => {
  const fetchCache = {
    sources: {
      'OpenAI Blog': {
        status: 'ok', articles: [
          { title: 'Hello', url: 'https://openai.com/index/hello', published_at: '2026-04-22' },
        ],
      },
      'Sam Altman (Twitter)': {
        status: 'ok', articles: [
          { title: 'tweet', url: 'https://x.com/sama/status/1', published_at: '2026-04-22' },
        ],
      },
      'Berkeley RDI': { status: 'ok', articles: [] },
    },
  };
  const md = renderFallbackReport('2026-04-22', fetchCache);
  assert.match(md, /^# CatchUp 日报 — 2026-04-22（fallback/m);
  assert.match(md, /Claude 分析环节未在预期窗口内产出/);
  assert.match(md, /## OpenAI Blog/);
  assert.match(md, /- \[Hello\]\(https:\/\/openai\.com\/index\/hello\)/);
  assert.match(md, /## Sam Altman \(Twitter\)/);
  assert.match(md, /- \[tweet\]\(https:\/\/x\.com\/sama\/status\/1\)/);
  assert.doesNotMatch(md, /## Berkeley RDI/, 'sources with zero articles are omitted');
});

test('renderFallbackReport: zero-article day still renders with placeholder', () => {
  const fetchCache = { sources: { 'OpenAI Blog': { status: 'ok', articles: [] } } };
  const md = renderFallbackReport('2026-04-22', fetchCache);
  assert.match(md, /今日抓取窗口内全部数据源均无新内容/);
});
```

- [ ] **Step 2: Run tests, confirm they fail**

Run: `source /opt/homebrew/opt/nvm/nvm.sh && node --test scripts/fallback-report.test.js`

Expected: fails — module doesn't exist.

- [ ] **Step 3: Implement**

Create `scripts/fallback-report.js`:

```js
const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const FETCH_CACHE_DIR = path.join(PROJECT_ROOT, 'data/fetch-cache');
const REPORTS_DIR = path.join(PROJECT_ROOT, 'reports/daily');

function shanghaiDate() {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function renderFallbackReport(date, fetchCache) {
  let md = `# CatchUp 日报 — ${date}（fallback，自动回退版）\n\n`;
  md += '> Claude 分析环节未在预期窗口内产出；以下为仅标题+链接的兜底版本。\n\n---\n\n';
  const populated = Object.entries(fetchCache.sources).filter(([, s]) => (s.articles?.length || 0) > 0);
  if (populated.length === 0) {
    md += '今日抓取窗口内全部数据源均无新内容。\n';
    return md;
  }
  for (const [name, entry] of populated) {
    md += `## ${name}\n\n`;
    for (const a of entry.articles) {
      md += `- [${a.title}](${a.url})\n`;
    }
    md += '\n';
  }
  return md;
}

async function main() {
  const date = process.env.REPORT_DATE || shanghaiDate();
  const reportPath = path.join(REPORTS_DIR, `${date}.md`);
  if (fs.existsSync(reportPath)) {
    console.error(`report already exists at ${reportPath} — fallback not needed`);
    process.exit(0);
  }
  const fetchCachePath = path.join(FETCH_CACHE_DIR, `${date}.json`);
  if (!fs.existsSync(fetchCachePath)) {
    console.error(`fetch-cache missing for ${date}; nothing to fall back on`);
    process.exit(1);
  }
  const fetchCache = JSON.parse(fs.readFileSync(fetchCachePath, 'utf8'));
  const md = renderFallbackReport(date, fetchCache);
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  fs.writeFileSync(reportPath, md);

  const { execSync } = require('node:child_process');
  execSync(`git add ${reportPath}`, { stdio: 'inherit' });
  try {
    execSync('git diff --cached --quiet', { stdio: 'ignore' });
    console.error('no changes to commit');
  } catch {
    execSync(`git commit -m "chore(catchup): fallback daily report ${date}"`, { stdio: 'inherit' });
    execSync('git push', { stdio: 'inherit' });
  }
}

if (require.main === module) {
  main().catch((err) => { console.error('fatal:', err); process.exit(2); });
}

module.exports = { renderFallbackReport };
```

- [ ] **Step 4: Run tests, confirm they pass**

Run: `source /opt/homebrew/opt/nvm/nvm.sh && node --test scripts/fallback-report.test.js`

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/fallback-report.js scripts/fallback-report.test.js
git commit -m "feat(fallback-report): guaranteed-delivery minimal report when routine fails"
```

---

## Task 11: `.github/workflows/fallback-report.yml`

**Files:**
- Create: `.github/workflows/fallback-report.yml`

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/fallback-report.yml`:

```yaml
name: Fallback Report

on:
  schedule:
    - cron: '0 4 * * *'  # 12:00 Asia/Shanghai — 4h 23min after daily-fetch
  workflow_dispatch:
    inputs:
      report_date:
        description: 'YYYY-MM-DD (Asia/Shanghai). Defaults to today if empty.'
        required: false
        type: string
        default: ''

permissions:
  contents: write

concurrency:
  group: fallback-report
  cancel-in-progress: false

jobs:
  fallback:
    runs-on: ubuntu-latest
    timeout-minutes: 3
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 10

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Configure git
        run: |
          git config user.name  "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

      - name: Run fallback
        run: node scripts/fallback-report.js
        env:
          REPORT_DATE: ${{ inputs.report_date }}
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/fallback-report.yml
git commit -m "ci: fallback-report workflow — daily 12:00 CST safety net"
```

---

## Task 12: Rewrite `docs/prompts/daily-trigger.md` (slim version)

**Files:**
- Rewrite: `docs/prompts/daily-trigger.md`

- [ ] **Step 1: Replace the entire file with the slim prompt**

Replace the contents of `docs/prompts/daily-trigger.md` with:

````markdown
# CatchUp Daily Trigger — Analysis Only

You produce structured analysis of today's AI news into `data/analysis-cache/{date}.json`. You do NOT render the report, update history, update health, or manage GitHub issues — a post-processor handles all that.

Read `CLAUDE.md` first for project context.

## Workflow

### Step 1: Determine today's date

Use Asia/Shanghai timezone, YYYY-MM-DD format. Record as `{date}`.

### Step 2: Load today's fetch-cache

Read `data/fetch-cache/{date}.json`.

**If the file does not exist**: abort immediately. Write one line to stderr (`fetch-cache missing for {date} — aborting`) and exit without committing anything. Do NOT attempt to WebFetch or fabricate content.

### Step 3: Check for resume state

Read `data/analysis-cache/{date}.json` if it exists. It is a partial analysis from an earlier run of this same trigger. Collect the URLs already present in `articles[].url` — call this set `analyzed_urls`.

If the file does not exist, `analyzed_urls` is empty and you will create the file fresh.

### Step 4: Iterate new articles

For each source in `fetch-cache.sources` with `status === "ok"` or `status === "degraded_stale"`:
- For each article in `articles[]`:
  - If `article.url` is in `analyzed_urls`: skip.
  - Else: perform the analysis below.

For each article, determine:

1. **summary** — 2-3 Chinese sentences capturing the key point. Prioritize content sources in this order:
   - `article.linked_content` (Twitter primary, jina-fetched blog body the tweet points to)
   - `article.full_text` (blog, jina-fetched body)
   - `article.quoted_tweet.text + article.description` (when quote-tweet)
   - `article.description` (fallback)
2. **category** — one of: `模型发布`, `研究`, `产品与功能`, `商业动态`, `政策与安全`, `教程与观点`
3. **importance** — integer 1-5. Base score:
   - **5** NEW MODEL RELEASE (GPT-5, Claude 5, Gemini 3, major open-weight SOTA)
   - **4** SIGNIFICANT RESEARCH/PRODUCT (paper with empirical result, major product launch, minor version with real capability gain)
   - **3** NOTABLE UPDATE (feature release, partnership, funding, policy/regulatory, expert deep-dive)
   - **2** INCREMENTAL (small feature tweak, single observation)
   - **1** LOW-SIGNAL (greeting, meme, pure RT, reply fragment)
   Modifier: -1 if source role is `aggregator` AND raw text starts with `RT @` or `@<handle>` (pure retweet/reply).
4. **tags** — 3-5 Chinese keywords (array).
5. **practice_suggestions** — 1-3 concrete actionable Chinese suggestions with operating steps, ONLY if `category ∈ {模型发布, 产品与功能}`. Omit the field otherwise.
6. **thread_group_id** — if this article is one of a self-reply chain of tweets from the same author within 5 minutes covering the same topic, assign them a shared id like `thread-{screen_name}-{YYYYMMDD-HHMM}`. Non-thread articles get `null`.
7. **duplicate_of** — if this article covers the same topic as another article in today's batch, and that other article is from a `role: primary` source (while this one is aggregator), set `duplicate_of` to the canonical article's URL. Non-duplicates get `null`.

### Step 5: Write incremental progress

**After analyzing each article**:
- Read the current contents of `data/analysis-cache/{date}.json` (or treat as `{articles: []}` if missing).
- Append the new article's analysis to `articles[]`.
- Write the whole file back.

Keeping progress on disk after each article means a crash or timeout does not require re-analyzing everything.

The article JSON shape:
```json
{
  "url": "...",
  "source": "...",
  "summary": "...",
  "category": "...",
  "importance": 4,
  "tags": ["..."],
  "practice_suggestions": ["..."],
  "thread_group_id": null,
  "duplicate_of": null
}
```

(Omit `practice_suggestions` when not applicable. Use `null` for `thread_group_id` and `duplicate_of` when not set.)

### Step 6: Trend paragraph

Once all articles are analyzed (no unprocessed URLs left), write the whole-batch **trend paragraph** (3-6 Chinese sentences synthesizing the day's themes). Update `data/analysis-cache/{date}.json` to include:

```json
{
  "analyzed_at": "{ISO 8601 timestamp, Asia/Shanghai}",
  "fetch_cache_ref": "data/fetch-cache/{date}.json",
  "trend_paragraph": "...",
  "articles": [ ... all articles analyzed above ... ]
}
```

If the trigger is re-run and the file already has a `trend_paragraph` but new articles were added, regenerate the trend paragraph to reflect the full current batch.

### Step 7: Commit and push

```bash
git add data/analysis-cache/{date}.json
git commit -m "chore(catchup): daily analysis {date}"
git push
```

If the file was unchanged (no new articles to add, e.g., resume after full batch was already done), skip the commit.
````

- [ ] **Step 2: Commit**

```bash
git add docs/prompts/daily-trigger.md
git commit -m "docs(prompt): slim daily-trigger — analysis-cache output only, no report rendering"
```

- [ ] **Step 3: Sync the new prompt to the live Cloud Trigger**

This is a manual step — invoke the existing sync skill from an interactive Claude Code session (not inside this plan's execution). The maintainer runs:

```
/sync-daily-trigger
```

which calls the `.claude/skills/sync-daily-trigger/` procedure via `RemoteTrigger` API. The skill already handles:
- listing triggers to find "LLM-CatchUp Daily Report"
- reading `docs/prompts/daily-trigger.md` content
- pushing to the trigger via `RemoteTrigger action: "update"`
- verifying the echo

No code change here. Document in the PR body that the maintainer must run `/sync-daily-trigger` before the next scheduled run.

---

## Task 13: Update `.claude/skills/sync-daily-trigger/SKILL.md`

**Files:**
- Modify: `.claude/skills/sync-daily-trigger/SKILL.md`

- [ ] **Step 1: Add a note about the new prompt shape**

In the "Why this skill exists" section of `.claude/skills/sync-daily-trigger/SKILL.md`, append a paragraph:

```markdown
**Prompt shape (as of 2026-04-22):** the daily prompt is now "analysis-only" — it produces `data/analysis-cache/{date}.json` and exits. A separate GH Actions workflow (`build-report.yml`) renders the final markdown report and updates history/health. If you're reading the prompt and it looks much shorter than the weekly/monthly ones, that's intentional — don't restore the removed steps.
```

(Location: right after the bullet list explaining that triggers hold their own embedded copy.)

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/sync-daily-trigger/SKILL.md
git commit -m "docs(skill): note that daily-trigger prompt is analysis-only now"
```

---

## Task 14: Update `CLAUDE.md` to reflect the new pipeline

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Rewrite the "How It Works" section**

In `CLAUDE.md`, replace the two paragraphs under "## How It Works" with:

```markdown
This repo has three runtime stages, in order:

**Stage 1 — Fetcher** (`.github/workflows/daily-fetch.yml`, cron `37 23 * * *` UTC = 07:37 Asia/Shanghai). `scripts/fetch-sources.js` reads `config.yaml`, fetches each source via route modules under `scripts/routes/`, filters to a 30h window, enriches blog sources via Jina Reader (`scripts/lib/enrich.js`) and extracts full_text/linked_content where possible, and writes the snapshot to `data/fetch-cache/{YYYY-MM-DD}.json`.

**Stage 2 — Analyzer** (Claude Code Cloud Scheduled Trigger, runs shortly after fetch). The trigger reads `data/fetch-cache/{date}.json` and writes per-article `{summary, category, importance, tags, practice_suggestions, thread_group_id, duplicate_of}` plus a whole-batch `trend_paragraph` to `data/analysis-cache/{date}.json`. Incrementally persisted per article — partial work survives interruptions. Commits and pushes that single file. Does NOT render the markdown report, touch history/health, or manage issues. Prompt: `docs/prompts/daily-trigger.md`; synced to the live trigger via `.claude/skills/sync-daily-trigger/`.

**Stage 3 — Reporter** (`.github/workflows/build-report.yml`, triggered on push to `data/analysis-cache/**`). `scripts/build-report.js` reads fetch-cache + analysis-cache + history + health + config, does URL-hash dedup against history, merges threads, applies `duplicate_of`, renders the markdown report via `scripts/lib/render-report.js`, updates `data/history.json` + `data/health.json`, opens/closes GitHub issues for alerts, and commits+pushes the report + state files.

**Safety net — Fallback** (`.github/workflows/fallback-report.yml`, cron `0 4 * * *` UTC = 12:00 CST). `scripts/fallback-report.js` checks if `reports/daily/{today}.md` exists; if not (Stage 2 or 3 failed), it renders a title+link-only report from fetch-cache alone and commits+pushes. This guarantees the email subscriber always gets something.
```

- [ ] **Step 2: Remove stale trigger-side rules**

Still in `CLAUDE.md`, under "## Rules for Trigger Agents", the sections "### Analysis", "### Report Generation", "### Health Monitoring", "### Data Cleanup", "### Committing" describe what Claude **used** to do but now are done by `build-report.js` instead. Replace them all with:

```markdown
## Rules for the Daily Trigger (post-slim)

The daily trigger is now "analysis-only". Its full procedure lives in `docs/prompts/daily-trigger.md`. Summary:

- Read `data/fetch-cache/{date}.json`; abort cleanly if missing (no WebFetch fallback)
- For each new article, produce `{summary, category, importance, tags, practice_suggestions?, thread_group_id?, duplicate_of?}`
- Use `linked_content` > `full_text` > `quoted_tweet.text + description` > `description` as summary basis
- Detect thread groups (self-reply chain within 5 min) and cross-source duplicates
- Write trend_paragraph
- Persist incrementally per article into `data/analysis-cache/{date}.json`
- Commit that one file only

Deterministic concerns (report rendering, history/health updates, retention, GH issues, commits of reports) are outside the trigger's scope — see `scripts/build-report.js`.

Weekly and monthly triggers are unchanged (they aggregate from `data/history.json` and are less frequent; they'll be revisited if they start breaking).
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for three-stage + fallback pipeline"
```

---

## Task 15: End-to-end verification & PR

**No file changes.**

- [ ] **Step 1: Full test suite**

```bash
source /opt/homebrew/opt/nvm/nvm.sh && node --test scripts/
```

Expected: all tests across enrich, socialdata-twitter, render-report, health, build-report, fallback-report, email-reports pass. Count ~35+ tests green.

- [ ] **Step 2: Dry-run build-report with a synthetic analysis-cache**

Create a minimal analysis-cache for today:

```bash
DATE=$(TZ=Asia/Shanghai date +%Y-%m-%d)
mkdir -p data/analysis-cache
cat > data/analysis-cache/$DATE.json <<EOF
{
  "analyzed_at": "${DATE}T08:00:00+08:00",
  "fetch_cache_ref": "data/fetch-cache/${DATE}.json",
  "trend_paragraph": "（测试用）今日趋势占位段落。",
  "articles": []
}
EOF
source /opt/homebrew/opt/nvm/nvm.sh && node scripts/build-report.js
```

Expected: renders an empty-day report `reports/daily/$DATE.md`, writes history and health (no changes if no new articles), prints `retention cleanup: removed 0 entries`, attempts `git add/commit/push`. The push will fail if your local branch isn't behind origin; that's fine for the dry-run.

- [ ] **Step 3: Clean up dry-run artifacts**

```bash
git reset HEAD~1 --soft   # if a commit was made
git checkout -- data/history.json data/health.json
rm -f data/analysis-cache/$DATE.json reports/daily/$DATE.md
```

- [ ] **Step 4: Dry-run fallback-report**

```bash
source /opt/homebrew/opt/nvm/nvm.sh && REPORT_DATE=2026-04-21 node scripts/fallback-report.js
```

Expected:
- Since `reports/daily/2026-04-21.md` already exists, prints "report already exists at ... — fallback not needed" and exits 0.

Then force the missing-report branch:

```bash
mv reports/daily/2026-04-21.md /tmp/_backup.md
source /opt/homebrew/opt/nvm/nvm.sh && REPORT_DATE=2026-04-21 node scripts/fallback-report.js
mv /tmp/_backup.md reports/daily/2026-04-21.md
```

Expected: the second invocation writes a fallback report (you can inspect it before restoring the backup).

- [ ] **Step 5: Check git status**

```bash
git status
```

Expected: working tree clean.

- [ ] **Step 6: Open PR**

```bash
git push -u origin HEAD
gh pr create --title "feat: slim daily trigger + build-report + fallback-report" --body "$(cat <<'EOF'
## Summary
- Daily Claude Cloud Trigger becomes "analysis-only" — writes only data/analysis-cache/{date}.json with per-article analysis + trend paragraph, commits that one file, exits. Per-article checkpoint means partial work survives interruption.
- New scripts/build-report.js (GH Actions .github/workflows/build-report.yml, push-triggered): URL-hash dedup vs history, thread merge, duplicate_of → also_covered_by, importance filter, markdown render, history.json / health.json updates, retention cleanup, GH issue alerts, commit+push.
- New scripts/fallback-report.js (.github/workflows/fallback-report.yml, cron 04:00 UTC = 12:00 CST): if today's report is missing, renders title+link-only digest from fetch-cache and commits — guaranteed email delivery floor.
- Prompt docs/prompts/daily-trigger.md rewritten to slim version.
- CLAUDE.md + sync-daily-trigger/SKILL.md updated to describe the three-stage + fallback pipeline.
- Spec: docs/superpowers/specs/2026-04-22-enrichment-and-routine-slim-design.md (Phase 2)
- Depends on PR 1 (enrichment).

## Post-merge action required
Run `/sync-daily-trigger` from an interactive Claude Code session to push the new prompt to the live Cloud Scheduled Trigger. Without this, the old 11-step prompt is still running and the analysis-cache flow is inactive.

## Test plan
- [x] node --test scripts/ — all tests pass
- [x] Dry-run build-report.js with synthetic analysis-cache → renders report
- [x] Dry-run fallback-report.js: existing report → noop; missing → renders fallback
- [ ] After merge + /sync-daily-trigger: observe the next daily run produces analysis-cache; build-report workflow fires on the push; report lands in email
- [ ] Observe at least one day where routine dies; fallback fires at 12:00 CST; fallback report emailed

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review checklist (for writer)

**Spec § coverage:**
- § 4.2 target flow (3 stages + fallback) → Tasks 1, 9, 11, 14 ✓
- § 6.1 prompt reduction table → Task 12 ✓
- § 6.2 analysis-cache schema → Task 12 ✓
- § 6.3 per-article checkpoint → Task 12 Step 5 ✓
- § 6.4 build-report.js → Tasks 5–9 ✓
- § 6.5 fallback-report.js → Tasks 10, 11 ✓
- § 6.6 workflow + file list → Tasks 9, 11, 13, 14 ✓
- § 7 testing → every transform has a test ✓
- § 8 rollout (PR 2 separate from PR 1, sync-daily-trigger manual step) → Task 12 Step 3 + PR body ✓

**Placeholder scan:** every code step includes the actual code.

**Identifier consistency:** `filterAlreadyReported`, `mergeThreads`, `applyDuplicateOf`, `filterByImportance`, `appendToHistory`, `applyRetention`, `manageAlerts`, `renderArticleBlock`, `renderReport`, `updateSourceHealth`, `renderFallbackReport`, `urlHash` are used consistently across tasks.
