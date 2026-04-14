# CatchUp — AI News Aggregator

An automated AI news aggregation system powered by Claude Code Cloud Scheduled Triggers.

## How It Works

This repo has two runtime halves:

**Fetcher half** — `scripts/fetch-sources.js` runs in a daily GitHub Actions workflow (cron `37 23 * * *` UTC = 07:37 Asia/Shanghai). It reads `config.yaml`, fetches each source using route modules under `scripts/routes/`, filters each source's articles to a 30h window (slight overlap covers cron drift), and writes the snapshot to `data/fetch-cache/{YYYY-MM-DD}.json`.

**Reporter half** — Claude Code Cloud Scheduled Triggers run daily / weekly / monthly. The daily trigger reads the pre-built fetch-cache snapshot (it does NOT fetch external URLs), analyzes articles, generates a markdown report in `reports/`, updates `data/history.json` and `data/health.json`, and commits/pushes.

## Key Files

- `config.yaml` — all configuration (sources, categories, analysis dimensions, alerting). Each source may declare `max_silence_hours` for staleness detection.
- `scripts/fetch-sources.js` — the daily fetcher (GH Actions entry point)
- `scripts/routes/` — one module per source, exporting `{ name, fetch() }`. See `scripts/routes/index.js` for the loaded list.
- `data/fetch-cache/YYYY-MM-DD.json` — the daily snapshot consumed by the cloud trigger; produced in CI
- `data/history.json` — article records keyed by SHA-256 of URL, used for deduplication and report aggregation
- `data/health.json` — per-source health status (healthy / degraded / alert)
- `reports/daily/YYYY-MM-DD.md` — daily reports
- `reports/weekly/YYYY-WNN.md` — weekly reports
- `reports/monthly/YYYY-MM.md` — monthly reports
- `docs/prompts/` — version-controlled trigger prompts (source of truth; live cloud triggers hold their own embedded copies and must be synced after edits — see `.claude/skills/sync-daily-trigger/`)
- `docs/report-examples/` — reference format for each report type
- `.claude/skills/` — project-level slash-command skills (`/add-twitter-source`, `/sync-daily-trigger`)
- `.claude/agents/` — project-level subagents (`source-diagnoser`, `config-drift-auditor`)

## Rules for Trigger Agents

### Fetching

Fetching itself is done by `scripts/fetch-sources.js` in GH Actions, not by the trigger. The trigger only reads `data/fetch-cache/{YYYY-MM-DD}.json` (Asia/Shanghai date). If the snapshot is missing, abort — do NOT attempt WebFetch or fabricate content; a missing cache means the upstream fetch script needs human attention.

The fetch window is **30h** (not 24h): daily runs don't fire at exactly the same wall-clock time due to GH Actions queue drift. 6h of overlap between consecutive runs guarantees no article falls through the gap; dedup-by-URL-hash in `data/history.json` absorbs the duplicates.

For each source entry in the snapshot:
- If `status === "ok"` or `status === "degraded_stale"`: iterate `articles[]` (already pre-filtered to the 30h window). Skip any whose SHA-256 URL hash is already in `data/history.json`. Collect the rest for analysis.
- If `status === "error"`: skip for content, note the error for Health Monitoring.

For newsletter-style sources (Berkeley RDI, The Batch) whose articles bundle multiple topics, split into separate entries — append `#topic-N` to the URL, each entry independently categorized.

After collecting across sources, perform two rounds of semantic dedup: (1) compare new articles against the past 14 days in `history.json` — if a topic was already covered, update the existing entry's `extras.also_covered_by` list instead of creating a duplicate; (2) compare new articles against each other — keep `primary` (official blogs, first-party Twitter) over `aggregator` (newsletters, roundups, personal accounts).

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

The fetch-cache produces one of three statuses per source:
- `ok` — HTTP succeeded, newest item within the source's `max_silence_hours` threshold (or no threshold declared).
- `degraded_stale` — HTTP succeeded, but either the newest item is older than `max_silence_hours` OR the fetch returned zero items with a threshold set. Indicates an upstream freeze (e.g., a Twitter-to-RSS mirror no longer syncing, or an empty feed). Distinct from `error` because the fetcher did not throw.
- `error` — HTTP error, parse failure, or route logic error. Message in the `error` field.

For each source, update `data/health.json`:
- `ok` → status "healthy", reset `consecutive_failures` to 0.
- `degraded_stale` or `error` → increment `consecutive_failures`, copy the `error` field into `last_error`. If `consecutive_failures` < `alerting.consecutive_failure_threshold` from config: status "degraded". If >= threshold: status "alert" (see alert handling below).

For each source with status `"alert"`:
1. Check `gh issue list --label source-alert --state open` for an existing open issue.
2. If none exists, open one with `gh issue create --title "CatchUp: [Source Name] 连续失败" --label source-alert --body "<diagnosis>"`. Body should include source name, URL, error type, consecutive_failure count, diagnosis, and fix suggestions.

For each previously-alerting source that is now healthy, close its open issue with a recovery comment.

### Data Cleanup
- During daily runs, remove articles from `data/history.json` where `fetched_at` is older than `retention_days` from config

### Committing
- Stage all changed files: `data/history.json`, `data/health.json`, new report files
- Commit with message: `chore(catchup): daily report YYYY-MM-DD` (or weekly/monthly)
- Push to the repository

## External dependencies

The fetcher depends on two external services outside the sources themselves:

- **`api.xgo.ing`** — Twitter-to-RSS mirror used for all `*(Twitter)` sources. Looks up tweets by opaque UUID (one per handle); the UUIDs are sourced from the public [BestBlogs OPML](https://github.com/ginobefun/BestBlogs). When the mirror freezes (all same-tier handles go quiet simultaneously), the `max_silence_hours` staleness check catches it as `degraded_stale`.
- **`r.jina.ai`** — reader proxy used by `scripts/routes/berkeley-rdi.js` to route around Cloudflare IP gates on `berkeleyrdi.substack.com`. Substack blocks Azure / GH-Actions IPs even with browser-like headers; jina fetches from its own origin. Single point of failure; if jina breaks, Berkeley RDI will `error` and the existing alert pipeline surfaces it after 3 consecutive days.
