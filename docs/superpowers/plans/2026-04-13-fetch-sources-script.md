# Fetch-Sources Script Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local Node.js script that fetches 5 AI news sources with a non-flagged User-Agent and writes a daily JSON snapshot, then rewire the Claude daily trigger to read that snapshot instead of hitting external URLs.

**Architecture:** Orchestrator (`scripts/fetch-sources.js`) reads `config.yaml`, dispatches to per-source route modules (`scripts/routes/*.js`) that use a shared HTTP helper with a `Mozilla/5.0 (compatible; CatchUp/1.0; +...)` UA, bounded retry, and 30s timeout. Orchestrator applies a 24-hour publication-date window filter and writes `data/fetch-cache/YYYY-MM-DD.json`. Claude trigger's Step 3 is rewritten to read this file; Step 8 is simplified to two-state health mapping.

**Tech Stack:** Node.js ≥ 20 managed via nvm (pinned in `.nvmrc`), `pnpm` as package manager (not npm), deps: `js-yaml` ^4, `cheerio` ^1, `rss-parser` ^3.

**Spec:** `docs/superpowers/specs/2026-04-13-fetch-sources-script-design.md`

---

## Task 1: Project scaffolding

**Files:**
- Create: `.nvmrc`
- Create: `package.json`
- Modify: `.gitignore` (append `node_modules/`)
- Create: `scripts/` (directory)
- Create: `scripts/lib/` (directory)
- Create: `scripts/routes/` (directory)
- Create: `data/fetch-cache/` (directory, with `.gitkeep`)

**Toolchain note:** This project uses **nvm + pnpm**, not system node + npm. Node is pinned via `.nvmrc`; pnpm is the package manager (produces `pnpm-lock.yaml`, not `package-lock.json`). Non-interactive shells (including Bash-tool invocations) do not automatically source nvm. For any command that needs node/pnpm, prepend `source /opt/homebrew/opt/nvm/nvm.sh &&` so nvm puts Node on PATH.

- [ ] **Step 1: Verify Node version via nvm**

Run: `source /opt/homebrew/opt/nvm/nvm.sh && nvm use 20 && node --version && pnpm --version`
Expected: Node `v20.x.x` and pnpm `10.x` (or newer). If `pnpm` is missing, report BLOCKED.

- [ ] **Step 2: Create `.nvmrc`**

```
20
```

(single line, just the major version — nvm will pick the latest 20.x installed)

- [ ] **Step 3: Write `package.json`**

```json
{
  "name": "llm-catchup",
  "version": "0.1.0",
  "private": true,
  "type": "commonjs",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "fetch": "node scripts/fetch-sources.js"
  },
  "dependencies": {
    "cheerio": "^1.0.0",
    "js-yaml": "^4.1.0",
    "rss-parser": "^3.13.0"
  }
}
```

- [ ] **Step 4: Append `node_modules/` to `.gitignore`**

The existing `.gitignore` has:
```
.DS_Store
*.swp
*.swo
.worktrees/
```

Append a single line `node_modules/`, so the file becomes:
```
.DS_Store
*.swp
*.swo
.worktrees/
node_modules/
```

- [ ] **Step 5: Install dependencies with pnpm**

Run from the worktree root:
```bash
source /opt/homebrew/opt/nvm/nvm.sh && nvm use 20 && pnpm install
```

Expected: creates `node_modules/` and `pnpm-lock.yaml`. No errors. (Warnings about peer deps are fine.)

- [ ] **Step 6: Create directory structure**

```bash
mkdir -p scripts/lib scripts/routes data/fetch-cache
touch data/fetch-cache/.gitkeep
```

- [ ] **Step 7: Verify layout**

Run: `ls scripts/ scripts/lib/ scripts/routes/ data/fetch-cache/`
Expected: all directories exist; `data/fetch-cache/` contains `.gitkeep`.

- [ ] **Step 8: Commit**

```bash
git add .nvmrc package.json pnpm-lock.yaml .gitignore data/fetch-cache/.gitkeep
git commit -m "chore(catchup): scaffold fetch-sources script (nvm + pnpm + dirs)"
```

---

## Task 2: HTTP helper with retry + timeout + UA

**Files:**
- Create: `scripts/lib/http.js`

- [ ] **Step 1: Write `scripts/lib/http.js`**

```javascript
const UA = 'Mozilla/5.0 (compatible; CatchUp/1.0; +https://github.com/Zerokei/LLM-CatchUp)';
const TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 3_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isRetryable(err, response) {
  if (response) return response.status >= 500 && response.status < 600;
  const code = err?.cause?.code || err?.code;
  return ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT'].includes(code);
}

async function fetchText(url, { headers = {} } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, ...headers },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status}`);
        err.status = res.status;
        if (isRetryable(null, res) && attempt < MAX_ATTEMPTS) {
          lastErr = err;
          await sleep(RETRY_DELAY_MS);
          continue;
        }
        throw err;
      }
      return await res.text();
    } catch (err) {
      lastErr = err;
      if (err.name === 'TimeoutError' || err.name === 'AbortError') {
        lastErr = new Error(`timeout after ${TIMEOUT_MS / 1000}s`);
      }
      if (attempt < MAX_ATTEMPTS && (isRetryable(err) || err.name === 'TimeoutError' || err.name === 'AbortError')) {
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      throw lastErr;
    }
  }
  throw lastErr;
}

module.exports = { fetchText, UA };
```

- [ ] **Step 2: Smoke-test against a known-good endpoint**

Create a scratch file `/tmp/test-http.js`:
```javascript
const { fetchText } = require('/Users/kevin/Projects/LLM-CatchUp/scripts/lib/http');
fetchText('https://httpbin.org/user-agent').then(t => console.log(t)).catch(e => console.error('FAIL:', e.message));
```

Run: `node /tmp/test-http.js`
Expected: prints JSON with `"user-agent": "Mozilla/5.0 (compatible; CatchUp/1.0; +https://github.com/Zerokei/LLM-CatchUp)"`.

- [ ] **Step 3: Delete the scratch file**

Run: `rm /tmp/test-http.js`

- [ ] **Step 4: Commit**

```bash
git add scripts/lib/http.js
git commit -m "feat(catchup): http helper with UA + retry + timeout"
```

---

## Task 3: RSS parser wrapper + RSS route factory

**Files:**
- Create: `scripts/lib/xml.js`
- Create: `scripts/lib/rss-route.js`

- [ ] **Step 1: Write `scripts/lib/xml.js`**

```javascript
const Parser = require('rss-parser');

const parser = new Parser({
  timeout: 30_000,
  headers: {},
});

async function parseRss(xmlString) {
  return await parser.parseString(xmlString);
}

module.exports = { parseRss };
```

- [ ] **Step 2: Write `scripts/lib/rss-route.js` (factory for RSS-type routes)**

```javascript
const { fetchText } = require('./http');
const { parseRss } = require('./xml');

function makeRssRoute({ name, sourceUrl }) {
  return {
    name,
    sourceType: 'rss',
    sourceUrl,
    async fetch() {
      try {
        const xml = await fetchText(sourceUrl);
        const feed = await parseRss(xml);
        const articles = (feed.items || []).map((item) => {
          const isoDate = item.isoDate || (item.pubDate ? new Date(item.pubDate).toISOString() : null);
          return {
            title: (item.title || '').trim(),
            url: item.link || '',
            published_at: isoDate,
            description: (item.contentSnippet || item.content || item.description || '').trim(),
          };
        });
        return { articles, error: null };
      } catch (err) {
        return { articles: [], error: err.message };
      }
    },
  };
}

module.exports = { makeRssRoute };
```

- [ ] **Step 3: Commit**

```bash
git add scripts/lib/xml.js scripts/lib/rss-route.js
git commit -m "feat(catchup): rss parser wrapper and route factory"
```

---

## Task 4: HTML parser wrapper

**Files:**
- Create: `scripts/lib/html.js`

- [ ] **Step 1: Write `scripts/lib/html.js`**

```javascript
const cheerio = require('cheerio');
const { fetchText } = require('./http');

async function fetchHtml(url) {
  const html = await fetchText(url);
  return cheerio.load(html);
}

function absoluteUrl(href, base) {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

module.exports = { fetchHtml, absoluteUrl };
```

- [ ] **Step 2: Commit**

```bash
git add scripts/lib/html.js
git commit -m "feat(catchup): html fetch+parse wrapper"
```

---

## Task 5: RSS route files (OpenAI, Google AI, Berkeley RDI)

**Files:**
- Create: `scripts/routes/openai-blog.js`
- Create: `scripts/routes/google-ai-blog.js`
- Create: `scripts/routes/berkeley-rdi.js`

- [ ] **Step 1: Write `scripts/routes/openai-blog.js`**

```javascript
const { makeRssRoute } = require('../lib/rss-route');

module.exports = makeRssRoute({
  name: 'OpenAI Blog',
  sourceUrl: 'https://openai.com/blog/rss.xml',
});
```

- [ ] **Step 2: Write `scripts/routes/google-ai-blog.js`**

```javascript
const { makeRssRoute } = require('../lib/rss-route');

module.exports = makeRssRoute({
  name: 'Google AI Blog',
  sourceUrl: 'https://blog.google/technology/ai/rss/',
});
```

- [ ] **Step 3: Write `scripts/routes/berkeley-rdi.js`**

```javascript
const { makeRssRoute } = require('../lib/rss-route');

module.exports = makeRssRoute({
  name: 'Berkeley RDI',
  sourceUrl: 'https://berkeleyrdi.substack.com/feed',
});
```

- [ ] **Step 4: Smoke-test each route standalone**

Create `/tmp/test-route.js`:
```javascript
const route = require(process.argv[2]);
route.fetch().then(r => console.log(JSON.stringify(r, null, 2))).catch(e => console.error(e));
```

Run (from repo root):
```bash
node /tmp/test-route.js ./scripts/routes/openai-blog.js
node /tmp/test-route.js ./scripts/routes/google-ai-blog.js
node /tmp/test-route.js ./scripts/routes/berkeley-rdi.js
```

Expected for each: JSON with `articles` array (non-empty, each item has title/url/published_at/description), `error: null`.

**Known issue to surface, not fix here**: OpenAI RSS feed is stale (latest entry from December 2025). This is expected per spec §13 and will be fixed out-of-scope by updating `config.yaml` later. For now the route returning old articles is correct behavior — the 24h filter in the orchestrator will produce an empty `articles[]` for OpenAI.

- [ ] **Step 5: Delete scratch file**

Run: `rm /tmp/test-route.js`

- [ ] **Step 6: Commit**

```bash
git add scripts/routes/openai-blog.js scripts/routes/google-ai-blog.js scripts/routes/berkeley-rdi.js
git commit -m "feat(catchup): RSS routes (OpenAI, Google AI, Berkeley RDI)"
```

---

## Task 6: Anthropic Blog route (web_scraper)

**Files:**
- Create: `scripts/routes/anthropic-blog.js`

- [ ] **Step 1: Inspect the live HTML structure**

Use WebFetch (or the browser DevTools locally) on `https://www.anthropic.com/news` to identify:
1. The CSS selector for a news-card container
2. Where within each card the title, link, and date live

Record findings as comments in the route file. Known as of 2026-04-13: cards are `<a>` elements under the main content area, each containing a heading and a date. Selectors may need adjustment — write them to be explicit and easy to update.

- [ ] **Step 2: Write `scripts/routes/anthropic-blog.js`**

```javascript
const { fetchHtml, absoluteUrl } = require('../lib/html');

const SOURCE_URL = 'https://www.anthropic.com/news';

// Anthropic /news page structure (verified 2026-04-13):
//   Each news card is an <a> under the main listing area, containing:
//   - Title inside a heading element (h2/h3)
//   - Date in a <div> with date-like text (e.g. "Apr 7, 2026")
// If extractor starts returning empty arrays, inspect live HTML and update selectors below.
const CARD_SELECTOR = 'main a[href^="/news/"]';
const TITLE_SELECTOR = 'h2, h3';
const DATE_SELECTOR = 'div, span';

function parseDateText(text) {
  if (!text) return null;
  const trimmed = text.trim();
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString();
}

module.exports = {
  name: 'Anthropic Blog',
  sourceType: 'web_scraper',
  sourceUrl: SOURCE_URL,
  async fetch() {
    try {
      const $ = await fetchHtml(SOURCE_URL);
      const articles = [];
      const seenUrls = new Set();

      $(CARD_SELECTOR).each((_, el) => {
        const $card = $(el);
        const href = $card.attr('href');
        if (!href) return;
        const url = absoluteUrl(href, SOURCE_URL);
        if (seenUrls.has(url)) return;

        const title = $card.find(TITLE_SELECTOR).first().text().trim();
        if (!title) return;

        let published_at = null;
        $card.find(DATE_SELECTOR).each((_, d) => {
          if (published_at) return;
          const parsed = parseDateText($(d).text());
          if (parsed) published_at = parsed;
        });

        const description = $card.text().replace(title, '').trim().slice(0, 500);

        seenUrls.add(url);
        articles.push({ title, url, published_at, description });
      });

      return { articles, error: null };
    } catch (err) {
      return { articles: [], error: err.message };
    }
  },
};
```

- [ ] **Step 3: Smoke-test**

Create `/tmp/test-route.js` (same content as Task 5 Step 4), run:
```bash
node /tmp/test-route.js ./scripts/routes/anthropic-blog.js
```

Expected: JSON with non-empty `articles[]`, each having title/url/published_at/description. If `articles` is empty or dates are all null, the selectors need adjustment — inspect the HTML (`curl -A 'Mozilla/5.0 ...' https://www.anthropic.com/news | less`) and tune selectors in the route file. Re-test after each tweak.

- [ ] **Step 4: Delete scratch file**

Run: `rm /tmp/test-route.js`

- [ ] **Step 5: Commit**

```bash
git add scripts/routes/anthropic-blog.js
git commit -m "feat(catchup): Anthropic Blog web_scraper route"
```

---

## Task 7: The Batch route (web_scraper)

**Files:**
- Create: `scripts/routes/the-batch.js`

- [ ] **Step 1: Inspect the live HTML structure**

Use WebFetch on `https://www.deeplearning.ai/the-batch/` to identify selectors for:
- Article card container
- Title, link, date within each card

- [ ] **Step 2: Write `scripts/routes/the-batch.js`**

```javascript
const { fetchHtml, absoluteUrl } = require('../lib/html');

const SOURCE_URL = 'https://www.deeplearning.ai/the-batch/';

// The Batch index page structure (verified 2026-04-13):
//   Article cards are <a> elements with href starting with /the-batch/issue-
//   Each contains a heading (title) and usually a date element.
// Re-inspect HTML if extractor returns empty.
const CARD_SELECTOR = 'a[href*="/the-batch/issue-"], a[href*="/the-batch/"]:has(h2), a[href*="/the-batch/"]:has(h3)';
const TITLE_SELECTOR = 'h1, h2, h3';

function parseDateText(text) {
  if (!text) return null;
  const parsed = Date.parse(text.trim());
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

module.exports = {
  name: 'The Batch',
  sourceType: 'web_scraper',
  sourceUrl: SOURCE_URL,
  async fetch() {
    try {
      const $ = await fetchHtml(SOURCE_URL);
      const articles = [];
      const seenUrls = new Set();

      $(CARD_SELECTOR).each((_, el) => {
        const $card = $(el);
        const href = $card.attr('href');
        if (!href || !href.includes('/the-batch/')) return;
        if (href.endsWith('/the-batch/') || href.endsWith('/the-batch')) return;
        const url = absoluteUrl(href, SOURCE_URL);
        if (seenUrls.has(url)) return;

        const title = $card.find(TITLE_SELECTOR).first().text().trim();
        if (!title) return;

        let published_at = null;
        $card.find('time, [datetime]').each((_, t) => {
          if (published_at) return;
          const dt = $(t).attr('datetime') || $(t).text();
          const parsed = parseDateText(dt);
          if (parsed) published_at = parsed;
        });
        if (!published_at) {
          $card.find('span, div, p').each((_, d) => {
            if (published_at) return;
            const parsed = parseDateText($(d).text());
            if (parsed) published_at = parsed;
          });
        }

        const description = $card.text().replace(title, '').trim().slice(0, 500);

        seenUrls.add(url);
        articles.push({ title, url, published_at, description });
      });

      return { articles, error: null };
    } catch (err) {
      return { articles: [], error: err.message };
    }
  },
};
```

- [ ] **Step 3: Smoke-test**

```bash
node /tmp/test-route.js ./scripts/routes/the-batch.js
```

Expected: non-empty `articles[]`. If empty, inspect HTML and adjust `CARD_SELECTOR`.

- [ ] **Step 4: Commit**

```bash
git add scripts/routes/the-batch.js
git commit -m "feat(catchup): The Batch web_scraper route"
```

---

## Task 8: Routes barrel export

**Files:**
- Create: `scripts/routes/index.js`

- [ ] **Step 1: Write `scripts/routes/index.js`**

```javascript
module.exports = [
  require('./openai-blog'),
  require('./google-ai-blog'),
  require('./anthropic-blog'),
  require('./berkeley-rdi'),
  require('./the-batch'),
];
```

- [ ] **Step 2: Commit**

```bash
git add scripts/routes/index.js
git commit -m "feat(catchup): routes barrel export"
```

---

## Task 9: Orchestrator

**Files:**
- Create: `scripts/fetch-sources.js`

- [ ] **Step 1: Write `scripts/fetch-sources.js`**

```javascript
#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const routes = require('./routes');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(PROJECT_ROOT, 'config.yaml');
const CACHE_DIR = path.join(PROJECT_ROOT, 'data', 'fetch-cache');
const WINDOW_HOURS = 24;

function toShanghaiISO(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  return fmt.format(date).replace(' ', 'T') + '+08:00';
}

function shanghaiDateStr(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return fmt.format(date);
}

function withinWindow(article, windowStart, windowEnd) {
  if (!article.published_at) return false;
  const pub = new Date(article.published_at);
  if (Number.isNaN(pub.getTime())) return false;
  return pub >= windowStart && pub <= windowEnd;
}

async function main() {
  const configRaw = fs.readFileSync(CONFIG_PATH, 'utf8');
  const config = yaml.load(configRaw);
  const sourceNames = (config.sources || []).map((s) => s.name);

  const routeByName = Object.fromEntries(routes.map((r) => [r.name, r]));

  const fetchedAt = new Date();
  const windowEnd = fetchedAt;
  const windowStart = new Date(fetchedAt.getTime() - WINDOW_HOURS * 3600 * 1000);

  const output = {
    fetched_at: toShanghaiISO(fetchedAt),
    window_start: toShanghaiISO(windowStart),
    window_hours: WINDOW_HOURS,
    sources: {},
  };

  let anySuccess = false;

  for (const name of sourceNames) {
    const route = routeByName[name];
    if (!route) {
      console.error(`[${name}] no route module found — skipping`);
      output.sources[name] = {
        status: 'error',
        error: 'no route module found',
        fetched_count: 0,
        filtered_count: 0,
        articles: [],
      };
      continue;
    }

    console.error(`[${name}] fetching...`);
    const result = await route.fetch();
    if (result.error) {
      console.error(`[${name}] ERROR: ${result.error}`);
      output.sources[name] = {
        status: 'error',
        error: result.error,
        fetched_count: 0,
        filtered_count: 0,
        articles: [],
      };
      continue;
    }

    const fetchedCount = result.articles.length;
    const filtered = result.articles.filter((a) => withinWindow(a, windowStart, windowEnd));
    console.error(`[${name}] ok: ${filtered.length} of ${fetchedCount} within ${WINDOW_HOURS}h window`);
    output.sources[name] = {
      status: 'ok',
      error: null,
      fetched_count: fetchedCount,
      filtered_count: filtered.length,
      articles: filtered,
    };
    anySuccess = true;
  }

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const outPath = path.join(CACHE_DIR, `${shanghaiDateStr(fetchedAt)}.json`);
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n');
  console.error(`wrote ${outPath}`);

  process.exit(anySuccess ? 0 : 1);
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(2);
});
```

- [ ] **Step 2: Run the orchestrator end-to-end**

```bash
cd /Users/kevin/Projects/LLM-CatchUp
node scripts/fetch-sources.js
```

Expected stderr output:
```
[OpenAI Blog] fetching...
[OpenAI Blog] ok: 0 of N within 24h window   # 0 is fine — OpenAI RSS is stale
[Google AI Blog] fetching...
[Google AI Blog] ok: X of Y within 24h window
[Anthropic Blog] fetching...
[Anthropic Blog] ok: X of Y within 24h window
[Berkeley RDI] fetching...
[Berkeley RDI] ok: X of Y within 24h window
[The Batch] fetching...
[The Batch] ok: X of Y within 24h window
wrote /Users/kevin/Projects/LLM-CatchUp/data/fetch-cache/2026-04-13.json
```

Exit code 0.

- [ ] **Step 3: Inspect the output**

```bash
jq . data/fetch-cache/$(date +%Y-%m-%d).json | head -80
```

Expected: shape matches spec §5 — top-level `fetched_at`, `window_start`, `window_hours`, `sources`; each source has `status`, `error`, `fetched_count`, `filtered_count`, `articles[]`.

- [ ] **Step 4: Commit**

```bash
git add scripts/fetch-sources.js data/fetch-cache/
git commit -m "feat(catchup): fetch-sources orchestrator with 24h window filter"
```

---

## Task 10: Rewire Claude daily trigger prompt

**Files:**
- Modify: `docs/prompts/daily-trigger.md` (rewrite Step 3; simplify Step 8)

- [ ] **Step 1: Read current `docs/prompts/daily-trigger.md` to confirm line ranges**

Open the file and locate Step 3 (starting at `### Step 3: Fetch Sources`) and Step 8 (starting at `### Step 8: Update Health Status`). These are the only two sections to modify.

- [ ] **Step 2: Replace Step 3 entirely**

Find the current Step 3 section (from `### Step 3: Fetch Sources` through the end of its "For all sources" bullets, ending just before `### Step 3.5: Semantic Deduplication`). Replace the entire section with:

```markdown
### Step 3: Load Today's Fetch Cache

The actual source fetching has been moved to a local Node script (`scripts/fetch-sources.js`). This trigger does NOT fetch external URLs any more — it reads a pre-generated snapshot.

1. Determine today's date in Asia/Shanghai timezone (format `YYYY-MM-DD`).
2. Read the file `data/fetch-cache/{YYYY-MM-DD}.json`.
3. **If the file does not exist**: abort the run immediately. Do NOT attempt WebFetch. Do NOT use WebSearch to fabricate content. Write a single-line error to stderr (`fetch-cache missing for YYYY-MM-DD — aborting daily run`) and exit without committing anything. Do not generate a report. The missing cache is a signal that the upstream fetch script or its scheduler needs human attention.
4. Parse the JSON. Its shape is:
   - `fetched_at`, `window_start`, `window_hours` — metadata
   - `sources` — an object keyed by source name. Each entry has:
     - `status`: `"ok"` or `"error"`
     - `error`: null or string
     - `fetched_count`, `filtered_count`: numbers (for diagnostics)
     - `articles`: list of `{ title, url, published_at, description }` (already within the 24h window)
5. For each source in `sources`:
   - If `status === "ok"`: iterate `articles[]`. For each article, compute SHA-256 hash of the URL. Skip if already in `data/history.json`. Collect the rest as new articles for this run.
   - If `status === "error"`: note the error and the source name for Step 8 (health update). This source contributes zero articles to today's report.

**Newsletter splitting:** still applies. Berkeley RDI / The Batch may each produce a single newsletter article covering multiple topics. If you detect this pattern in an article's description, split it into separate entries per the existing rules (append `#topic-N` to URL, each entry independently categorized). This happens at this step, before dedup.
```

- [ ] **Step 3: Replace Step 8 entirely**

Find the current Step 8 section (from `### Step 8: Update Health Status` through its last bullet, ending just before `### Step 9: Handle Alerts`). Replace the entire section with:

```markdown
### Step 8: Update Health Status

For each source in config, update `data/health.json` using the `status` field from the fetch-cache JSON loaded in Step 3:

**If the source's `status === "ok"`:**
```json
{
  "status": "healthy",
  "last_success": "YYYY-MM-DDTHH:MM:SSZ",
  "consecutive_failures": 0
}
```

**If the source's `status === "error"`:**
- Increment `consecutive_failures`
- Copy the `error` field from the fetch-cache entry into `last_error`
- If `consecutive_failures` < `alerting.consecutive_failure_threshold` from config: set `status` to `"degraded"`
- If `consecutive_failures` >= threshold: set `status` to `"alert"` (Step 9 handles GitHub Issue creation)

The previous fallback-aware three-state accounting is retired. Under the new architecture there is no fallback — an error from the fetcher is a real, actionable error.
```

- [ ] **Step 4: Verify the edit**

Read the modified file and confirm:
- Step 3 now references `data/fetch-cache/...` and does NOT mention `WebFetch`
- Step 8 is the simplified two-state version
- Steps 1–2, 3.5, 4–7, 9–10 are unchanged
- No orphaned "primary_success" / "fallback_success" / "hard_failure" language remains anywhere in the file

- [ ] **Step 5: Commit**

```bash
git add docs/prompts/daily-trigger.md
git commit -m "refactor(catchup): rewire daily trigger to read fetch-cache JSON"
```

---

## Task 11: End-to-end verification

**Files:** none created/modified

- [ ] **Step 1: Re-run the fetch script to produce fresh cache**

```bash
cd /Users/kevin/Projects/LLM-CatchUp
node scripts/fetch-sources.js
ls -la data/fetch-cache/$(date +%Y-%m-%d).json
```

Expected: file exists, mtime is seconds ago.

- [ ] **Step 2: Sanity-check the cache contents**

```bash
jq '.sources | to_entries | map({name: .key, status: .value.status, count: .value.filtered_count})' data/fetch-cache/$(date +%Y-%m-%d).json
```

Expected output: an array with one entry per source, showing `status` and `count`. For any "error" entry, note the error field — this is the signal that a route needs investigation.

- [ ] **Step 3: Dry-run the Claude daily trigger locally**

In a separate local Claude Code session (not this planning session), paste the full content of `docs/prompts/daily-trigger.md` as the user message. Claude should:
1. Read `config.yaml` and `data/history.json`
2. Read `data/fetch-cache/{today}.json`
3. Produce a daily report under `reports/daily/{today}.md`
4. Update `data/history.json` and `data/health.json`
5. Commit and push — **STOP BEFORE PUSH**: since this is a verification run, instruct Claude to skip the `git push` at the end; staging + commit locally is enough.

- [ ] **Step 4: Audit the generated report**

```bash
cat reports/daily/$(date +%Y-%m-%d).md
```

Cross-check every article title and URL in the report against the cache JSON. Every article in the report MUST have a matching entry in `data/fetch-cache/{today}.json`. If Claude introduces any article not in the cache, that is a hallucination — the trigger prompt needs tightening in a follow-up.

- [ ] **Step 5: Audit `data/health.json`**

```bash
jq . data/health.json
```

Expected: all 5 sources have `status` either `"healthy"` or `"degraded"` (if any route returned error). No `"alert"` entries unless a source has legitimately been erroring for `alerting.consecutive_failure_threshold` consecutive runs.

- [ ] **Step 6: If the dry-run produced a committed verification report, decide what to do with it**

Two options:
1. **Keep it**: if the report looks good, treat it as today's real report. Leave the commits as-is.
2. **Discard it**: if the report has issues, `git reset --hard HEAD~N` (N = commits from the dry-run) to discard. Fix the trigger prompt or fetch script, then re-run from Step 1.

Ask Kevin before choosing — do not auto-discard.

- [ ] **Step 7: Final commit (if any tuning was needed)**

If any fixes were made during verification, commit them with an appropriate message and note in the commit body what was adjusted.

---

## Self-review checklist (for the plan author)

- Every task has a Files list showing exact paths ✓
- Every code step includes the actual code (no "implement X here") ✓
- Every test/run step includes the exact command ✓
- Commit messages follow the existing `chore(catchup)` / `feat(catchup)` style ✓
- Types / names consistent across tasks:
  - Route contract: `{ name, sourceType, sourceUrl, fetch }` — used consistently ✓
  - Article shape: `{ title, url, published_at, description }` — used consistently ✓
  - Source JSON entry shape: `{ status, error, fetched_count, filtered_count, articles }` — used consistently ✓
- No TBD / TODO / "similar to" placeholders ✓
- Spec coverage:
  - §4 Architecture (dirs, routes, lib) → Tasks 1–8 ✓
  - §5 Data contract → Task 9 Step 1 writes exactly this shape ✓
  - §6 24h filter → Task 9 `withinWindow` ✓
  - §7 Error handling → Task 2 (retry/timeout), Task 9 (per-source try/catch via route.fetch()) ✓
  - §8 UA → Task 2 ✓
  - §9 Dependencies → Task 1 package.json ✓
  - §10 Trigger integration → Task 10 ✓
  - §11 Execution (manual first) → Task 11 ✓
  - §12 Testing → per-route smoke tests in Tasks 5–7 + end-to-end in Task 11 ✓
  - §13 Risks → called out in Task 5 (OpenAI stale RSS), Tasks 6–7 (HTML structure changes) ✓
  - §14 Out-of-scope items (GH Actions, full-body fetch, etc.) — correctly NOT in plan ✓
