# Article Enrichment + Daily Routine Slim-Down — Design

**Date**: 2026-04-22
**Status**: Draft, pending user review
**Author**: Claude + Kevin (pair)

## 1. Context & problem

CatchUp has two concurrent reliability issues:

**Issue A — Low-quality input for blog sources.** The fetcher captures only `{title, url, published_at, description}`. For Twitter the tweet IS the content, so `description` is fine. For RSS/web-scraped blog sources (OpenAI Blog, Google AI Blog, Anthropic Blog, Anthropic Research, The Batch), `description` is the RSS summary — usually one to two sentences, often near-identical to the title. Claude's daily "summary" is therefore a paraphrase of an already-terse summary, not of the actual article body. This shows up in reports as shallow blog summaries compared to rich tweet summaries.

**Issue B — Daily routine keeps hanging.** The Claude Cloud Scheduled Trigger runs a ~220-line prompt spanning 11 sequential steps (load config/state/cache → semantic dedup → per-article analysis → render markdown → update history → retention cleanup → update health → handle gh-issue alerts → commit → push). The routine's failure rate has been high enough that 2026-04-20 and 2026-04-22 produced no daily report, and 2026-04-21 had to be generated manually. The fetcher side (GH Actions) and email side are rock solid; the single Claude run is the only unreliable link.

**Empirical evidence (past 7 days):**

| Date | daily-fetch | Claude routine report | email |
|---|---|---|---|
| 04-16 | ✅ | ✅ | ✅ |
| 04-17 | ✅ | ✅ | ✅ |
| 04-18 | cancelled | ✅ (after re-fetch) | ✅ |
| 04-19 | ✅ | ✅ | ✅ |
| 04-20 | ✅ | ✅ (but 0 content) | ❌ Resend testing mode |
| 04-21 | ✅ | ❌ no report commit | manual |
| 04-22 | ✅ | ❌ no report commit (pending manual) | — |

Fetch: 7/7. Routine report: 5/7. Email: 4/7 (fixed 04-21).

**Constraint**: No Anthropic API key available. The routine must remain a Cloud Scheduled Trigger; we cannot retire it in favor of SDK-in-CI. Robustness has to come from shrinking the routine's scope and adding deterministic recovery paths around it.

## 2. Goals

- **Improve content quality** — blog summaries based on actual article body, not RSS blurb.
- **Improve routine reliability** — reduce routine's prompt surface area so hangs are rarer AND less destructive when they do happen.
- **Preserve analysis quality** — Claude continues to do all judgment work (summary, category, importance, tags, semantic dedup, trend paragraph). Only deterministic mechanics move out of the routine.
- **Guaranteed daily delivery** — even if the routine fails completely, an email lands in the inbox with at least titles + links (a "fallback report").
- **Zero new external dependencies for analysis** — no new API keys, no new paid services. Enrichment uses Jina Reader (already a dependency via Berkeley RDI).

## 3. Non-goals (YAGNI)

- Not retiring the Cloud Scheduled Trigger. (Separate track; requires API key.)
- Not enriching Twitter sources. (Tweet text is already full content.)
- Not adding JS-rendering or headless browsers. (Jina handles JS for us.)
- Not solving for >500 enriched articles/month. (Current volume is ~150/month.)
- Not restructuring history.json's schema. (Append-only growth is fine at current rate.)
- Not changing how weekly/monthly reports work. (They aggregate from history.json and are less frequent; deal with them if they start breaking.)
- Not building a web UI / dashboard for the pipeline state.

## 4. Architecture

### 4.1 Current (broken) flow

```
┌─────────────────────────┐
│  daily-fetch.yml (GH)   │  07:37 CST
│  fetch-sources.js       │──→ data/fetch-cache/{YYYY-MM-DD}.json
└─────────────────────────┘

┌─────────────────────────────────────────┐
│  Claude Cloud Scheduled Trigger          │  ~08:00 CST
│  docs/prompts/daily-trigger.md (220 lines│
│  11 sequential steps, monolithic)       │──→ reports/daily/{YYYY-MM-DD}.md
│                                          │    history.json updated
│                                          │    health.json updated
│                                          │    gh issues opened/closed
│                                          │    git push
└─────────────────────────────────────────┘

┌─────────────────────────┐
│  email-reports.yml (GH) │  on push
│  email-reports.js       │──→ Resend → inbox
└─────────────────────────┘
```

The middle box is the single point of failure.

### 4.2 Target flow

```
┌─────────────────────────────────────┐
│  daily-fetch.yml (GH)  07:37 CST    │
│  scripts/fetch-sources.js           │
│    - per-source route (same as now) │
│    - post-fetch: enrich blog items  │──→ data/fetch-cache/{YYYY-MM-DD}.json
│      via r.jina.ai (new)             │   (now includes full_text per article)
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│  Claude Cloud Scheduled Trigger      │  ~08:00 CST
│  (slim) ~60 lines, 1 conceptual step │
│    - read fetch-cache                │──→ data/analysis-cache/{YYYY-MM-DD}.json
│    - analyze new articles            │  (commit of this file only)
│    - output structured JSON          │
│    - append-write per article        │
│      (checkpoint)                    │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│  build-report.yml (GH, new)          │  on push to data/analysis-cache/**
│  scripts/build-report.js             │
│    - thread merge (URL/time heuristic│
│    - cross-history dedup (URL hash)  │
│    - render markdown                 │──→ reports/daily/{YYYY-MM-DD}.md
│    - update history.json             │    history.json, health.json
│    - update health.json + alerts     │    gh issues
│    - retention cleanup               │    git push
│    - commit+push                     │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│  fallback-report.yml (GH, new)       │  cron 12:00 CST (≈4h after fetch)
│  scripts/fallback-report.js          │
│    - check reports/daily/{today}.md  │
│    - if missing: read fetch-cache    │──→ reports/daily/{YYYY-MM-DD}.md
│      and render title+link only      │   (minimal)
│    - commit+push                     │
└─────────────────────────────────────┘

┌─────────────────────────┐
│  email-reports.yml (GH) │  on push to reports/**
│  (unchanged)            │──→ Resend → inbox
└─────────────────────────┘
```

Blast radius per failure:
- **Fetcher fails** → no articles today (unchanged).
- **Enrichment fails per article** → that article falls back to `description` (unchanged quality).
- **Routine fails completely** → fallback-report.yml fires at 12:00 CST, inbox still gets a title/link digest.
- **Routine fails mid-run** → analysis-cache has partial data; next invocation (manual re-dispatch OR the fallback at 12:00) completes it; build-report.js can run with whatever's there.
- **build-report.js fails** → fallback path still fires from fetch-cache.

## 5. Phase 1 — Content enrichment (Jina Reader)

### 5.1 Scope

Enrich the 5 blog-type sources:

| Source | Current `description` | Enrich? |
|---|---|---|
| OpenAI Blog | RSS summary (1-2 sent.) | ✅ |
| Google AI Blog | RSS summary (1-2 sent.) | ✅ |
| Anthropic Blog | listing snippet | ✅ |
| Anthropic Research | listing snippet | ✅ |
| The Batch | listing snippet | ✅ |
| Berkeley RDI | **already full text** via existing jina route | not in `ENRICH_SOURCES`; its route module `scripts/routes/berkeley-rdi.js` is updated to set `full_text` directly from the jina-fetched markdown (avoid double-fetching through jina). |
| 宝玉的分享 | RSS `content:encoded` full body | not in `ENRICH_SOURCES`; its route `scripts/routes/baoyu.js` is verified/updated to set `full_text` from `content:encoded` if present. See §10 open question. |
| 14 Twitter sources | tweet text (== full content) | ❌ |

### 5.2 Where enrichment lives

**Decision: post-processing phase inside `scripts/fetch-sources.js`**, not inside individual route modules, not a separate script.

Rationale:
- **Single GH Actions job, single commit** — fetch-cache is always fully enriched when it lands on disk.
- **Route modules stay focused** — they answer "what articles exist in the 30h window", they don't need to know about enrichment policy.
- **Enrichment logic cross-cuts** — per-host selectors/quirks live in one place.

New file: `scripts/lib/enrich.js`

```js
// scripts/lib/enrich.js
const ENRICH_SOURCES = new Set([
  'OpenAI Blog',
  'Google AI Blog',
  'Anthropic Blog',
  'Anthropic Research',
  'The Batch',
]);

const JINA_BASE = 'https://r.jina.ai/';
const TIMEOUT_MS = 20_000;
const MAX_CHARS = 20_000;  // truncate extremely long pages; protects analysis-cache size

async function enrichArticle(article) {
  try {
    const res = await fetchWithTimeout(JINA_BASE + article.url, {
      headers: { 'Accept': 'text/plain' },
    }, TIMEOUT_MS);
    if (!res.ok) return null;
    const text = await res.text();
    return text.slice(0, MAX_CHARS);
  } catch {
    return null;
  }
}

async function enrichSnapshot(snapshot) {
  for (const [sourceName, entry] of Object.entries(snapshot.sources)) {
    if (!ENRICH_SOURCES.has(sourceName)) continue;
    if (entry.status !== 'ok' && entry.status !== 'degraded_stale') continue;
    for (const article of entry.articles) {
      article.full_text = await enrichArticle(article);
    }
  }
}

module.exports = { enrichSnapshot, ENRICH_SOURCES };
```

Called from `fetch-sources.js` right after the main per-source fetch loop, before writing the JSON file.

### 5.3 fetch-cache schema change (non-breaking)

```diff
 {
   "fetched_at": "...",
   "window_start": "...",
   "window_hours": 30,
   "sources": {
     "OpenAI Blog": {
       "status": "ok",
       "articles": [
         {
           "title": "...",
           "url": "...",
           "published_at": "...",
-          "description": "..."
+          "description": "...",
+          "full_text": "..."          // markdown body, null if enrichment failed
         }
       ]
     }
   }
 }
```

Old consumers that ignore unknown fields (every current reader) keep working.

### 5.4 Failure modes

| Failure | Effect | Detection |
|---|---|---|
| Jina down | All 5 sources get `full_text: null` | Report quality degrades to today's level; no crash. Can count `null`s in fetch-cache as a health metric later. |
| Jina returns partial/garbage | One article has low-quality text | Analysis still works (Claude is robust); noise tolerance. |
| Individual URL blocked by jina | Single article `full_text: null` | Falls back to `description`. |
| Jina rate limits | Same as "Jina down" | Not expected at ~10 articles/day (1M tokens/month free tier ≫ our usage). |

### 5.5 Cost & limits

- Daily volume: ~5–10 blog articles/day × ~5KB/article = ~50KB/day pulled from Jina.
- Jina free tier: **1M tokens/month** (their metering unit) ≈ hundreds of articles. We are well under.
- Added fetch time: ~2–5s per article, serial → +20–50s to daily-fetch (timeout budget 10min, no issue).

## 6. Phase 2 — Routine slim-down

### 6.1 Prompt reduction

**Today's prompt responsibilities** → **target state**:

| # | Step (today) | Target |
|---|---|---|
| 1 | Read config | ⛔ cut (routine gets what it needs from fetch-cache directly) |
| 2 | Load history.json, health.json | ⛔ cut |
| 3 | Load fetch-cache | ✅ keep |
| 3.5 | Semantic dedup (vs history + same-batch) | ✅ keep — Claude outputs `dedup_decisions` |
| 4 | Per-article analysis | ✅ keep — core of what the routine produces |
| 5 | Generate markdown report | ⛔ cut (build-report.js) |
| 6 | Update history.json | ⛔ cut (build-report.js) |
| 7 | Retention cleanup | ⛔ cut (build-report.js) |
| 8 | Update health.json | ⛔ cut (build-report.js) |
| 9 | `gh issue` alerts | ⛔ cut (build-report.js) |
| 10 | Commit reports/daily + data/history.json + data/health.json + push | 🔄 reduced — commit ONLY `data/analysis-cache/{date}.json` |

**Trend paragraph** is generated by the routine (whole-batch reasoning) as part of the analysis-cache output.

New prompt (target length ~60 lines, 1 conceptual "produce this JSON" task):

```markdown
# CatchUp Daily Routine — Analysis Only

You produce structured analysis of today's AI news. You do NOT write the report,
update history, or manage health — a post-processor handles all that.

## Steps

1. Determine today's date (Asia/Shanghai, YYYY-MM-DD).
2. Read `data/fetch-cache/{date}.json`. If missing, abort (one-line stderr, no commit).
3. For each new article across all sources with status `ok` or `degraded_stale`:
   - Determine `summary` (2-3 Chinese sentences, based on `full_text` if present
     else `description`)
   - Determine `category` (from: 模型发布/研究/产品与功能/商业动态/政策与安全/教程与观点)
   - Determine `importance` (1-5, using the rubric below)
   - Extract `tags` (3-5 Chinese keywords)
   - If category ∈ {模型发布, 产品与功能}: add `practice_suggestions` (1-3 items)
4. Identify thread merges: consecutive tweets from the same author within 5 minutes
   covering the same topic. Output `thread_group_id` shared across them.
5. Identify cross-source duplicates: Anthropic blog + The Batch + Twitter all
   covering the same story. Output `duplicate_of` pointing to the canonical entry.
6. Write one trend paragraph (Chinese, 3-6 sentences) synthesizing the day's themes.
7. Write `data/analysis-cache/{date}.json` with all the above.
   IMPORTANT: append each article's analysis immediately as you complete it — do
   NOT batch until the end. Partial results must survive if you're interrupted.
8. Commit `data/analysis-cache/{date}.json` and push.
```

(Importance rubric + anchor examples kept inline — they're short and load-bearing.)

Removed entirely from the prompt: config.yaml reading, history/health management, retention, gh CLI, report rendering, markdown templates.

### 6.2 analysis-cache schema

```json
{
  "analyzed_at": "2026-04-22T08:12:00+08:00",
  "fetch_cache_ref": "data/fetch-cache/2026-04-22.json",
  "trend_paragraph": "今日...",
  "articles": [
    {
      "url": "https://...",                    // matches fetch-cache article
      "source": "Anthropic (Twitter)",
      "summary": "...",
      "category": "商业动态",
      "importance": 5,
      "tags": ["Anthropic", "Amazon", "AWS", "算力基建", "融资"],
      "practice_suggestions": ["..."],          // omitted unless category ∈ {模型发布, 产品与功能}
      "thread_group_id": "thread-a1b2c3",       // null or shared id
      "duplicate_of": null                       // null or url of canonical entry
    }
  ]
}
```

**URL-hash dedup against history** is done in build-report.js, not in the routine. The routine sees all articles in fetch-cache and analyzes them all; build-report.js filters anything whose URL-hash is already in history.json before writing the report. This is safer than expecting the routine to do URL-hash filtering.

### 6.3 Per-article checkpoint

The routine persists progress incrementally. If the routine is re-triggered (manual dispatch or second scheduled run), it resumes instead of starting over.

**Mechanism**: the prompt instructs Claude, after analyzing each article, to **read the current `analysis-cache/{date}.json`** (if it exists), **append the new article's analysis to the `articles` array**, and **write the whole file back** (whole-file rewrite — simpler and safe since there's one writer at a time and the file is small). On the next run it re-reads the file, sees already-analyzed URLs, and only processes the remaining ones.

The `trend_paragraph` is written only once — on the final article of the batch — and may be overwritten/updated on resumed runs. (Acceptable: the trend is cheap to regenerate and we want it to reflect the final full batch.)

**Consequence**: a stuck routine that wrote 7/12 articles before hanging only needs to re-analyze 5 on retry, not 12. Idempotent by URL.

### 6.4 `scripts/build-report.js` (new, replaces most of the old routine)

Runs in a new workflow `build-report.yml` triggered by push to `data/analysis-cache/**`.

```
Input:  data/fetch-cache/{date}.json
        data/analysis-cache/{date}.json
        data/history.json
        data/health.json
        config.yaml

Output: reports/daily/{date}.md    (new file)
        data/history.json          (appended)
        data/health.json           (updated)
        gh issues                  (opened/closed as needed)
        git commit + push
```

Deterministic logic:
1. Load inputs.
2. For each article in analysis-cache:
   - Compute SHA-256(url).
   - If hash in history.json → skip (already reported).
   - If `duplicate_of` points to another article in this batch → add to canonical's `also_covered_by`, skip as standalone.
   - Else → include in today's report.
3. Group by thread_group_id; concat their summaries under the canonical URL (thread merge).
4. Sort by `importance` desc, `published_at` desc.
5. Filter: `importance >= config.filtering.min_importance` (default 2) — low-importance items persisted to history, not shown in body.
6. Render markdown using the template (same format as today, extracted to code).
7. Append entries to history.json; set `last_fetch`.
8. Apply retention: delete entries where `fetched_at < now - retention_days`.
9. Update health.json from fetch-cache source statuses (same logic as today's Step 8).
10. For sources reaching `consecutive_failures >= threshold`, `gh issue list --label source-alert` and `gh issue create` if missing. For recovered sources, close their open issue.
11. `git add data/history.json data/health.json reports/daily/{date}.md && git commit && git push`.

All of this is testable in Node; `email-push-design.md` shows we already unit-test email-reports.js similarly.

### 6.5 `scripts/fallback-report.js` (new, guaranteed-delivery floor)

Runs in a new workflow `fallback-report.yml` with cron `0 4 * * *` UTC (12:00 CST — 4.5h after fetch).

Logic:
1. Compute today's Asia/Shanghai date.
2. If `reports/daily/{date}.md` already exists → exit 0 (routine succeeded, nothing to do).
3. Else read `data/fetch-cache/{date}.json`. If missing → exit 1 (fetch also failed; nothing we can do).
4. Render a minimal markdown report: grouped by source, one `-` per article with `[title](url)`, no summaries, no categories, no importance. Explicit header marks this as a fallback:
   ```
   # CatchUp 日报 — {date}（fallback，自动回退版）
   > Claude 分析环节未在预期窗口内产出；以下为仅标题+链接的兜底版本。
   ```
5. Commit to `reports/daily/{date}.md` and push.

The existing `email-reports.yml` then fires on push and delivers.

**Do NOT update history.json** in the fallback path — history is for "fully analyzed articles" only. If the routine eventually catches up later in the day, the normal build-report.js can still process the same date's articles (it just won't overwrite the fallback report — that's OK; the inbox already has something, and history stays clean for the weekly/monthly aggregation).

### 6.6 Workflow files

New files:
- `.github/workflows/build-report.yml` — triggers on `push: paths: data/analysis-cache/**`
- `.github/workflows/fallback-report.yml` — cron + manual dispatch
- `scripts/build-report.js`
- `scripts/build-report.test.js`
- `scripts/fallback-report.js`
- `scripts/fallback-report.test.js`

Modified files:
- `scripts/fetch-sources.js` — call `enrichSnapshot()`
- `scripts/lib/enrich.js` — new
- `docs/prompts/daily-trigger.md` — slim-down rewrite
- `.claude/skills/sync-daily-trigger/SKILL.md` — unchanged procedure, but note the new prompt shape

Unchanged:
- `.github/workflows/daily-fetch.yml` (still calls fetch-sources.js; enrichment happens transparently inside)
- `.github/workflows/email-reports.yml`
- `scripts/email-reports.js`
- Route modules under `scripts/routes/**`

## 7. Testing strategy

**Unit tests** (Node, existing `node --test` harness):
- `enrich.test.js`: mocked jina responses (ok / 403 / timeout / garbage); assert `full_text` set or null correctly; assert Twitter sources untouched.
- `build-report.test.js`: synthetic fetch-cache + analysis-cache fixtures; assert rendered markdown matches snapshot, history.json correctly updated, dedup-by-hash works, thread merging works, retention cleanup runs, health state machine transitions.
- `fallback-report.test.js`: fixture with missing report; assert minimal markdown produced; existing-report case is a no-op.

**Integration test** (manual, once):
- Checkout a commit with enrichment + slim routine + build-report in place.
- Run `node scripts/fetch-sources.js` locally → inspect fetch-cache for `full_text` fields.
- Simulate the routine: hand-write a plausible analysis-cache.
- Run `node scripts/build-report.js` locally → inspect generated report.
- Trigger the Cloud routine on a test date → observe it produces analysis-cache only.

## 8. Rollout

Ship Phase 1 and Phase 2 as separate PRs, separate days:

**PR 1 — Enrichment (Phase 1, ~1–2h)**
- `scripts/lib/enrich.js`
- wire into `fetch-sources.js`
- schema docs update
- test with next daily-fetch run (no behavior change for the routine, it just ignores `full_text` at first)
- observe 2 days to confirm no fetch-time blowups

**PR 2 — Routine slim + build-report + fallback (Phase 2, ~0.5 day)**
- new scripts + workflows + tests
- rewrite `docs/prompts/daily-trigger.md`
- run `.claude/skills/sync-daily-trigger` to push the new prompt to the live trigger
- observe: routine produces analysis-cache only; build-report.yml picks up; fallback fires if routine dies
- **PR 2 ships with BOTH paths wired up** — fallback is not "last resort", it's a scheduled safety net from day one

**Migration**: no data migration needed. Existing history.json / health.json / fetch-cache shapes are preserved. The first day after PR 2 lands, the old prompt produces a normal report (if it's still synced); after `sync-daily-trigger` runs, the new prompt takes over.

**Rollback**: revert PR 2 + re-sync old prompt via `sync-daily-trigger` ≈ 10 minutes. PR 1 is independently revertible (remove the enrichment call site).

## 9. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Jina extracts navigation/sidebar noise alongside article body | Medium | Claude tolerates noise in inputs; observed in current Berkeley RDI usage without issue. If problematic for a specific source, add a per-source cleanup in enrich.js. |
| Jina goes down | Low | `full_text: null` fallback preserves today's behavior. |
| build-report.js has a deterministic bug that writes wrong reports | Medium | Extensive unit test coverage before ship; fallback still fires on missing reports but not on wrong reports. Accept this risk; unit-test it hard. |
| Routine write-append-incrementally doesn't work as described in the prompt (Claude batches anyway) | Medium | First failed run will reveal it; can add explicit "you MUST write after each article" framing. Checkpoint is a nice-to-have, not load-bearing — fallback-report is the real safety net. |
| Cron drift: fallback fires before routine had a chance to finish | Low | 4h buffer is ~5x the routine's typical runtime. If routine consistently finishes later, push the cron. |
| Two commits racing (routine commits analysis-cache while build-report is running) | Low | `concurrency: group: build-report, cancel-in-progress: false` in the workflow; per-PR commits are rare (one/day). |
| Fallback report quality is too low to be useful | Low | Explicit "fallback" marking in the email lets the user know to re-trigger the routine; titles + links are already more useful than silence. |

## 10. Open questions

- **Should we attempt to re-trigger the Claude routine automatically when fallback fires?** The `RemoteTrigger` API can dispatch the daily trigger. Adding this would let the system "self-heal" without manual intervention. Deferred — enough robustness without it; revisit after 2 weeks of observation.
- **Should enrichment also capture article images / OG previews?** Not now. Adds schema complexity and parsing risk without obvious report-quality payoff.
- **Should 宝玉的分享 get enrichment via jina?** Its RSS `content:encoded` is usually already full-body. Decision rule during PR 1 implementation: inspect `scripts/routes/baoyu.js`; if it already exposes the full body into `description`, copy it to `full_text` in the route itself; if not, add `宝玉的分享` to `ENRICH_SOURCES`. This is a small branch, not a design question — closed during implementation.
