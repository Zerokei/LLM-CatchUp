# CatchUp Enrichment Implementation Plan (PR 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich fetch-cache articles so Claude's daily analysis works from real content, not RSS blurbs — via Jina Reader for blog sources + socialdata field preservation and optional Jina-follow for primary Twitter sources.

**Architecture:** A new `scripts/lib/enrich.js` exposes `enrichSnapshot()` and is called from `scripts/fetch-sources.js` after per-source fetches but before writing the JSON file. `scripts/lib/socialdata-twitter.js` is extended to preserve fields the upstream API already returns. Two blog routes (`berkeley-rdi.js`, `baoyu.js`) are updated to set `full_text` directly from content they already hold, avoiding double-fetching.

**Tech Stack:** Node 20 (via nvm, pinned in `.nvmrc`), pnpm, built-in `node --test`, existing `scripts/lib/http.js` for HTTP calls.

**Spec:** `docs/superpowers/specs/2026-04-22-enrichment-and-routine-slim-design.md`

**Toolchain note:** Non-interactive shells (including Bash tool invocations) don't auto-source nvm. Prepend `source /opt/homebrew/opt/nvm/nvm.sh &&` to any command that needs node/pnpm (tests, install).

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `scripts/lib/enrich.js` | create | `jinaFetch()` + `enrichSnapshot()` — adds `full_text` / `linked_content` to articles |
| `scripts/lib/enrich.test.js` | create | unit tests for jinaFetch + enrichSnapshot |
| `scripts/lib/socialdata-twitter.js` | modify | preserve `expanded_urls`, `quoted_tweet`, `reply_to` from upstream response |
| `scripts/lib/socialdata-twitter.test.js` | create | unit tests for the mapping from raw socialdata payload to article |
| `scripts/fetch-sources.js` | modify | call `enrichSnapshot(output, sourceConfigs)` after per-source loop |
| `scripts/routes/berkeley-rdi.js` | modify | set `full_text` directly from the jina-fetched body (no double-fetch) |
| `scripts/routes/baoyu.js` | modify | pass `preserveContentEncoded: true` to `makeRssRoute` so `full_text` comes from `content:encoded` |
| `scripts/lib/rss-route.js` | modify | accept `preserveContentEncoded` option; set `full_text` when present |
| `CLAUDE.md` | modify | document the new fetch-cache schema fields |

---

## Task 1: Scaffold `scripts/lib/enrich.js` with `jinaFetch` helper (TDD)

**Files:**
- Create: `scripts/lib/enrich.js`
- Create: `scripts/lib/enrich.test.js`

- [ ] **Step 1: Write failing tests for `jinaFetch`**

Create `scripts/lib/enrich.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { jinaFetch } = require('./enrich');

// The default fetch function goes through the real Jina URL via the project's
// fetchText helper. For unit tests we inject a stub via the second arg.

test('jinaFetch: returns text on success, truncated to MAX_CHARS', async () => {
  const big = 'x'.repeat(30_000);
  const fetchStub = async (url) => {
    assert.ok(url.startsWith('https://r.jina.ai/'), 'uses jina base');
    return big;
  };
  const out = await jinaFetch('https://openai.com/index/foo', { fetchImpl: fetchStub });
  assert.equal(out.length, 20_000);
});

test('jinaFetch: returns null on fetch error (does not throw)', async () => {
  const fetchStub = async () => { throw new Error('HTTP 403'); };
  const out = await jinaFetch('https://openai.com/index/foo', { fetchImpl: fetchStub });
  assert.equal(out, null);
});

test('jinaFetch: returns null on timeout', async () => {
  const fetchStub = async () => { throw new Error('timeout after 20s'); };
  const out = await jinaFetch('https://openai.com/index/foo', { fetchImpl: fetchStub });
  assert.equal(out, null);
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `source /opt/homebrew/opt/nvm/nvm.sh && node --test scripts/lib/enrich.test.js`

Expected: all three fail with `Cannot find module './enrich'` (the module doesn't exist yet).

- [ ] **Step 3: Write `jinaFetch` implementation**

Create `scripts/lib/enrich.js`:

```js
const { fetchText } = require('./http');

const JINA_BASE = 'https://r.jina.ai/';
const MAX_CHARS = 20_000;

async function jinaFetch(url, { fetchImpl } = {}) {
  const impl = fetchImpl || ((u) => fetchText(u, { headers: { Accept: 'text/plain' } }));
  try {
    const text = await impl(JINA_BASE + url);
    if (typeof text !== 'string') return null;
    return text.slice(0, MAX_CHARS);
  } catch {
    return null;
  }
}

module.exports = { jinaFetch, JINA_BASE, MAX_CHARS };
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `source /opt/homebrew/opt/nvm/nvm.sh && node --test scripts/lib/enrich.test.js`

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/enrich.js scripts/lib/enrich.test.js
git commit -m "feat(enrich): add jinaFetch helper with error-to-null conversion"
```

---

## Task 2: `enrichSnapshot` for blog sources (TDD)

**Files:**
- Modify: `scripts/lib/enrich.js`
- Modify: `scripts/lib/enrich.test.js`

- [ ] **Step 1: Append failing tests for `enrichSnapshot` blog path**

Add to `scripts/lib/enrich.test.js`:

```js
const { enrichSnapshot, BLOG_ENRICH_SOURCES } = require('./enrich');

function makeSnapshot(extra = {}) {
  return {
    sources: {
      'OpenAI Blog': {
        status: 'ok',
        articles: [
          { title: 'hello', url: 'https://openai.com/index/hello',
            published_at: '2026-04-22', description: 'short' },
        ],
      },
      'Sam Altman (Twitter)': {
        status: 'ok',
        articles: [
          { title: 'tweet', url: 'https://x.com/sama/status/1',
            published_at: '2026-04-22', description: 'tweet text' },
        ],
      },
      ...extra,
    },
  };
}

test('enrichSnapshot: blog source gets full_text, Twitter source untouched', async () => {
  const snapshot = makeSnapshot();
  const calls = [];
  const fetchImpl = async (u) => { calls.push(u); return 'ENRICHED BODY'; };
  await enrichSnapshot(snapshot, /* sourceConfigs */ [
    { name: 'OpenAI Blog', role: 'primary' },
    { name: 'Sam Altman (Twitter)', role: 'aggregator' },
  ], { fetchImpl });
  assert.equal(snapshot.sources['OpenAI Blog'].articles[0].full_text, 'ENRICHED BODY');
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes('/openai.com/index/hello'));
  assert.equal('full_text' in snapshot.sources['Sam Altman (Twitter)'].articles[0], false);
});

test('enrichSnapshot: blog fetch failure → full_text null (no throw)', async () => {
  const snapshot = makeSnapshot();
  const fetchImpl = async () => { throw new Error('HTTP 403'); };
  await enrichSnapshot(snapshot, [{ name: 'OpenAI Blog', role: 'primary' }], { fetchImpl });
  assert.equal(snapshot.sources['OpenAI Blog'].articles[0].full_text, null);
});

test('enrichSnapshot: source with status error is skipped (no fetch, no full_text)', async () => {
  const snapshot = {
    sources: {
      'OpenAI Blog': {
        status: 'error', error: 'HTTP 500',
        articles: [],  // real shape has empty articles on error
      },
    },
  };
  let called = false;
  const fetchImpl = async () => { called = true; return 'x'; };
  await enrichSnapshot(snapshot, [{ name: 'OpenAI Blog', role: 'primary' }], { fetchImpl });
  assert.equal(called, false);
});

test('BLOG_ENRICH_SOURCES: exactly the five blog sources in the spec', () => {
  assert.deepEqual([...BLOG_ENRICH_SOURCES].sort(), [
    'Anthropic Blog', 'Anthropic Research', 'Google AI Blog', 'OpenAI Blog', 'The Batch',
  ]);
});
```

- [ ] **Step 2: Run tests, confirm they fail**

Run: `source /opt/homebrew/opt/nvm/nvm.sh && node --test scripts/lib/enrich.test.js`

Expected: 4 new tests fail (`enrichSnapshot`, `BLOG_ENRICH_SOURCES` not exported).

- [ ] **Step 3: Implement `enrichSnapshot` blog path**

Append to `scripts/lib/enrich.js` (before `module.exports`):

```js
const BLOG_ENRICH_SOURCES = new Set([
  'OpenAI Blog', 'Google AI Blog', 'Anthropic Blog', 'Anthropic Research', 'The Batch',
]);

async function enrichSnapshot(snapshot, sourceConfigs, { fetchImpl } = {}) {
  for (const [sourceName, entry] of Object.entries(snapshot.sources)) {
    if (entry.status !== 'ok' && entry.status !== 'degraded_stale') continue;
    if (!BLOG_ENRICH_SOURCES.has(sourceName)) continue;
    for (const article of entry.articles) {
      article.full_text = await jinaFetch(article.url, { fetchImpl });
    }
  }
}
```

Update the `module.exports` line to also export `enrichSnapshot` and `BLOG_ENRICH_SOURCES`:

```js
module.exports = { jinaFetch, enrichSnapshot, BLOG_ENRICH_SOURCES, JINA_BASE, MAX_CHARS };
```

- [ ] **Step 4: Run tests, confirm all pass**

Run: `source /opt/homebrew/opt/nvm/nvm.sh && node --test scripts/lib/enrich.test.js`

Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/enrich.js scripts/lib/enrich.test.js
git commit -m "feat(enrich): enrichSnapshot populates full_text for blog sources"
```

---

## Task 3: Twitter route preserves expanded_urls / quoted_tweet / reply_to (TDD)

**Files:**
- Create: `scripts/lib/socialdata-twitter.test.js`
- Modify: `scripts/lib/socialdata-twitter.js`

- [ ] **Step 1: Write failing tests for field preservation**

Create `scripts/lib/socialdata-twitter.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mapTweetsToArticles } = require('./socialdata-twitter');

// One raw socialdata tweet covering the "announcement + linked blog" pattern.
const TWEET_WITH_URL_AND_QUOTE = {
  id_str: '2046227759475921291',
  full_text: '🚀 Introducing Qwen3.6-Max-Preview\nBlog: https://t.co/6hDQJhmkjM',
  tweet_created_at: '2026-04-20T14:01:29.000Z',
  user: { screen_name: 'Alibaba_Qwen' },
  entities: {
    urls: [
      { url: 'https://t.co/6hDQJhmkjM',
        expanded_url: 'https://qwenlm.github.io/blog/qwen3.6-max/',
        display_url: 'qwenlm.github.io/blog/qwen3.6-m…' },
    ],
    user_mentions: [], hashtags: [], symbols: [],
  },
  is_quote_status: true,
  quoted_status: {
    id_str: '123456',
    full_text: 'Scale matters.',
    user: { screen_name: 'someoneelse' },
  },
  in_reply_to_status_id_str: null,
  in_reply_to_screen_name: null,
};

const TWEET_PLAIN = {
  id_str: '111',
  full_text: 'just a tweet',
  tweet_created_at: '2026-04-20T12:00:00.000Z',
  user: { screen_name: 'sama' },
  entities: { urls: [], user_mentions: [], hashtags: [], symbols: [] },
  is_quote_status: false,
  quoted_status: null,
  in_reply_to_status_id_str: null,
  in_reply_to_screen_name: null,
};

const TWEET_REPLY = {
  id_str: '222',
  full_text: 'yes exactly',
  tweet_created_at: '2026-04-20T13:00:00.000Z',
  user: { screen_name: 'sama' },
  entities: { urls: [], user_mentions: [], hashtags: [], symbols: [] },
  is_quote_status: false,
  quoted_status: null,
  in_reply_to_status_id_str: '2046000000000000000',
  in_reply_to_screen_name: 'pg',
};

test('mapTweetsToArticles: preserves expanded_urls', () => {
  const [a] = mapTweetsToArticles([TWEET_WITH_URL_AND_QUOTE], 'Alibaba_Qwen');
  assert.deepEqual(a.expanded_urls, [
    { t_co: 'https://t.co/6hDQJhmkjM',
      expanded_url: 'https://qwenlm.github.io/blog/qwen3.6-max/',
      display_url: 'qwenlm.github.io/blog/qwen3.6-m…' },
  ]);
});

test('mapTweetsToArticles: preserves quoted_tweet when is_quote_status', () => {
  const [a] = mapTweetsToArticles([TWEET_WITH_URL_AND_QUOTE], 'Alibaba_Qwen');
  assert.deepEqual(a.quoted_tweet, {
    author: 'someoneelse',
    text: 'Scale matters.',
    url: 'https://x.com/someoneelse/status/123456',
  });
});

test('mapTweetsToArticles: quoted_tweet is null when not a quote-tweet', () => {
  const [a] = mapTweetsToArticles([TWEET_PLAIN], 'sama');
  assert.equal(a.quoted_tweet, null);
});

test('mapTweetsToArticles: reply_to set when in_reply_to_status_id_str present', () => {
  const [a] = mapTweetsToArticles([TWEET_REPLY], 'sama');
  assert.deepEqual(a.reply_to, { screen_name: 'pg', status_id: '2046000000000000000' });
});

test('mapTweetsToArticles: reply_to is null for non-reply tweets', () => {
  const [a] = mapTweetsToArticles([TWEET_PLAIN], 'sama');
  assert.equal(a.reply_to, null);
});

test('mapTweetsToArticles: existing fields (title, url, description, published_at) unchanged', () => {
  const [a] = mapTweetsToArticles([TWEET_PLAIN], 'sama');
  assert.equal(a.title, 'just a tweet');
  assert.equal(a.url, 'https://x.com/sama/status/111');
  assert.equal(a.description, 'just a tweet');
  assert.equal(a.published_at, '2026-04-20T12:00:00.000Z');
});
```

- [ ] **Step 2: Run tests, confirm they fail**

Run: `source /opt/homebrew/opt/nvm/nvm.sh && node --test scripts/lib/socialdata-twitter.test.js`

Expected: fails — `mapTweetsToArticles` is not yet exported.

- [ ] **Step 3: Refactor `socialdata-twitter.js` to extract and export `mapTweetsToArticles`**

Replace the file contents of `scripts/lib/socialdata-twitter.js`:

```js
const { fetchText } = require('./http');

const BASE = 'https://api.socialdata.tools';

function mapTweetsToArticles(tweets, handleFallback) {
  return (tweets || []).map((t) => {
    const screen = t.user?.screen_name || handleFallback;
    const text = (t.full_text || t.text || '').trim();
    const expandedUrls = (t.entities?.urls || []).map((u) => ({
      t_co: u.url,
      expanded_url: u.expanded_url,
      display_url: u.display_url,
    }));
    const quotedTweet = (t.is_quote_status && t.quoted_status) ? {
      author: t.quoted_status.user?.screen_name || null,
      text: (t.quoted_status.full_text || t.quoted_status.text || '').trim(),
      url: t.quoted_status.user?.screen_name && t.quoted_status.id_str
        ? `https://x.com/${t.quoted_status.user.screen_name}/status/${t.quoted_status.id_str}`
        : null,
    } : null;
    const replyTo = t.in_reply_to_status_id_str ? {
      screen_name: t.in_reply_to_screen_name || null,
      status_id: t.in_reply_to_status_id_str,
    } : null;
    return {
      title: text.slice(0, 200),
      url: `https://x.com/${screen}/status/${t.id_str}`,
      published_at: t.tweet_created_at || null,
      description: text,
      expanded_urls: expandedUrls,
      quoted_tweet: quotedTweet,
      reply_to: replyTo,
    };
  });
}

function makeTwitterRoute({ name, handle, userId }) {
  if (!handle) throw new Error(`socialdata-twitter: missing handle for ${name}`);
  if (!userId) throw new Error(`socialdata-twitter: missing userId for ${name}`);
  return {
    name,
    sourceType: 'socialdata',
    sourceUrl: `https://x.com/${handle}`,
    async fetch() {
      const apiKey = process.env.SOCIALDATA_API_KEY;
      if (!apiKey) return { articles: [], error: 'SOCIALDATA_API_KEY not set' };
      try {
        const body = await fetchText(`${BASE}/twitter/user/${userId}/tweets`, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: 'application/json',
          },
        });
        const data = JSON.parse(body);
        const articles = mapTweetsToArticles(data.tweets, handle);
        return { articles, error: null };
      } catch (err) {
        return { articles: [], error: err.message };
      }
    },
  };
}

module.exports = { makeTwitterRoute, mapTweetsToArticles };
```

- [ ] **Step 4: Run tests, confirm they pass**

Run: `source /opt/homebrew/opt/nvm/nvm.sh && node --test scripts/lib/socialdata-twitter.test.js`

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/socialdata-twitter.js scripts/lib/socialdata-twitter.test.js
git commit -m "feat(twitter): preserve expanded_urls, quoted_tweet, reply_to from socialdata response"
```

---

## Task 4: `enrichSnapshot` linked_content for primary Twitter sources (TDD)

**Files:**
- Modify: `scripts/lib/enrich.js`
- Modify: `scripts/lib/enrich.test.js`

- [ ] **Step 1: Append failing tests for Twitter enrichment path**

Add to `scripts/lib/enrich.test.js`:

```js
const { PRIMARY_BLOG_URL_PATTERNS } = require('./enrich');

function makeTwitterSnapshot({ role, expandedUrls }) {
  return {
    sources: {
      'Claude (Twitter)': {
        status: 'ok',
        articles: [
          {
            title: 'announcement',
            url: 'https://x.com/claudeai/status/1',
            published_at: '2026-04-22',
            description: 'Read more: https://t.co/abc',
            expanded_urls: expandedUrls,
            quoted_tweet: null,
            reply_to: null,
          },
        ],
      },
    },
    _role: role,  // test-only convenience
  };
}

test('enrichSnapshot: primary Twitter + matching primary blog URL → linked_content fetched', async () => {
  const snapshot = makeTwitterSnapshot({
    role: 'primary',
    expandedUrls: [{ t_co: 'https://t.co/abc',
      expanded_url: 'https://www.anthropic.com/news/cowork-live-artifacts',
      display_url: 'anthropic.com/news/…' }],
  });
  const calls = [];
  const fetchImpl = async (u) => { calls.push(u); return 'BLOG BODY'; };
  await enrichSnapshot(snapshot,
    [{ name: 'Claude (Twitter)', role: 'primary' }],
    { fetchImpl });
  assert.equal(snapshot.sources['Claude (Twitter)'].articles[0].linked_content, 'BLOG BODY');
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes('/anthropic.com/news/cowork-live-artifacts'));
});

test('enrichSnapshot: aggregator Twitter is never enriched', async () => {
  const snapshot = makeTwitterSnapshot({
    role: 'aggregator',
    expandedUrls: [{ t_co: 'https://t.co/abc',
      expanded_url: 'https://www.anthropic.com/news/foo',
      display_url: 'anthropic.com/news/…' }],
  });
  let called = false;
  const fetchImpl = async () => { called = true; return 'x'; };
  await enrichSnapshot(snapshot,
    [{ name: 'Claude (Twitter)', role: 'aggregator' }],
    { fetchImpl });
  assert.equal(called, false);
  assert.equal('linked_content' in snapshot.sources['Claude (Twitter)'].articles[0], false);
});

test('enrichSnapshot: primary Twitter with no matching URL → linked_content null', async () => {
  const snapshot = makeTwitterSnapshot({
    role: 'primary',
    expandedUrls: [{ t_co: 'https://t.co/abc',
      expanded_url: 'https://random-blog.example.com/foo',
      display_url: 'random-blog.example.com/foo' }],
  });
  let called = false;
  const fetchImpl = async () => { called = true; return 'x'; };
  await enrichSnapshot(snapshot,
    [{ name: 'Claude (Twitter)', role: 'primary' }],
    { fetchImpl });
  assert.equal(called, false);
  assert.equal(snapshot.sources['Claude (Twitter)'].articles[0].linked_content, null);
});

test('enrichSnapshot: stops at first matching URL (one jina call per tweet)', async () => {
  const snapshot = makeTwitterSnapshot({
    role: 'primary',
    expandedUrls: [
      { t_co: 'a', expanded_url: 'https://www.anthropic.com/news/one', display_url: '' },
      { t_co: 'b', expanded_url: 'https://openai.com/index/two', display_url: '' },
    ],
  });
  const calls = [];
  const fetchImpl = async (u) => { calls.push(u); return 'x'; };
  await enrichSnapshot(snapshot,
    [{ name: 'Claude (Twitter)', role: 'primary' }],
    { fetchImpl });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes('anthropic.com/news/one'));
});

test('PRIMARY_BLOG_URL_PATTERNS matches expected hosts', () => {
  const matchers = PRIMARY_BLOG_URL_PATTERNS;
  const match = (u) => matchers.some((re) => re.test(u));
  assert.ok(match('https://www.anthropic.com/news/foo'));
  assert.ok(match('https://www.anthropic.com/research/bar'));
  assert.ok(match('https://openai.com/index/x'));
  assert.ok(match('https://openai.com/research/y'));
  assert.ok(match('https://openai.com/blog/z'));
  assert.ok(match('https://blog.google/technology/ai/something/'));
  assert.ok(match('https://deepmind.google/discover/blog/foo/'));
  assert.ok(match('https://www.deeplearning.ai/the-batch/issue-350/'));
  assert.equal(match('https://random.example.com/foo'), false);
  assert.equal(match('https://twitter.com/AnthropicAI/status/123'), false);
});
```

- [ ] **Step 2: Run tests, confirm they fail**

Run: `source /opt/homebrew/opt/nvm/nvm.sh && node --test scripts/lib/enrich.test.js`

Expected: 5 new tests fail (`PRIMARY_BLOG_URL_PATTERNS` not exported; Twitter path not implemented).

- [ ] **Step 3: Add primary-URL patterns and extend `enrichSnapshot`**

In `scripts/lib/enrich.js`, add `PRIMARY_BLOG_URL_PATTERNS` below the existing constants:

```js
const PRIMARY_BLOG_URL_PATTERNS = [
  /^https?:\/\/(www\.)?anthropic\.com\/(news|research)\//,
  /^https?:\/\/(www\.)?openai\.com\/(index|research|blog)\//,
  /^https?:\/\/blog\.google\//,
  /^https?:\/\/(www\.)?deepmind\.google\//,
  /^https?:\/\/(www\.)?deeplearning\.ai\/the-batch\//,
];

function isPrimaryBlogUrl(url) {
  return typeof url === 'string' && PRIMARY_BLOG_URL_PATTERNS.some((re) => re.test(url));
}
```

Replace `enrichSnapshot` body with the combined blog + Twitter version:

```js
async function enrichSnapshot(snapshot, sourceConfigs, { fetchImpl } = {}) {
  const roleByName = Object.fromEntries((sourceConfigs || []).map((s) => [s.name, s.role]));
  for (const [sourceName, entry] of Object.entries(snapshot.sources)) {
    if (entry.status !== 'ok' && entry.status !== 'degraded_stale') continue;

    const isBlog = BLOG_ENRICH_SOURCES.has(sourceName);
    const isTwitterPrimary = /\(Twitter\)$/.test(sourceName) && roleByName[sourceName] === 'primary';
    if (!isBlog && !isTwitterPrimary) continue;

    for (const article of entry.articles) {
      if (isBlog) {
        article.full_text = await jinaFetch(article.url, { fetchImpl });
      }
      if (isTwitterPrimary) {
        article.linked_content = null;
        for (const { expanded_url } of (article.expanded_urls || [])) {
          if (isPrimaryBlogUrl(expanded_url)) {
            article.linked_content = await jinaFetch(expanded_url, { fetchImpl });
            break;
          }
        }
      }
    }
  }
}
```

Update the `module.exports`:

```js
module.exports = {
  jinaFetch, enrichSnapshot,
  BLOG_ENRICH_SOURCES, PRIMARY_BLOG_URL_PATTERNS,
  JINA_BASE, MAX_CHARS,
};
```

- [ ] **Step 4: Run tests, confirm they pass**

Run: `source /opt/homebrew/opt/nvm/nvm.sh && node --test scripts/lib/enrich.test.js`

Expected: 12 tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/enrich.js scripts/lib/enrich.test.js
git commit -m "feat(enrich): follow primary-blog expanded_urls for primary Twitter sources"
```

---

## Task 5: Wire `enrichSnapshot` into `scripts/fetch-sources.js`

**Files:**
- Modify: `scripts/fetch-sources.js`

- [ ] **Step 1: Import `enrichSnapshot`**

At the top of `scripts/fetch-sources.js`, below the existing `require('./routes')` line, add:

```js
const { enrichSnapshot } = require('./lib/enrich');
```

- [ ] **Step 2: Call `enrichSnapshot` after the per-source loop, before writing JSON**

In `scripts/fetch-sources.js`, locate the block that currently reads:

```js
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const outPath = path.join(CACHE_DIR, `${shanghaiDateStr(fetchedAt)}.json`);
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n');
```

Replace with:

```js
  console.error('enriching articles via Jina Reader...');
  await enrichSnapshot(output, sourceConfigs);
  console.error('enrichment done');

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const outPath = path.join(CACHE_DIR, `${shanghaiDateStr(fetchedAt)}.json`);
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n');
```

- [ ] **Step 3: Verify by dry-running locally (only Twitter sources, fast)**

We don't want to fire real jina fetches across all 5 blog sources during development. Instead, sanity-check that the new call doesn't crash on a config-only snapshot. Run:

```bash
source /opt/homebrew/opt/nvm/nvm.sh && SOCIALDATA_API_KEY= node scripts/fetch-sources.js 2>&1 | tail -30
```

Expected output includes:
- Per-source fetch lines
- A single `enriching articles via Jina Reader...` line
- A single `enrichment done` line
- `wrote data/fetch-cache/YYYY-MM-DD.json`

If jina is reachable, blog sources with new articles in the window will get full_text populated. If jina is unreachable from your dev machine, they'll be null (expected; non-fatal).

- [ ] **Step 4: Inspect the produced fetch-cache**

```bash
cat data/fetch-cache/$(TZ=Asia/Shanghai date +%Y-%m-%d).json | head -80
```

Expected: at least one blog-source article now has a `"full_text": "..."` or `"full_text": null` field. Twitter articles (if any) show `expanded_urls`, `quoted_tweet`, `reply_to` fields.

- [ ] **Step 5: Revert the transient cache file so it doesn't pollute git**

```bash
git checkout -- data/fetch-cache/
```

(It's fine to leave the real daily-fetch GH Actions run to produce the first "live" enriched snapshot tomorrow.)

- [ ] **Step 6: Commit**

```bash
git add scripts/fetch-sources.js
git commit -m "feat(fetch): wire enrichSnapshot into the daily-fetch pipeline"
```

---

## Task 6: Berkeley RDI route — set `full_text` directly (no double-fetch)

**Files:**
- Modify: `scripts/routes/berkeley-rdi.js`

- [ ] **Step 1: Inspect current route**

Read `scripts/routes/berkeley-rdi.js`. Each post `p` has fields including `truncated_body_text`, which is already used for `description`. Substack's archive JSON also returns `body_html` on many endpoints, but here we only have what `/api/v1/archive` provides.

For Berkeley RDI, the richest body we already have without another fetch is `truncated_body_text`. This is strictly more content than `description` (which is `subtitle || description || truncated_body_text`). Wire it into `full_text` as a zero-cost upgrade.

- [ ] **Step 2: Modify the route to set `full_text`**

In `scripts/routes/berkeley-rdi.js`, replace the `articles = posts.map(...)` block with:

```js
      const articles = posts.map((p) => ({
        title: (p.title || '').trim(),
        url: p.canonical_url || `${CANONICAL_BASE}/p/${p.slug}`,
        published_at: p.post_date || null,
        description: (p.subtitle || p.description || p.truncated_body_text || '').trim().slice(0, 500) || null,
        full_text: (p.truncated_body_text || p.description || '').trim() || null,
      }));
```

- [ ] **Step 3: Verify no regressions**

Berkeley RDI doesn't currently have route-level tests; it's exercised through the daily-fetch pipeline. Smoke-test the change:

```bash
source /opt/homebrew/opt/nvm/nvm.sh && node -e "
(async () => {
  const r = require('./scripts/routes/berkeley-rdi');
  const out = await r.fetch();
  console.log('articles:', out.articles.length, 'error:', out.error);
  if (out.articles[0]) {
    console.log('has full_text:', typeof out.articles[0].full_text);
    console.log('full_text length:', (out.articles[0].full_text || '').length);
  }
})();
"
```

Expected: `articles: N, error: null` with `full_text` present and non-empty on at least one article. If jina or Substack is unreachable, you'll see an error message — that's the existing behavior, unchanged.

- [ ] **Step 4: Commit**

```bash
git add scripts/routes/berkeley-rdi.js
git commit -m "feat(berkeley-rdi): set full_text from truncated_body_text (no double-fetch)"
```

---

## Task 7: Baoyu route + rss-route — preserve `content:encoded` as `full_text`

**Files:**
- Modify: `scripts/lib/rss-route.js`
- Modify: `scripts/routes/baoyu.js`

- [ ] **Step 1: Inspect what rss-parser returns for baoyu feed**

Run:

```bash
source /opt/homebrew/opt/nvm/nvm.sh && node -e "
(async () => {
  const { fetchText } = require('./scripts/lib/http');
  const { parseRss } = require('./scripts/lib/xml');
  const xml = await fetchText('https://baoyu.io/feed.xml');
  const feed = await parseRss(xml);
  const item = feed.items[0];
  console.log('keys:', Object.keys(item));
  console.log('content length:', (item.content || '').length);
  console.log('content:encoded length:', (item['content:encoded'] || '').length);
  console.log('contentSnippet length:', (item.contentSnippet || '').length);
})();
"
```

Expected output: a list of keys including `content` and possibly `content:encoded`. rss-parser by default aliases `content:encoded` to `content` if present. The `content` field will be multi-KB HTML for baoyu.

- [ ] **Step 2: Extend `makeRssRoute` to optionally set `full_text` from `content`**

In `scripts/lib/rss-route.js`, replace the whole file with:

```js
const { fetchText } = require('./http');
const { parseRss } = require('./xml');

function makeRssRoute({ name, sourceUrl, preserveContent = false }) {
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
          const article = {
            title: (item.title || '').trim(),
            url: item.link || '',
            published_at: isoDate,
            description: (item.contentSnippet || item.content || item.description || '').trim(),
          };
          if (preserveContent) {
            const body = (item['content:encoded'] || item.content || '').trim();
            article.full_text = body || null;
          }
          return article;
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

- [ ] **Step 3: Pass `preserveContent: true` from the baoyu route**

In `scripts/routes/baoyu.js`, replace with:

```js
const { makeRssRoute } = require('../lib/rss-route');

module.exports = makeRssRoute({
  name: '宝玉的分享',
  sourceUrl: 'https://baoyu.io/feed.xml',
  preserveContent: true,
});
```

- [ ] **Step 4: Smoke-test**

```bash
source /opt/homebrew/opt/nvm/nvm.sh && node -e "
(async () => {
  const r = require('./scripts/routes/baoyu');
  const out = await r.fetch();
  console.log('articles:', out.articles.length, 'error:', out.error);
  console.log('first article has full_text:', typeof out.articles[0]?.full_text);
  console.log('full_text length:', (out.articles[0]?.full_text || '').length);
})();
"
```

Expected: `articles: N, error: null` with `full_text` of non-trivial length (typically >1KB for baoyu posts).

- [ ] **Step 5: Verify other rss routes (OpenAI Blog, Google AI Blog) are unaffected**

They call `makeRssRoute` without `preserveContent`. Check:

```bash
source /opt/homebrew/opt/nvm/nvm.sh && node -e "
(async () => {
  const r = require('./scripts/routes/openai-blog');
  const out = await r.fetch();
  const a = out.articles[0];
  console.log('has full_text field:', 'full_text' in (a || {}));
})();
"
```

Expected: `has full_text field: false` — confirms route is untouched (enrichSnapshot will later populate `full_text` for OpenAI Blog via jina).

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/rss-route.js scripts/routes/baoyu.js
git commit -m "feat(baoyu): preserve content:encoded as full_text via rss-route option"
```

---

## Task 8: Document new fetch-cache fields in `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Locate the schema section to extend**

In `CLAUDE.md`, find the bullet that describes fetch-cache articles. It currently reads (section "Rules for Trigger Agents" → "Fetching"):

```
- `articles`: list of `{ title, url, published_at, description }` (already pre-filtered to `window_hours` of recency...)
```

- [ ] **Step 2: Extend the schema bullet**

Replace that line with:

```
- `articles`: list of `{ title, url, published_at, description, full_text?, linked_content?, expanded_urls?, quoted_tweet?, reply_to? }` — already pre-filtered to `window_hours` of recency (overlap with yesterday is handled by URL-hash dedup in history.json).
  - `full_text` (blog sources): full article body (markdown from Jina Reader or upstream HTML). Null when enrichment failed. Absent for Twitter sources.
  - `linked_content` (primary Twitter sources only): Jina-fetched body of the primary-blog URL the tweet links to, when one exists. Null when no matching URL or fetch failed.
  - `expanded_urls` (Twitter): `[{ t_co, expanded_url, display_url }]` from `entities.urls`.
  - `quoted_tweet` (Twitter): `{ author, text, url }` when the tweet is a quote-tweet, else null.
  - `reply_to` (Twitter): `{ screen_name, status_id }` when the tweet is a reply, else null.
  - **Summary-source priority when analyzing:** `linked_content` > `full_text` > `quoted_tweet.text + description` > `description`.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document enriched fetch-cache fields and summary-source priority"
```

---

## Task 9: End-to-end verification (manual)

**No file changes** — this step confirms the PR is ready to open.

- [ ] **Step 1: Run the full test suite**

```bash
source /opt/homebrew/opt/nvm/nvm.sh && node --test scripts/
```

Expected: all test files pass (enrich, socialdata-twitter, email-reports). Count roughly 20+ tests green.

- [ ] **Step 2: Dry-run `fetch-sources.js`**

Skip Twitter (no API key) but let blog sources actually fetch + enrich:

```bash
source /opt/homebrew/opt/nvm/nvm.sh && SOCIALDATA_API_KEY= node scripts/fetch-sources.js 2>&1 | grep -E '(ok|ERROR|enrich|wrote)'
```

Expected: each blog source has at least one article (or `filtered_count: 0` on quiet days), enrichment runs once, cache file written.

- [ ] **Step 3: Inspect the produced cache for schema correctness**

```bash
node -e "
const s = require('./data/fetch-cache/' + new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()) + '.json');
const summary = {};
for (const [name, e] of Object.entries(s.sources)) {
  summary[name] = {
    status: e.status,
    n: e.articles.length,
    has_full_text: e.articles.filter(a => 'full_text' in a).length,
    has_expanded_urls: e.articles.filter(a => 'expanded_urls' in a).length,
  };
}
console.log(JSON.stringify(summary, null, 2));
"
```

Expected: blog sources (OpenAI Blog, etc.) show `has_full_text: N`; Twitter sources (if any articles present) show `has_expanded_urls: N`. 宝玉的分享 shows `has_full_text: N` regardless of enrichment.

- [ ] **Step 4: Clean up and check git status**

```bash
git checkout -- data/fetch-cache/
git status
```

Expected: working tree clean (all commits made).

- [ ] **Step 5: Open PR**

```bash
git push -u origin HEAD
gh pr create --title "feat(enrich): Jina enrichment + Twitter field preservation" --body "$(cat <<'EOF'
## Summary
- New scripts/lib/enrich.js: jinaFetch + enrichSnapshot
- Blog sources (OpenAI Blog, Google AI Blog, Anthropic Blog, Anthropic Research, The Batch) get full_text via Jina Reader
- Twitter routes preserve expanded_urls, quoted_tweet, reply_to from socialdata response
- Primary Twitter sources (Claude, Anthropic, OpenAI, OpenAI Devs, GoogleDeepMind, Meta AI, Mistral, xAI, DeepSeek, Qwen) follow expanded_urls matching known primary-blog patterns → linked_content
- Berkeley RDI sets full_text from truncated_body_text (no double-fetch through jina)
- 宝玉的分享 preserves content:encoded as full_text via new rss-route option
- Spec: docs/superpowers/specs/2026-04-22-enrichment-and-routine-slim-design.md (Phase 1)

## Test plan
- [x] scripts/lib/enrich.test.js passes
- [x] scripts/lib/socialdata-twitter.test.js passes
- [x] Local fetch-sources.js run produces enriched fetch-cache with expected fields
- [ ] First daily-fetch GH Actions run after merge shows enriched fetch-cache on origin

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review checklist (for writer)

**Spec § coverage:**
- § 5.1 scope table → Tasks 2, 4, 6, 7 ✓
- § 5.2 enrich.js sketch → Tasks 1, 2, 4 ✓
- § 5.2 socialdata-twitter.js changes → Task 3 ✓
- § 5.3 schema changes → Task 8 (docs) ✓
- § 5.4 failure modes (null on error) → asserted in Tasks 1, 2, 4 ✓
- § 10 open question on 宝玉 → Task 7 ✓

**Placeholder scan:** none (every code step includes the actual code).

**Identifier consistency:** `enrichSnapshot`, `jinaFetch`, `BLOG_ENRICH_SOURCES`, `PRIMARY_BLOG_URL_PATTERNS`, `mapTweetsToArticles`, `preserveContent` are used identically across tasks.
