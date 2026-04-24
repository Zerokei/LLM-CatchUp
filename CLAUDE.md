# CatchUp — AI News Aggregator

An automated AI news aggregation system powered by Claude Code Cloud Scheduled Triggers.

## How It Works

This repo has three runtime stages, in order:

**Stage 1 — Fetcher** (`.github/workflows/daily-fetch.yml`, cron `37 21 * * *` UTC = 05:37 Asia/Shanghai; scheduled ~3.5h before the 09:06 CST analyzer trigger to absorb observed GH Actions scheduling drift of up to ~90min). `scripts/fetch-sources.js` reads `config.yaml`, fetches each source via route modules under `scripts/routes/`, filters to a 30h window, enriches blog sources via Jina Reader (`scripts/lib/enrich.js`) and extracts full_text/linked_content where possible, and writes the snapshot to `data/fetch-cache/{YYYY-MM-DD}.json`.

**Stage 2 — Analyzer** (Claude Code Cloud Scheduled Trigger, runs shortly after fetch). The trigger reads `data/fetch-cache/{date}.json` and writes per-article `{summary, category, importance, tags, practice_suggestions, thread_group_id, duplicate_of}` plus a whole-batch `trend_paragraph` to `data/analysis-cache/{date}.json`. Incrementally persisted per article — partial work survives interruptions. Commits and pushes that single file. Does NOT render the markdown report, touch history/health, or manage issues. Prompt: `docs/prompts/daily-trigger.md`; synced to the live trigger via `.claude/skills/sync-daily-trigger/`.

**Stage 3 — Reporter** (`.github/workflows/build-report.yml`, triggered on push to `data/analysis-cache/**`). `scripts/build-report.js` reads fetch-cache + analysis-cache + history + health + config, does URL-hash dedup against history, merges threads, applies `duplicate_of`, renders the markdown report via `scripts/lib/render-report.js`, updates `data/history.json` + `data/health.json`, opens/closes GitHub issues for alerts, and commits+pushes the report + state files.

**Safety net — Fallback** (`.github/workflows/fallback-report.yml`, cron `0 4 * * *` UTC = 12:00 CST). `scripts/fallback-report.js` checks if `reports/daily/{today}.md` exists; if not (Stage 2 or 3 failed), it renders a title+link-only report from fetch-cache alone and commits+pushes. This guarantees the email subscriber always gets something.

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
- `articles`: list of `{ title, url, published_at, description, full_text?, linked_content?, expanded_urls?, quoted_tweet?, reply_to? }` — already pre-filtered to `window_hours` of recency (overlap with yesterday is handled by URL-hash dedup in history.json).
  - `full_text` (blog sources): full article body (markdown from Jina Reader or upstream HTML). Null when enrichment failed. Absent for Twitter sources.
  - `linked_content` (primary Twitter sources only): Jina-fetched body of the primary-blog URL the tweet links to, when one exists. Null when no matching URL or fetch failed.
  - `expanded_urls` (Twitter): `[{ t_co, expanded_url, display_url }]` from `entities.urls`.
  - `quoted_tweet` (Twitter): `{ author, text, url }` when the tweet is a quote-tweet, else null.
  - `reply_to` (Twitter): `{ screen_name, status_id }` when the tweet is a reply, else null.
  - **Summary-source priority when analyzing:** `linked_content` > `full_text` > `quoted_tweet.text + description` > `description`.

For newsletter-style sources (Berkeley RDI, The Batch) whose articles bundle multiple topics, split into separate entries — append `#topic-N` to the URL, each entry independently categorized.

After collecting across sources, perform two rounds of semantic dedup: (1) compare new articles against the past 14 days in `history.json` — if a topic was already covered, update the existing entry's `extras.also_covered_by` list instead of creating a duplicate; (2) compare new articles against each other — keep `primary` (official blogs, first-party Twitter) over `aggregator` (newsletters, roundups, personal accounts).

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

## External dependencies

The fetcher depends on external services outside the sources themselves:

- **`api.socialdata.tools`** — paid Twitter REST API used for all `*(Twitter)` sources. Each route module hardcodes both the `handle` (display/URL) and the stable numeric `userId` (Twitter's user ID is immutable even if the handle changes). `scripts/lib/socialdata-twitter.js` calls `GET /twitter/user/:userId/tweets` with a `Authorization: Bearer $SOCIALDATA_API_KEY` header — the only required GH Actions repo secret: `SOCIALDATA_API_KEY`. Cost is ~$0.0002/request, so daily runs cost ~$0.005/day for 13 handles. Why socialdata over other Twitter scraping approaches: RSSHub self-hosted truncates API responses for new/low-trust burner accounts (the `auth_token` cookie carries a session trust score that caps the `/UserTweets` GraphQL response to 1-17 items instead of the full 20); socialdata maintains its own account pool with full timeline access. Single point of failure; if socialdata breaks or the key is revoked, all Twitter sources will `error` and the existing alert pipeline surfaces it after 3 consecutive days.
- **`r.jina.ai`** — reader proxy used by `scripts/routes/berkeley-rdi.js` to route around Cloudflare IP gates on `berkeleyrdi.substack.com`. Substack blocks Azure / GH-Actions IPs even with browser-like headers; jina fetches from its own origin. Single point of failure; if jina breaks, Berkeley RDI will `error` and the existing alert pipeline surfaces it after 3 consecutive days.
- **`resend.com`** — transactional email API used by `.github/workflows/email-reports.yml` to deliver each newly-generated report to the user's inbox. Requires two GH Actions repo secrets: `RESEND_API_KEY` (from resend.com dashboard) and `RESEND_TO` (recipient email). Sender defaults to `onboarding@resend.dev` unless `RESEND_FROM` is set. Manual resend: `gh workflow run email-reports.yml -f report_path=reports/daily/<date>.md`. Manual backfill: `gh workflow run email-reports.yml -f backfill_days=7`.
