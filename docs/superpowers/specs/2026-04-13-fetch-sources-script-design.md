# Fetch-Sources Script — Design

**Date**: 2026-04-13
**Status**: Draft, pending user review
**Author**: Claude + Kevin (pair)

## 1. Context & problem

CatchUp's daily news pipeline runs as a Claude Code Cloud Scheduled Trigger. The trigger prompt instructs Claude to `WebFetch` 5 configured sources (OpenAI, Google AI, Anthropic, Berkeley RDI, The Batch) and analyze new articles.

**Observed failure**: Since 2026-04-10, all 5 sources return HTTP 403 from the trigger. Articles have been filled in via `WebSearch` fallback, which produces unreliable and sometimes stale/hallucinated content.

**Verified root cause** (empirically tested 2026-04-13):

- Local Claude Code `WebFetch` returns **200** on all 5 sources; its User-Agent is `Claude-User (claude-code/2.1.104; +https://support.anthropic.com/)`, classified by Cloudflare as `verified_bot` (user-directed) and allowed
- Cloud Scheduled Trigger `WebFetch` uses a different, autonomous User-Agent (`ClaudeBot`-family), classified by Cloudflare as `ai_bot` and blocked by the default "Block AI Scrapers and Crawlers" rule now enabled on all 5 sources' CDNs
- We cannot change the trigger-side User-Agent from inside a prompt — this is an Anthropic-backend concern
- Public proxies (`r.jina.ai`, `rsshub.app`) are also now failing (timeouts / 403s) as LLM-tool abuse has pushed them behind similar protection

**Conclusion**: Source fetching cannot reliably happen inside the cloud trigger. It must happen in an environment whose network identity isn't on these blocklists.

## 2. Goals

- **Decouple source fetching from Claude analysis.** Fetcher produces a JSON snapshot on disk; the Claude trigger reads the snapshot and does what it's good at (summary, categorization, report narrative)
- **Locally debuggable.** Any developer can run `node scripts/fetch-sources.js` and get the same output that the scheduled run would produce
- **Zero third-party service dependency.** No SaaS, no public proxy, no RSSHub instance to maintain
- **Per-source isolation.** One source breaking (HTML restructured, feed down) does not break any other
- **Honest time filtering.** Only articles actually published in the past 24h are considered; no back-filling with stale content

## 3. Non-goals (YAGNI)

- **Not a general-purpose scraper.** Written for these ~5 sources; will not be extended to 100+
- **No JS rendering.** All current sources expose RSS or static HTML listings; no Puppeteer
- **No newsletter topic-splitting in the script.** That requires semantic understanding; Claude does it in Step 3.5
- **No full article-body fetching.** RSS `<description>` / first-paragraph of listing page is enough for the 2-3 sentence summaries CatchUp reports produce
- **No parallel fetches.** 5 sources × ~5s serial = ~25s; not worth the complexity
- **No metrics / observability framework.** `console.log` is enough for a script that runs once a day

## 4. Architecture

```
scripts/
  fetch-sources.js          # orchestrator: reads config, runs routes, writes JSON
  routes/
    index.js                # barrel export; maps source name → route module
    openai-blog.js          # per-source extractor
    google-ai-blog.js
    anthropic-blog.js
    berkeley-rdi.js
    the-batch.js
  lib/
    http.js                 # fetch with UA, retry, timeout
    xml.js                  # thin wrapper around rss-parser
    html.js                 # thin wrapper around cheerio, with common selectors

data/
  fetch-cache/
    YYYY-MM-DD.json         # one snapshot per day
```

**Route module contract** (each `routes/*.js`):

```js
module.exports = {
  name: 'OpenAI Blog',          // MUST match config.yaml source name
  sourceType: 'rss',            // 'rss' | 'web_scraper' — documentary only
  sourceUrl: 'https://...',     // upstream URL the route will fetch
  fetch: async ({ http }) => ({
    articles: [
      { title, url, published_at, description }
    ],
    error: null                 // or a string describing the failure
  })
};
```

Each route file can be run standalone for debugging:
```bash
node scripts/routes/openai-blog.js
```
(prints its `fetch()` output as JSON)

## 5. Data contract (output JSON)

File: `data/fetch-cache/YYYY-MM-DD.json`

```json
{
  "fetched_at": "2026-04-13T07:30:00+08:00",
  "window_start": "2026-04-12T07:30:00+08:00",
  "window_hours": 24,
  "sources": {
    "OpenAI Blog": {
      "status": "ok",
      "error": null,
      "fetched_count": 12,
      "filtered_count": 2,
      "articles": [
        {
          "title": "string",
          "url": "https://openai.com/...",
          "published_at": "2026-04-13T06:00:00Z",
          "description": "RSS description or first-paragraph extract"
        }
      ]
    },
    "Anthropic Blog": {
      "status": "error",
      "error": "HTTP 403 after 2 attempts",
      "fetched_count": 0,
      "filtered_count": 0,
      "articles": []
    }
  }
}
```

- `fetched_count`: total items returned by source before 24h filter (for diagnosing "source returns stale items")
- `filtered_count`: how many of those passed the 24h filter (i.e., ended up in `articles`)
- `published_at`: ISO-8601. If source only provides a date (no time), use `YYYY-MM-DDT00:00:00Z`

## 6. Time-window filter

After route returns `articles[]`:
1. Parse each `published_at` to a Date
2. Keep only those in `[window_start, fetched_at]` where `window_start = fetched_at - 24h`
3. Articles with missing / unparseable `published_at` are **excluded** (we'd rather miss an article than include stale content)

Applied at orchestrator level, not inside routes — routes return raw extraction; filter is orthogonal policy.

## 7. Error handling

**Per-source try/catch** in orchestrator. One route throwing does not stop others.

**Retry policy** (implemented in `lib/http.js`):
- Max attempts: 2
- Retry delay: 3s (fixed, no exponential backoff — keeps it predictable)
- Retryable: network errors (ECONNRESET, ETIMEDOUT, ENOTFOUND), HTTP 5xx
- **NOT retryable**: HTTP 4xx (semantic rejection, retrying is rude and pointless), parse errors

**Timeout**: 30s per attempt.

**Script exit code**:
- `0` if ≥1 source returned articles successfully
- `1` if **all** sources failed (signals total failure to CI / cron)

**Error string format**:
- `"HTTP 403 after 2 attempts"` — for HTTP errors
- `"timeout after 30s (2 attempts)"` — for timeouts
- `"parse error: <message>"` — for parsing failures
- `"network error: <code>"` — for network-level failures

## 8. User-Agent

```
Mozilla/5.0 (compatible; CatchUp/1.0; +https://github.com/Zerokei/LLM-CatchUp)
```

- Identifies as a bot (not spoofing a browser)
- Includes contact URL (courtesy — lets site owners reach us if scraping causes issues)
- Does not include `ClaudeBot` / `GPTBot` / similar strings that the Cloudflare `ai_bot` category targets. If a specific source later proves to block this UA, we override per-route in `lib/http.js` (e.g., a plain `Mozilla/5.0` browser UA for that one site)

## 9. Dependencies

- **Runtime**: Node.js ≥ 20 (uses built-in `fetch`, `AbortSignal.timeout`, top-level await)
- **`js-yaml`** (^4): parse `config.yaml`
- **`cheerio`** (^1): HTML parsing for `web_scraper` sources
- **`rss-parser`** (^3): RSS/Atom parsing (more robust than hand-rolled)

Total install size ≈ 2 MB. No native compilation. `package.json` + lockfile committed to repo.

## 10. Claude trigger integration

Changes to `docs/prompts/daily-trigger.md`:

**Step 3 rewritten** — no longer fetches external URLs:

> Read `data/fetch-cache/{YYYY-MM-DD}.json` for today's date (Asia/Shanghai). For each source in the JSON's `sources` object:
> - If `status === "ok"`: iterate `articles[]`, SHA-256 hash each URL, skip if already in `history.json`, collect new ones
> - If `status === "error"`: record the error for Step 8
>
> If the cache file does not exist for today: abort the run. Commit nothing. Write a one-line note to stderr / trigger output: `"fetch-cache missing for YYYY-MM-DD — aborting daily run"`. Do NOT fall back to live WebFetch. Do NOT use WebSearch to fabricate content. An aborted daily run is better than a hallucinated one — the missing cache is already a signal that something upstream (the fetch script / its scheduler) needs attention.

**Step 3.5 (semantic dedup)** — unchanged; still Claude's job

**Step 4 (analysis)** — unchanged

**Step 5–7** — unchanged

**Step 8 (health)** — simplified; maps directly from JSON:
- `status === "ok"` → healthy, reset counter
- `status === "error"` → increment consecutive_failures, copy `error` field to `last_error`
- (Three-state `primary_success`/`fallback_success`/`hard_failure` logic from prior revision is **removed** — no longer needed since we're not doing fallback at all)

**Step 9–10** — unchanged (alerting, commit/push)

## 11. Execution

**Local (manual)**:
```bash
cd /Users/kevin/Projects/LLM-CatchUp
node scripts/fetch-sources.js
# → writes data/fetch-cache/2026-04-13.json
```

**Scheduled (later, out of scope for this spec)**:
- `.github/workflows/daily-fetch.yml` — cron at `30 23 * * *` UTC (= 07:30 Asia/Shanghai)
- Runs `node scripts/fetch-sources.js`, commits `data/fetch-cache/`, pushes
- Claude trigger runs 30 min later at 08:00 Asia/Shanghai and finds the fresh cache
- **First cut operates manually**: Kevin runs the script each morning, observes output stability for ~1 week, then wires up the cron

## 12. Testing & verification strategy

**Per-route manual test** (during development):
```bash
node scripts/routes/openai-blog.js
node scripts/routes/anthropic-blog.js
# ...
```
Each should print a JSON blob with `articles[]`. Inspect to confirm shape + sanity of dates + non-empty descriptions.

**Full-run smoke test**:
```bash
node scripts/fetch-sources.js
cat data/fetch-cache/$(date +%Y-%m-%d).json | jq .
```

**Integration test with Claude trigger**:
1. Run script locally → generates today's JSON
2. In local Claude Code session, paste the updated `daily-trigger.md` prompt
3. Claude reads the cache, produces a report, updates history/health
4. Verify: report's articles all exist in cache; none fabricated

**Regression protection**: none automated for now. Source HTML/RSS structure changes will surface as `error` or empty-result outputs. Acceptable given the low cadence (daily).

## 13. Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Source changes its HTML structure → route extractor returns empty / wrong data | Per-route test is manual but quick (~30s); empty results are visible in the committed JSON and daily report |
| Source's RSS feed goes stale (like OpenAI's `/blog/rss.xml` already has) | 24h window filter naturally produces zero articles; we notice via the daily report being empty for that source, then update the route |
| Network flakiness | Bounded retry (2 attempts, 3s delay) on 5xx/network errors |
| Script crashes mid-run | Per-source try/catch; catastrophic crashes exit non-zero and the trigger fails loudly rather than proceeds on stale data |
| Aggregator newsletter (weekly cadence) empty most days | Expected; The Batch / Berkeley RDI will show up once per week. Trigger must handle empty sources gracefully (it already does) |
| config.yaml source added but no route file exists | Orchestrator logs a clear error for that source, continues with others |

## 14. Out of scope (explicitly, may revisit later)

- GitHub Actions scheduling (separate follow-up once script is stable)
- Per-source rate limiting / per-source UA override
- Full article body fetching (only if `description` quality turns out insufficient for summaries)
- Parallel source fetching
- Automated tests (manual verification sufficient for 5 sources × daily cadence)
- Dashboard / web UI for fetch results

## 15. Open questions

None — all design decisions are explicit above.
