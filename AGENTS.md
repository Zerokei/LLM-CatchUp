# CatchUp — AI News Aggregator

An automated AI news aggregation system powered by Codex Cloud Scheduled Triggers.

## How It Works

This repo has three runtime stages, in order:

**Stage 1 — Fetcher** (`.github/workflows/daily-fetch.yml`, primary cron `37 0 * * *` plus retry `17 3 * * *`, both with `timezone: America/Los_Angeles`; scheduled before the 20:30 Asia/Shanghai analyzer trigger). `scripts/fetch-sources.js` reads `config.yaml`, fetches each source via route modules under `scripts/routes/`, filters to the most recently completed America/Los_Angeles day, enriches blog sources via Jina Reader (`scripts/lib/enrich.js`) and extracts full_text/linked_content where possible, and writes the snapshot to `data/fetch-cache/{YYYY-MM-DD}.json`.

**Stage 2 — Analyzer** (Codex heartbeat automation in the pinned `CatchUp Daily Report` task, runs at 20:30 and retries at 23:30 Asia/Shanghai; a 10:00 repair scan handles recent incomplete/fallback days). The trigger reads `data/fetch-cache/{date}.json` and writes per-article `{summary, category, importance, tags, practice_suggestions, thread_group_id, duplicate_of}` plus a whole-batch `trend_paragraph` to `data/analysis-cache/{date}.json`. Resume state is merged by URL, failed chunks are retried once in-run, and later scheduled invocations pick up anything still missing. It commits and pushes that single file. It does NOT render the markdown report, touch history/health, or manage issues. Prompt: `docs/prompts/daily-trigger.md`; the Codex automation should point at that repo file rather than embed a stale copy.

**Stage 3 — Reporter** (`.github/workflows/build-report.yml`, triggered on push to `data/analysis-cache/**`). `scripts/build-report.js` reads fetch-cache + analysis-cache + history + health + config, does URL-hash dedup against history, merges threads, applies `duplicate_of`, renders **two** markdown files via `scripts/lib/render-report.js` — `{date}.md` (editorial: trend + article details, what subscribers see) and `{date}.ops.md` (counts + source health, debug-only) — updates `data/history.json` + `data/health.json`, opens/closes GitHub issues for alerts, regenerates `feed.xml` (RSS 2.0, ops sidecars excluded by glob; see `scripts/lib/build-rss.js`), and commits+pushes the report pair + state files + feed.

**Safety net — Fallback** (`.github/workflows/fallback-report.yml`, primary cron `30 6 * * *` plus retry `30 9 * * *`, both with `timezone: America/Los_Angeles`). `scripts/fallback-report.js` checks if `reports/daily/{target_date}.md` exists for the most recently completed Pacific day; if not (Stage 2 or 3 failed), it renders a title+link-only report from fetch-cache alone, regenerates `feed.xml`, and commits+pushes. The later Codex retry/repair path can replace this fallback with a formal report. This guarantees subscribers see at least a title+link edition on the feed whenever fetch-cache exists.

**Distribution** — `feed.xml` at the repo root is the only outbound channel. Subscribers point any RSS reader (or an RSS-to-email service like Feedrabbit / Blogtrottr) at `https://raw.githubusercontent.com/Zerokei/LLM-CatchUp/main/feed.xml`. No transactional-email infrastructure to maintain.

## Key Files

- `config.yaml` — all configuration (sources, categories, analysis dimensions, alerting). Each source may declare `max_silence_hours` for staleness detection and `cadence: weekly` to mark the source as weekly-paced (e.g. The Batch newsletter, Berkeley RDI essays). Weekly-cadence content is filtered out of the daily editorial AND skipped by the analyzer's trend computation, but still flows into `data/history.json` so the weekly report picks it up. Sources without `cadence` default to daily.
- `scripts/fetch-sources.js` — the daily fetcher (GH Actions entry point)
- `scripts/routes/` — one module per source, exporting `{ name, fetch() }`. See `scripts/routes/index.js` for the loaded list.
- `data/fetch-cache/YYYY-MM-DD.json` — the daily snapshot consumed by the cloud trigger; produced in CI
- `data/history.json` — article records keyed by SHA-256 of URL, used for deduplication and report aggregation
- `data/health.json` — per-source health status (healthy / degraded / alert)
- `reports/daily/YYYY-MM-DD.md` — daily report (editorial: trend paragraph + article details). This is what subscribers and the website see.
- `reports/daily/YYYY-MM-DD.ops.md` — same date, ops-only sidecar (counts, category histogram, per-source health table). NOT included in `feed.xml` — `scripts/lib/build-rss.js` filters it out by regex (`\.md$` after the date doesn't match `.ops.md`).
- `reports/weekly/YYYY-WNN.md` — weekly reports
- `reports/monthly/YYYY-MM.md` — monthly reports
- `feed.xml` — RSS 2.0 feed at repo root, regenerated on every report build (last 30 items, all cadences mixed; ops sidecars excluded)
- `index.html` — single-page editorial reader at repo root, served via GitHub Pages. Loads `feed.xml` client-side, renders magazine-style. No build step.
- `docs/prompts/` — version-controlled trigger prompts (source of truth; Codex automations should execute these files from the repo instead of embedding prompt copies — see `.agents/skills/sync-daily-trigger/` to verify/repair the daily automation wiring)
- `docs/report-examples/` — reference format for each report type
- `.agents/skills/` — project-level Codex skills (`add-twitter-source`, `sync-daily-trigger`)
- `.codex/agents/` — project-level Codex subagents (`source-diagnoser`, `config-drift-auditor`)

## Rules for Trigger Agents

### Fetching

Fetching itself is done by `scripts/fetch-sources.js` in GH Actions, not by the trigger. The trigger only reads `data/fetch-cache/{YYYY-MM-DD}.json` for the most recently completed America/Los_Angeles date. If the snapshot is missing, abort — do NOT attempt WebFetch or fabricate content; a missing cache means the upstream fetch script needs human attention.

The fetch window is the exact target America/Los_Angeles calendar day: `[00:00, 24:00)`. Runs happen after that day closes so reports do not split US-day discussions across adjacent China-calendar reports.

Twitter sources additionally drop low-signal tweets at fetch time (see `scripts/lib/socialdata-twitter.js#isLowSignalTweet`): pure RTs (`RT @...`) and replies to other accounts. Self-replies are kept — they are how long-form is threaded on Twitter, and `thread_group_id` merges them at report time.

For each source entry in the snapshot:
- If `status === "ok"` or `status === "degraded_stale"`: iterate `articles[]` (already pre-filtered to the target America/Los_Angeles day). Skip any whose SHA-256 URL hash is already in `data/history.json`. Collect the rest for analysis.
- If `status === "error"`: skip for content, note the error for Health Monitoring.
- `articles`: list of `{ title, url, published_at, description, full_text?, linked_content?, expanded_urls?, quoted_tweet?, reply_to?, thread_group_id?, duplicate_of? }` — already pre-filtered to the target America/Los_Angeles day.
  - `full_text` (blog sources): full article body (markdown from Jina Reader or upstream HTML). Null when enrichment failed. Absent for Twitter sources.
  - `linked_content` (primary Twitter sources only): Jina-fetched body of the primary-blog URL the tweet links to, when one exists. Null when no matching URL or fetch failed.
  - `expanded_urls` (Twitter): `[{ t_co, expanded_url, display_url }]` from `entities.urls`.
  - `quoted_tweet` (Twitter): `{ author, text, url }` when the tweet is a quote-tweet, else null.
  - `reply_to` (Twitter): `{ screen_name, status_id }` when the tweet is a reply, else null.
  - `thread_group_id` (Twitter): `thread-{handle}-{YYYYMMDD-HHMM}` (UTC) when this tweet is part of a self-reply chain whose adjacent links are within 5 minutes; else null. Computed deterministically in `scripts/lib/derive-refs.js` — the routine no longer infers this.
  - `duplicate_of` (Twitter): URL of a primary-source article when this aggregator article's `quoted_tweet.url` or any `expanded_urls[*].expanded_url` points at one; else null. Also deterministic; the routine no longer infers this.
  - **Summary-source priority when analyzing:** `linked_content` > `full_text` > `quoted_tweet.text + description` > `description`.

For newsletter-style sources (Berkeley RDI, The Batch) whose articles bundle multiple topics, split into separate entries — append `#topic-N` to the URL, each entry independently categorized.

After collecting across sources, perform two rounds of semantic dedup: (1) compare new articles against the past 14 days in `history.json` — if a topic was already covered, update the existing entry's `extras.also_covered_by` list instead of creating a duplicate; (2) compare new articles against each other — keep `primary` (official blogs, first-party Twitter) over `aggregator` (newsletters, roundups, personal accounts).

## Rules for the Daily Trigger (subagent fan-out)

The daily trigger is now "analysis-only" AND fan-out. Its full procedure lives in `docs/prompts/daily-trigger.md`. Summary:

- Read `data/fetch-cache/{date}.json`; abort cleanly if missing (no WebFetch fallback)
- Read `data/analysis-cache/{date}.json` for resume state; skip any URLs already analyzed
- Chunk remaining articles into groups of ~10; dispatch in waves of at most 3 Agent subagents in parallel (the main agent occupies the fourth runtime slot)
- Each subagent produces per-article `{title, summary, category, importance, tags, practice_suggestions?}` (6 fields) and carries through `thread_group_id` / `duplicate_of` UNMODIFIED from fetch-cache — those are deterministic now (see `scripts/lib/derive-refs.js`, populated during fetch)
- Each subagent writes its chunk to `data/analysis-cache/{date}.chunk-{i}.json`; main agent merges + validates after all return
- Main writes trend_paragraph, writes final `data/analysis-cache/{date}.json`, cleans up chunk files, commits

Deterministic concerns (report rendering, history/health updates, retention, GH issues, commits of reports) are outside the trigger's scope — see `scripts/build-report.js`.

Weekly and monthly triggers aggregate from `data/history.json`, use the same pinned task, and run twice per period for idempotent retry. Both require formal (non-fallback) daily reports for the whole target window before publishing.

## External dependencies

The fetcher depends on external services outside the sources themselves:

- **`api.socialdata.tools`** — paid Twitter REST API used for all `*(Twitter)` sources. Each route module hardcodes both the `handle` (display/URL) and the stable numeric `userId` (Twitter's user ID is immutable even if the handle changes). `scripts/lib/socialdata-twitter.js` calls `GET /twitter/user/:userId/tweets` with a `Authorization: Bearer $SOCIALDATA_API_KEY` header — the only required GH Actions repo secret: `SOCIALDATA_API_KEY`. Cost is ~$0.0002/request, so daily runs cost ~$0.005/day for 13 handles. Why socialdata over other Twitter scraping approaches: RSSHub self-hosted truncates API responses for new/low-trust burner accounts (the `auth_token` cookie carries a session trust score that caps the `/UserTweets` GraphQL response to 1-17 items instead of the full 20); socialdata maintains its own account pool with full timeline access. Single point of failure; if socialdata breaks or the key is revoked, all Twitter sources will `error` and the existing alert pipeline surfaces it after 3 consecutive days.
- **`r.jina.ai`** — reader proxy used by `scripts/routes/berkeley-rdi.js` to route around Cloudflare IP gates on `berkeleyrdi.substack.com`. Substack blocks Azure / GH-Actions IPs even with browser-like headers; jina fetches from its own origin. Single point of failure; if jina breaks, Berkeley RDI will `error` and the existing alert pipeline surfaces it after 3 consecutive days.
