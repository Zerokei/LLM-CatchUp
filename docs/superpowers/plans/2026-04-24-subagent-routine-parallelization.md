# Subagent Routine Parallelization Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the daily-trigger routine's failure rate by (a) moving `thread_group_id` + `duplicate_of` out of the LLM and into deterministic fetch-time preprocessing, then (b) restructuring the trigger to fan out per-article analysis to parallel subagents.

**Architecture:** Two phases shipped in order.

- **Phase 1 (deterministic preprocessing):** Add `scripts/lib/derive-refs.js` exporting `computeThreadGroups` and `computeDuplicates`. Hook into `scripts/fetch-sources.js` after enrichment so fetch-cache articles arrive at the routine with `thread_group_id` + `duplicate_of` pre-set. Backwards-compatible — if the old prompt doesn't consume the fields, nothing breaks. Ships independently of Phase 2.
- **Phase 2 (subagent architecture):** Rewrite `docs/prompts/daily-trigger.md`. Main trigger chunks remaining articles into groups of ~10, dispatches one subagent per chunk in parallel (all in a single message), each subagent analyzes its chunk and writes `data/analysis-cache/{date}.chunk-{i}.json`. Main merges, writes trend_paragraph, commits. Cross-article reasoning is now impossible by construction — but was already moved to Phase 1.

**Tech Stack:** Node 20 (nvm) + pnpm, built-in `node --test`, Claude Code `Agent` tool for subagent dispatch, RemoteTrigger API for live-trigger sync.

**Open risk:** Agent/Task tool availability inside Cloud Trigger runtime is officially undocumented. Task 9 is an empirical probe that fires ONE subagent from the live trigger before we commit to the full refactor. If the probe shows Agent is unavailable, Phase 2 falls back to serial processing (which still benefits from Phase 1's simplification — see Task 14 fallback).

---

## File Structure

**New:**
- `scripts/lib/derive-refs.js` — pure functions: `extractHandleFromUrl(url)`, `computeThreadGroups(articles)`, `computeDuplicates(articlesBySource, sourceRoles)`. No I/O.
- `scripts/lib/derive-refs.test.js` — unit tests.

**Modified:**
- `scripts/fetch-sources.js` — after `enrichSnapshot`, apply derive-refs to set `thread_group_id` and `duplicate_of` on each article in `output.sources[*].articles[*]`.
- `docs/prompts/daily-trigger.md` — full rewrite to subagent architecture. Remove thread/dup computation instructions (they're now pre-computed).
- `CLAUDE.md` — document the two new pre-computed fields in fetch-cache.

**No-op for this plan (unchanged):**
- `scripts/build-report.js` — already consumes `thread_group_id` + `duplicate_of` identically whether LLM-written or fetch-written.
- `scripts/fallback-report.js` — already reads fetch-cache only, unaffected.

---

## Phase 1: Deterministic Preprocessing

### Task 1: `extractHandleFromUrl` utility

**Files:**
- Create: `scripts/lib/derive-refs.js`
- Test: `scripts/lib/derive-refs.test.js`

- [ ] **Step 1: Write the failing test**

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extractHandleFromUrl } = require('./derive-refs');

test('extractHandleFromUrl: tweet URL returns handle', () => {
  assert.equal(extractHandleFromUrl('https://x.com/sama/status/123'), 'sama');
});

test('extractHandleFromUrl: case preserved', () => {
  assert.equal(extractHandleFromUrl('https://x.com/OpenAIDevs/status/456'), 'OpenAIDevs');
});

test('extractHandleFromUrl: non-tweet URL returns null', () => {
  assert.equal(extractHandleFromUrl('https://openai.com/blog/xyz'), null);
});

test('extractHandleFromUrl: malformed input returns null', () => {
  assert.equal(extractHandleFromUrl(''), null);
  assert.equal(extractHandleFromUrl(null), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `source /opt/homebrew/opt/nvm/nvm.sh && node --test scripts/lib/derive-refs.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `extractHandleFromUrl`**

```js
// scripts/lib/derive-refs.js
function extractHandleFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const m = url.match(/^https?:\/\/x\.com\/([^/]+)\/status\/\d+/);
  return m ? m[1] : null;
}

module.exports = { extractHandleFromUrl };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `source /opt/homebrew/opt/nvm/nvm.sh && node --test scripts/lib/derive-refs.test.js`
Expected: 4/4 pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/derive-refs.js scripts/lib/derive-refs.test.js
git commit -m "feat(derive-refs): extractHandleFromUrl for tweet URLs"
```

---

### Task 2: `computeThreadGroups`

**Files:**
- Modify: `scripts/lib/derive-refs.js`
- Test: `scripts/lib/derive-refs.test.js`

The function returns a `Map<url, thread_group_id>`. Rules:
- Only self-replies (reply_to.screen_name == article author handle, case-insensitive) can form threads.
- Δt between consecutive messages in the chain must be ≤ 5 minutes.
- Group id = `thread-{handle}-{YYYYMMDD-HHMM}` where the timestamp is the chain root's `published_at` (UTC).
- Singletons (a "thread" of one article, because the root has no self-replies within 5 min) get no group id.
- If a reply's parent isn't in the batch, treat the reply as its own root.

- [ ] **Step 1: Write failing tests**

Append to `scripts/lib/derive-refs.test.js`:

```js
const { computeThreadGroups } = require('./derive-refs');

const fxArticle = (over) => ({
  url: over.url,
  published_at: over.published_at,
  reply_to: over.reply_to || null,
});

test('computeThreadGroups: isolated tweet gets no group', () => {
  const articles = [
    fxArticle({ url: 'https://x.com/sama/status/1', published_at: '2026-04-24T10:00:00Z' }),
  ];
  assert.equal(computeThreadGroups(articles).size, 0);
});

test('computeThreadGroups: self-reply within 5min groups with parent', () => {
  const articles = [
    fxArticle({ url: 'https://x.com/sama/status/1', published_at: '2026-04-24T10:00:00Z' }),
    fxArticle({
      url: 'https://x.com/sama/status/2',
      published_at: '2026-04-24T10:03:00Z',
      reply_to: { screen_name: 'sama', status_id: '1' },
    }),
  ];
  const g = computeThreadGroups(articles);
  assert.equal(g.size, 2);
  const id = g.get('https://x.com/sama/status/1');
  assert.equal(id, 'thread-sama-20260424-1000');
  assert.equal(g.get('https://x.com/sama/status/2'), id);
});

test('computeThreadGroups: self-reply > 5min does NOT group', () => {
  const articles = [
    fxArticle({ url: 'https://x.com/sama/status/1', published_at: '2026-04-24T10:00:00Z' }),
    fxArticle({
      url: 'https://x.com/sama/status/2',
      published_at: '2026-04-24T10:06:00Z',
      reply_to: { screen_name: 'sama', status_id: '1' },
    }),
  ];
  assert.equal(computeThreadGroups(articles).size, 0);
});

test('computeThreadGroups: reply to ANOTHER account does NOT group', () => {
  const articles = [
    fxArticle({ url: 'https://x.com/sama/status/1', published_at: '2026-04-24T10:00:00Z' }),
    fxArticle({
      url: 'https://x.com/pg/status/99',
      published_at: '2026-04-24T10:03:00Z',
      reply_to: { screen_name: 'sama', status_id: '1' },
    }),
  ];
  assert.equal(computeThreadGroups(articles).size, 0);
});

test('computeThreadGroups: case-insensitive handle match', () => {
  const articles = [
    fxArticle({ url: 'https://x.com/OpenAIDevs/status/1', published_at: '2026-04-24T10:00:00Z' }),
    fxArticle({
      url: 'https://x.com/OpenAIDevs/status/2',
      published_at: '2026-04-24T10:02:00Z',
      reply_to: { screen_name: 'openaidevs', status_id: '1' },
    }),
  ];
  assert.equal(computeThreadGroups(articles).size, 2);
});

test('computeThreadGroups: 3-message chain all grouped if each link ≤5min', () => {
  const articles = [
    fxArticle({ url: 'https://x.com/sama/status/1', published_at: '2026-04-24T10:00:00Z' }),
    fxArticle({
      url: 'https://x.com/sama/status/2',
      published_at: '2026-04-24T10:03:00Z',
      reply_to: { screen_name: 'sama', status_id: '1' },
    }),
    fxArticle({
      url: 'https://x.com/sama/status/3',
      published_at: '2026-04-24T10:07:00Z',
      reply_to: { screen_name: 'sama', status_id: '2' },
    }),
  ];
  const g = computeThreadGroups(articles);
  assert.equal(g.size, 3);
  const id = g.get('https://x.com/sama/status/1');
  assert.equal(g.get('https://x.com/sama/status/2'), id);
  assert.equal(g.get('https://x.com/sama/status/3'), id);
});

test('computeThreadGroups: orphan reply (parent not in batch) is own root', () => {
  const articles = [
    fxArticle({
      url: 'https://x.com/sama/status/2',
      published_at: '2026-04-24T10:03:00Z',
      reply_to: { screen_name: 'sama', status_id: '999-not-in-batch' },
    }),
  ];
  assert.equal(computeThreadGroups(articles).size, 0);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `source /opt/homebrew/opt/nvm/nvm.sh && node --test scripts/lib/derive-refs.test.js`
Expected: new tests fail — `computeThreadGroups` undefined.

- [ ] **Step 3: Implement `computeThreadGroups`**

Append to `scripts/lib/derive-refs.js`:

```js
function computeThreadGroups(articles) {
  const byUrl = new Map(articles.map((a) => [a.url, a]));
  const MAX_GAP_MS = 5 * 60 * 1000;

  function parentOf(a) {
    if (!a.reply_to?.status_id) return null;
    const authorHandle = extractHandleFromUrl(a.url);
    if (!authorHandle) return null;
    const replyTo = a.reply_to.screen_name?.toLowerCase();
    if (!replyTo || replyTo !== authorHandle.toLowerCase()) return null;
    const parentUrl = `https://x.com/${authorHandle}/status/${a.reply_to.status_id}`;
    const parent = byUrl.get(parentUrl);
    if (!parent) return null;
    const dt = new Date(a.published_at).getTime() - new Date(parent.published_at).getTime();
    if (!Number.isFinite(dt) || dt < 0 || dt > MAX_GAP_MS) return null;
    return parent;
  }

  function rootOf(a, seen = new Set()) {
    if (seen.has(a.url)) return a;
    seen.add(a.url);
    const p = parentOf(a);
    return p ? rootOf(p, seen) : a;
  }

  const childrenOfRoot = new Map();
  for (const a of articles) {
    const r = rootOf(a);
    if (!childrenOfRoot.has(r.url)) childrenOfRoot.set(r.url, []);
    childrenOfRoot.get(r.url).push(a);
  }

  const groups = new Map();
  for (const [rootUrl, members] of childrenOfRoot) {
    if (members.length < 2) continue;
    const root = byUrl.get(rootUrl);
    const handle = extractHandleFromUrl(rootUrl);
    const ts = new Date(root.published_at);
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${ts.getUTCFullYear()}${pad(ts.getUTCMonth() + 1)}${pad(ts.getUTCDate())}-${pad(ts.getUTCHours())}${pad(ts.getUTCMinutes())}`;
    const id = `thread-${handle}-${stamp}`;
    for (const m of members) groups.set(m.url, id);
  }
  return groups;
}

module.exports = { extractHandleFromUrl, computeThreadGroups };
```

- [ ] **Step 4: Run tests**

Run: `source /opt/homebrew/opt/nvm/nvm.sh && node --test scripts/lib/derive-refs.test.js`
Expected: all tests pass (4 + 7 = 11).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/derive-refs.js scripts/lib/derive-refs.test.js
git commit -m "feat(derive-refs): computeThreadGroups — deterministic self-reply chain detection"
```

---

### Task 3: `computeDuplicates`

**Files:**
- Modify: `scripts/lib/derive-refs.js`
- Test: `scripts/lib/derive-refs.test.js`

Aggregator article is a duplicate of a primary article if any of its `quoted_tweet.url` / `expanded_urls[*].expanded_url` points to a URL that appears in a primary source's articles within the same batch.

- [ ] **Step 1: Write failing tests**

Append to `scripts/lib/derive-refs.test.js`:

```js
const { computeDuplicates } = require('./derive-refs');

test('computeDuplicates: aggregator quoting primary → duplicate_of primary URL', () => {
  const articlesBySource = {
    'OpenAI (Twitter)': [
      { url: 'https://x.com/OpenAI/status/100', quoted_tweet: null, expanded_urls: [] },
    ],
    'Sam Altman (Twitter)': [
      {
        url: 'https://x.com/sama/status/200',
        quoted_tweet: { url: 'https://x.com/OpenAI/status/100', author: 'OpenAI', text: '...' },
        expanded_urls: [],
      },
    ],
  };
  const sourceRoles = { 'OpenAI (Twitter)': 'primary', 'Sam Altman (Twitter)': 'aggregator' };
  const dups = computeDuplicates(articlesBySource, sourceRoles);
  assert.equal(dups.get('https://x.com/sama/status/200'), 'https://x.com/OpenAI/status/100');
});

test('computeDuplicates: aggregator with expanded_url hitting primary', () => {
  const articlesBySource = {
    'Anthropic (Twitter)': [
      { url: 'https://x.com/AnthropicAI/status/100', quoted_tweet: null, expanded_urls: [] },
    ],
    'Thariq (Twitter)': [
      {
        url: 'https://x.com/Thariq/status/200',
        quoted_tweet: null,
        expanded_urls: [
          { t_co: 'https://t.co/x', expanded_url: 'https://x.com/AnthropicAI/status/100', display_url: 'x.com/...' },
        ],
      },
    ],
  };
  const sourceRoles = { 'Anthropic (Twitter)': 'primary', 'Thariq (Twitter)': 'aggregator' };
  const dups = computeDuplicates(articlesBySource, sourceRoles);
  assert.equal(dups.get('https://x.com/Thariq/status/200'), 'https://x.com/AnthropicAI/status/100');
});

test('computeDuplicates: primary articles are never marked duplicate', () => {
  const articlesBySource = {
    'OpenAI (Twitter)': [
      { url: 'https://x.com/OpenAI/status/100', quoted_tweet: null, expanded_urls: [] },
      {
        url: 'https://x.com/OpenAI/status/200',
        quoted_tweet: { url: 'https://x.com/OpenAI/status/100', author: 'OpenAI', text: '...' },
        expanded_urls: [],
      },
    ],
  };
  const sourceRoles = { 'OpenAI (Twitter)': 'primary' };
  const dups = computeDuplicates(articlesBySource, sourceRoles);
  assert.equal(dups.size, 0);
});

test('computeDuplicates: aggregator with no ref to any primary → not a duplicate', () => {
  const articlesBySource = {
    'OpenAI (Twitter)': [
      { url: 'https://x.com/OpenAI/status/100', quoted_tweet: null, expanded_urls: [] },
    ],
    'Sam Altman (Twitter)': [
      { url: 'https://x.com/sama/status/200', quoted_tweet: null, expanded_urls: [] },
    ],
  };
  const sourceRoles = { 'OpenAI (Twitter)': 'primary', 'Sam Altman (Twitter)': 'aggregator' };
  const dups = computeDuplicates(articlesBySource, sourceRoles);
  assert.equal(dups.size, 0);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `source /opt/homebrew/opt/nvm/nvm.sh && node --test scripts/lib/derive-refs.test.js`
Expected: new tests fail — `computeDuplicates` undefined.

- [ ] **Step 3: Implement `computeDuplicates`**

Append before `module.exports`:

```js
function computeDuplicates(articlesBySource, sourceRoles) {
  const primaryUrls = new Set();
  for (const [sourceName, articles] of Object.entries(articlesBySource)) {
    if (sourceRoles[sourceName] === 'primary') {
      for (const a of articles) primaryUrls.add(a.url);
    }
  }

  const dups = new Map();
  for (const [sourceName, articles] of Object.entries(articlesBySource)) {
    if (sourceRoles[sourceName] !== 'aggregator') continue;
    for (const a of articles) {
      const refs = [];
      if (a.quoted_tweet?.url) refs.push(a.quoted_tweet.url);
      if (a.expanded_urls) refs.push(...a.expanded_urls.map((u) => u.expanded_url).filter(Boolean));
      for (const ref of refs) {
        if (primaryUrls.has(ref)) {
          dups.set(a.url, ref);
          break;
        }
      }
    }
  }
  return dups;
}
```

Then update the export line:

```js
module.exports = { extractHandleFromUrl, computeThreadGroups, computeDuplicates };
```

- [ ] **Step 4: Run tests**

Run: `source /opt/homebrew/opt/nvm/nvm.sh && node --test scripts/lib/derive-refs.test.js`
Expected: all 15 tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/derive-refs.js scripts/lib/derive-refs.test.js
git commit -m "feat(derive-refs): computeDuplicates — aggregator→primary URL matching"
```

---

### Task 4: Integrate derive-refs into fetch-sources.js

**Files:**
- Modify: `scripts/fetch-sources.js`

The integration writes `thread_group_id` and `duplicate_of` onto each article in `output.sources[*].articles[*]`, defaulting to `null` for articles where no group/dup applies. This matches the existing analysis-cache shape.

- [ ] **Step 1: Inspect current fetch-sources.js structure**

Run: `grep -n "enrichSnapshot\|output\.sources" /Users/kevin/Projects/LLM-CatchUp/scripts/fetch-sources.js`
Expected: confirms `enrichSnapshot` is called around line 148; `output.sources[name]` is populated in the source loop.

- [ ] **Step 2: Add derive-refs import**

In `scripts/fetch-sources.js`, below the `enrich` require:

```js
const { computeThreadGroups, computeDuplicates } = require('./lib/derive-refs');
```

- [ ] **Step 3: Apply after enrichment**

After the `await enrichSnapshot(output, sourceConfigs);` line (around line 148), add:

```js
  // Deterministic preprocessing of cross-article references so the LLM
  // routine only does per-article work. See docs/prompts/daily-trigger.md
  // Step 3 — these fields are authoritative from fetch-time.
  const articlesBySource = {};
  const sourceRoles = {};
  const allArticles = [];
  for (const [name, entry] of Object.entries(output.sources)) {
    articlesBySource[name] = entry.articles || [];
    sourceRoles[name] = configByName[name]?.role || null;
    allArticles.push(...(entry.articles || []));
  }
  const threadGroups = computeThreadGroups(allArticles);
  const duplicates = computeDuplicates(articlesBySource, sourceRoles);
  for (const entry of Object.values(output.sources)) {
    for (const a of entry.articles || []) {
      a.thread_group_id = threadGroups.get(a.url) || null;
      a.duplicate_of = duplicates.get(a.url) || null;
    }
  }
  console.error(`derive-refs: ${threadGroups.size} thread members, ${duplicates.size} duplicates`);
```

- [ ] **Step 4: Dry-run against today's fetch-cache to sanity-check**

Run:
```bash
source /opt/homebrew/opt/nvm/nvm.sh && node -e '
const path = require("path");
const fs = require("fs");
const yaml = require("js-yaml");
const { computeThreadGroups, computeDuplicates } = require("./scripts/lib/derive-refs");
const fc = JSON.parse(fs.readFileSync("data/fetch-cache/2026-04-24.json", "utf8"));
const config = yaml.load(fs.readFileSync("config.yaml", "utf8"));
const configByName = Object.fromEntries(config.sources.map((s) => [s.name, s]));
const articlesBySource = {}, sourceRoles = {}, all = [];
for (const [name, entry] of Object.entries(fc.sources)) {
  articlesBySource[name] = entry.articles || [];
  sourceRoles[name] = configByName[name]?.role || null;
  all.push(...(entry.articles || []));
}
const t = computeThreadGroups(all);
const d = computeDuplicates(articlesBySource, sourceRoles);
console.log("thread members:", t.size, "→ groups:", new Set(t.values()).size);
console.log("duplicates:", d.size);
for (const [agg, prim] of d) console.log("  dup:", agg, "→", prim);
const groups = {};
for (const [url, id] of t) (groups[id] = groups[id] || []).push(url);
for (const [id, urls] of Object.entries(groups)) console.log("  thread", id, "→", urls.length, "tweets");
'
```
Expected: prints thread group counts and duplicate counts. Sanity: no thread should have a size of 1; duplicates should all involve aggregator→primary pairs.

- [ ] **Step 5: Commit**

```bash
git add scripts/fetch-sources.js
git commit -m "feat(fetch): pre-compute thread_group_id + duplicate_of deterministically

Moves the two cross-article fields out of the LLM routine and into
fetch-time preprocessing. Removes the hardest part of the daily
trigger's work (cross-article reasoning), paving the way for
per-article subagent parallelization."
```

---

### Task 5: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Find the fetch-cache article field list**

Run: `grep -n "reply_to\|expanded_urls\|quoted_tweet" /Users/kevin/Projects/LLM-CatchUp/CLAUDE.md`
Expected: line ~44 has the canonical list.

- [ ] **Step 2: Add the two new fields**

In `CLAUDE.md`, find:

```
  - `articles`: list of `{ title, url, published_at, description, full_text?, linked_content?, expanded_urls?, quoted_tweet?, reply_to? }` — already pre-filtered to `window_hours` of recency (overlap with yesterday is handled by URL-hash dedup in history.json).
```

Change to:

```
  - `articles`: list of `{ title, url, published_at, description, full_text?, linked_content?, expanded_urls?, quoted_tweet?, reply_to?, thread_group_id?, duplicate_of? }` — already pre-filtered to `window_hours` of recency (overlap with yesterday is handled by URL-hash dedup in history.json).
```

Then, below the `reply_to` bullet, add:

```
  - `thread_group_id` (Twitter): `thread-{handle}-{YYYYMMDD-HHMM}` (UTC) when this tweet is part of a self-reply chain whose adjacent links are within 5 minutes; else null. Computed deterministically in `scripts/lib/derive-refs.js` — the routine no longer infers this.
  - `duplicate_of` (Twitter): URL of a primary-source article when this aggregator article's `quoted_tweet.url` or any `expanded_urls[*].expanded_url` points at one; else null. Also deterministic; the routine no longer infers this.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: note that fetch-cache now carries pre-computed thread/dup fields"
```

---

## Phase 2: Subagent Architecture

### Task 6: Rewrite daily-trigger.md — subagent flow

**Files:**
- Rewrite: `docs/prompts/daily-trigger.md`

The rewrite replaces the serial per-article loop with a fan-out pattern. Analysis fields shrink to 6 (no thread_group_id, no duplicate_of — they arrive pre-computed).

- [ ] **Step 1: Draft the new prompt**

Replace the entire contents of `docs/prompts/daily-trigger.md` with:

```markdown
# CatchUp Daily Trigger — Analysis Only (Subagent Fan-Out)

You produce structured analysis of today's AI news into `data/analysis-cache/{date}.json`. You do NOT render the report, update history, update health, or manage GitHub issues — a post-processor handles all that.

Read `CLAUDE.md` first for project context.

## Workflow

### Step 1: Determine today's date

Use Asia/Shanghai timezone, YYYY-MM-DD format. Record as `{date}`.

### Step 2: Load today's fetch-cache

Read `data/fetch-cache/{date}.json`.

**If the file does not exist**: abort immediately. Write one line to stderr (`fetch-cache missing for {date} — aborting`) and exit without committing anything. Do NOT attempt to WebFetch or fabricate content.

### Step 3: Check for resume state

Read `data/analysis-cache/{date}.json` if it exists. Collect the URLs already present in `articles[].url` — call this set `analyzed_urls`.

If the file does not exist, `analyzed_urls` is empty.

### Step 4: Collect remaining articles

Iterate `fetch-cache.sources`. For each source with `status === "ok"` or `status === "degraded_stale"`, collect each `article` whose `url` is NOT in `analyzed_urls`. Attach the source name onto each article so the subagent can reference it. Call this list `remaining`.

If `remaining` is empty, skip to Step 8 (nothing to analyze; file unchanged).

### Step 5: Chunk and dispatch subagents

Split `remaining` into chunks of **10 articles** each (the last chunk may be smaller). For each chunk `i` (0-indexed), dispatch ONE subagent using the `Agent` tool. **Dispatch all chunks in a SINGLE message with multiple Agent tool calls** so they run in parallel.

Each subagent receives a prompt of this shape:

```
You are a news-analyzer subagent for CatchUp. Analyze these {N} articles from today's batch and write your results to `data/analysis-cache/{date}.chunk-{i}.json`.

For EACH article, produce a JSON object with these 6 fields:

1. title — a concise Chinese title (≤ 40 汉字 or ≤ 60 字符) capturing the article's central claim. Do NOT just truncate the raw tweet text / fetch-cache title — synthesize. Examples of good titles: "Anthropic × Amazon 扩大合作：5GW 算力 + 50 亿美元追投", "Qwen3.6-27B：27B 稠密开源模型打平 397B-A17B 代码基准". Bad: raw tweet first-200-chars; hashtag dumps.
2. summary — 2-3 Chinese sentences. Prioritize content in this order: `article.linked_content` > `article.full_text` > `article.quoted_tweet.text + article.description` > `article.description`.
3. category — one of: 模型发布, 研究, 产品与功能, 商业动态, 政策与安全, 教程与观点
4. importance — integer 1-5:
   - 5: NEW MODEL RELEASE (GPT-5, Claude 5, Gemini 3, major open-weight SOTA)
   - 4: SIGNIFICANT RESEARCH/PRODUCT (paper with empirical result, major product launch)
   - 3: NOTABLE UPDATE (feature release, partnership, funding, policy/regulatory, expert deep-dive)
   - 2: INCREMENTAL (small feature tweak, single observation)
   - 1: LOW-SIGNAL (greeting, meme, reply fragment)
5. tags — 3-5 Chinese keywords (array).
6. practice_suggestions — 1-3 concrete actionable Chinese suggestions, ONLY if `category ∈ {模型发布, 产品与功能}`. Omit otherwise.

Also carry through two fields UNMODIFIED from the fetch-cache article (do NOT recompute): `thread_group_id`, `duplicate_of`. They are already authoritative.

Write a single JSON file to `data/analysis-cache/{date}.chunk-{i}.json` with shape:

```
{
  "chunk_index": {i},
  "articles": [
    {
      "url": "...", "source": "...", "title": "...", "summary": "...",
      "category": "...", "importance": N, "tags": ["..."],
      "practice_suggestions": ["..."] (optional, omit if not applicable),
      "thread_group_id": null_or_string,
      "duplicate_of": null_or_string
    },
    ...
  ]
}
```

Articles to analyze:

{INLINE THE N ARTICLES HERE — full fields: url, source, title, published_at, description, full_text, linked_content, quoted_tweet, expanded_urls, reply_to, thread_group_id, duplicate_of}

Return just "done" when the file is written.
```

### Step 6: Wait for all subagents, then merge

When all subagent calls return, for each chunk `i` in `[0..chunks-1]`:
- Read `data/analysis-cache/{date}.chunk-{i}.json`
- Append its `articles[]` into the master articles list

If a chunk file is missing (subagent failed), note the chunk index and continue — the missed articles will be re-tried tomorrow since they won't be in the committed analysis-cache.

### Step 7: Assemble resume-merged articles

Merge:
- Pre-existing `articles` from `data/analysis-cache/{date}.json` (if it existed at Step 3)
- Plus the new articles from Step 6

Call the combined list `final_articles`.

### Step 8: Compute trend_paragraph

Write a 3-6 Chinese sentence trend paragraph synthesizing the day's themes, based on `final_articles[*].title` + `summary`. (You do NOT need the raw articles — the summaries are enough.)

### Step 9: Write the analysis-cache

Write `data/analysis-cache/{date}.json`:

```json
{
  "analyzed_at": "{ISO 8601 timestamp, Asia/Shanghai}",
  "fetch_cache_ref": "data/fetch-cache/{date}.json",
  "trend_paragraph": "...",
  "articles": [ ...final_articles ]
}
```

### Step 10: Cleanup and commit

Delete all `data/analysis-cache/{date}.chunk-*.json` scratch files.

```bash
git add data/analysis-cache/{date}.json
git commit -m "chore(catchup): daily analysis {date}"
git push
```

If `git diff --cached` is empty (no new articles this run), skip the commit.
```

- [ ] **Step 2: Verify character count is reasonable**

Run: `wc -c /Users/kevin/Projects/LLM-CatchUp/docs/prompts/daily-trigger.md`
Expected: under 6000 chars (the old prompt was ~4200; new is a bit longer due to embedded subagent template but comparable).

- [ ] **Step 3: Commit**

```bash
git add docs/prompts/daily-trigger.md
git commit -m "feat(prompt): daily trigger dispatches parallel subagents per chunk

Removes cross-article reasoning from the LLM (now deterministic in
fetch-sources.js) and fans out per-article analysis to subagents
running in parallel. Main trigger's context stays small — it only
handles merge + trend paragraph + commit."
```

---

### Task 7: Local sanity probe — 1 subagent, small chunk

Before syncing to the live trigger, verify the Agent tool returns a well-formed subagent call in our own environment. We'll prepare a tiny fixture and dispatch one subagent using the new prompt template.

**Files:**
- No file changes.

- [ ] **Step 1: Pick 3 articles from today's fetch-cache as fixture**

Run:
```bash
node -e '
const fs = require("fs");
const fc = JSON.parse(fs.readFileSync("data/fetch-cache/2026-04-24.json", "utf8"));
const picks = [];
for (const [name, s] of Object.entries(fc.sources)) {
  for (const a of (s.articles || [])) {
    if (picks.length >= 3) break;
    picks.push({ ...a, source: name });
  }
  if (picks.length >= 3) break;
}
fs.writeFileSync("/tmp/subagent-probe-chunk.json", JSON.stringify({ chunk_index: 0, articles: picks }, null, 2));
console.log("wrote /tmp/subagent-probe-chunk.json with", picks.length, "articles");
'
```

- [ ] **Step 2: Dispatch one subagent manually (as main agent in this session)**

Use the `Agent` tool with subagent_type=`general-purpose`, prompt = the new subagent template from the daily-trigger.md Step 5, with `{N}=3`, `{date}=2026-04-24-probe`, and the 3 fixture articles inlined from `/tmp/subagent-probe-chunk.json`. Expected: subagent writes to `data/analysis-cache/2026-04-24-probe.chunk-0.json` and returns "done".

- [ ] **Step 3: Verify output shape**

```bash
node -e '
const fs = require("fs");
const out = JSON.parse(fs.readFileSync("data/analysis-cache/2026-04-24-probe.chunk-0.json", "utf8"));
console.log("chunk_index:", out.chunk_index);
console.log("articles:", out.articles.length);
for (const a of out.articles) {
  const keys = Object.keys(a).sort().join(",");
  console.log(" ", a.url.slice(0, 60), "fields:", keys);
}
'
```
Expected: 3 articles each with `category,importance,source,summary,tags,thread_group_id,duplicate_of,title,url` (+ optional `practice_suggestions`).

- [ ] **Step 4: Clean up probe artifacts**

```bash
rm data/analysis-cache/2026-04-24-probe.chunk-0.json /tmp/subagent-probe-chunk.json
```

No commit — this is ephemeral validation.

---

### Task 8: Sync new prompt to live trigger

**Files:**
- Uses: `.claude/skills/sync-daily-trigger/`

- [ ] **Step 1: Invoke the sync skill**

The repo has a skill at `.claude/skills/sync-daily-trigger/SKILL.md` that uploads the current `docs/prompts/daily-trigger.md` to the live cloud trigger via RemoteTrigger. Invoke it:

Run the slash command `/sync-daily-trigger` (or follow the skill's procedure).

Expected: RemoteTrigger update succeeds with HTTP 200; skill reports the new `updated_at` timestamp.

- [ ] **Step 2: Note the trigger ID and updated timestamp in the commit log**

No code changes; the sync is a side-effect. If the skill saves an audit log, commit that. Otherwise, this task is complete when the skill reports success.

---

### Task 9: Post-run validation (tomorrow, 2026-04-25)

After tomorrow morning's scheduled run:

- [ ] **Step 1: Check that analysis-cache was produced**

Run: `git pull && ls -la data/analysis-cache/2026-04-25.json`
Expected: file exists.

- [ ] **Step 2: Check that no chunk-*.json scratch files leaked**

Run: `ls data/analysis-cache/2026-04-25.chunk-*.json 2>&1 || echo "none (ok)"`
Expected: "none (ok)" — main agent cleaned them up.

- [ ] **Step 3: Check that all fetch-cache articles are accounted for**

Run:
```bash
node -e '
const fs = require("fs");
const fc = JSON.parse(fs.readFileSync("data/fetch-cache/2026-04-25.json","utf8"));
const ac = JSON.parse(fs.readFileSync("data/analysis-cache/2026-04-25.json","utf8"));
const fcCount = Object.values(fc.sources).reduce((n,s)=>n+(s.articles?.length||0),0);
const acCount = ac.articles.length;
console.log("fetch-cache articles:", fcCount);
console.log("analysis-cache articles:", acCount);
console.log(fcCount === acCount ? "OK: all analyzed" : "WARN: mismatch");
'
```

- [ ] **Step 4: Check build-report's downstream output**

```bash
ls -la reports/daily/2026-04-25.md
```
Expected: file exists (build-report.yml fired on the analysis-cache push).

---

## Fallback Path — If Task 7 or Task 9 shows Agent tool is unavailable

If the subagent probe fails with an error like "Agent tool not available" in the Cloud Trigger environment, revert Phase 2 and replace with a serial-but-simpler prompt:

- Keep Phase 1's deterministic preprocessing (still a big win).
- Rewrite the prompt to loop articles serially, producing the 6 fields per article (no thread/dup reasoning), incremental per-article writes (as today).
- The simplified per-article work + dropped cross-article reasoning should reduce LLM thinking time enough that the idle timeout risk drops materially even without parallelism.

Specifically:
- Keep Tasks 1-5 (Phase 1) as-is.
- Replace Task 6's rewrite with a simplified serial prompt (remove thread_group_id / duplicate_of computation; those fields are carried through from fetch-cache).
- Skip Task 7-9; use a simpler post-run validation from the existing skill.

---

## Execution notes

- Phase 1 (Tasks 1-5) is independent — safe to merge and let run one fetch cycle to populate the two new fields before Phase 2 ships. But it's also fine to ship them together; if Phase 2 looks at a pre-Phase-1 fetch-cache, the fields will just be `undefined` and the subagent template will pass `null` through — which is the same behavior as a clean empty batch.
- Live trigger sync (Task 8) is the point of no return for Phase 2. Keep Phase 1 commits separate from Phase 2 commits so a Phase 2 rollback doesn't undo Phase 1.
- Always stage the commit on `main` only after local tests pass.
