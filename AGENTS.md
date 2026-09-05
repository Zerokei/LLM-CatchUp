# CatchUp — AI News Aggregator

An automated AI news aggregation system powered by Codex Cloud Scheduled Triggers.

## How It Works

This repo has three runtime stages, in order:

**Stage 1 — Fetcher** (`.github/workflows/daily-fetch.yml`, primary cron `37 0 * * *` plus retry `17 3 * * *`, both with `timezone: America/Los_Angeles`; scheduled before the 20:30 Asia/Shanghai analyzer trigger). `scripts/fetch-sources.js` reads `config.yaml`; blog sources are filtered to the completed Pacific day, while Twitter sources use incremental Search with a 48-hour overlap and a persistent pending queue in `data/twitter-state.json`. It enriches selected content via Jina and writes `data/fetch-cache/{YYYY-MM-DD}.json`. The later cron runs with `RESUME_EXISTING=true`: it exits without network calls when complete, or refetches only missing/error sources. The snapshot and Twitter state are committed atomically.

**Stage 2 — Analyzer** (one Codex heartbeat automation in the pinned `CatchUp Daily Report` task, because a task can have only one heartbeat). It runs `docs/prompts/report-scheduler.md` at 20:30 and 23:30 Asia/Shanghai. The analyzer reads `data/fetch-cache/{date}.json`, carries through `origin_report_date` / `delivery_class`, and writes structured analysis to `data/analysis-cache/{date}.json`. Backfills are analyzed normally but excluded from `trend_paragraph`. Resume state is merged by URL; failed chunks are retried once. It does NOT render reports or update history/health.

**Stage 3 — Reporter** (`.github/workflows/build-report.yml`, triggered on push to `data/analysis-cache/**`). `scripts/build-report.js` deduplicates against history, merges threads/clusters, renders current items plus a compact `往期补遗` section, and writes `data/history.json`. Only this formal history write consumes pending Twitter items; fallback reports do not. It also updates health/issues, RSS, HTML, and the editorial/ops report pair.

**Safety net — Fallback** (`.github/workflows/fallback-report.yml`, primary cron `30 6 * * *` plus retry `30 9 * * *`, both with `timezone: America/Los_Angeles`). `scripts/fallback-report.js` checks if `reports/daily/{target_date}.md` exists for the most recently completed Pacific day; if not (Stage 2 or 3 failed), it renders a title+link-only report from fetch-cache alone, regenerates `feed.xml`, and commits+pushes. The later Codex retry/repair path can replace this fallback with a formal report. This guarantees subscribers see at least a title+link edition on the feed whenever fetch-cache exists.

**Distribution** — `feed.xml` at the repo root is the only outbound channel. Subscribers point any RSS reader (or an RSS-to-email service like Feedrabbit / Blogtrottr) at `https://raw.githubusercontent.com/Zerokei/LLM-CatchUp/main/feed.xml`. No transactional-email infrastructure to maintain.

## Key Files

- `config.yaml` — all configuration (sources, categories, analysis dimensions, alerting). Each source may declare `max_silence_hours` for staleness detection and `cadence: weekly` to mark the source as weekly-paced (e.g. The Batch newsletter, Berkeley RDI essays). Weekly-cadence content is filtered out of the daily editorial AND skipped by the analyzer's trend computation, but still flows into `data/history.json` so the weekly report picks it up. Sources without `cadence` default to daily.
- `scripts/fetch-sources.js` — the daily fetcher (GH Actions entry point)
- `scripts/routes/` — one module per source, exporting `{ name, fetch() }`. See `scripts/routes/index.js` for the loaded list.
- `data/fetch-cache/YYYY-MM-DD.json` — the daily snapshot consumed by the cloud trigger; produced in CI
- `data/twitter-state.json` — per-account X coverage watermarks and the unconsumed tweet queue
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

The editorial current-day window is the exact target America/Los_Angeles calendar day: `[00:00, 24:00)`. Twitter provider queries may begin 48 hours before their persisted `covered_through` watermark; tweet-ID deduplication makes this overlap safe, and pending older items may be delivered as backfill.

Twitter sources drop low-signal tweets at fetch time (see `scripts/lib/socialdata-twitter.js#isLowSignalTweet`). Search includes `-filter:replies` so replies are excluded before billing results are returned; the local filter rejects any reply that still appears, including self-replies, plus pure RTs (`RT @...`). Quote tweets and original posts remain eligible.

Twitter fetching is incremental and complete: each route queries `from:{handle} -filter:replies since_time:{covered_through-48h} until_time:{window_end}` and follows every cursor. Empty Search is a successful zero-result fetch and never triggers timeline verification. Watermarks advance only after complete pagination. There is no automatic timeline audit. `twitter_fetch_mode: timeline` remains available as a manual per-source fallback for a confirmed Search problem. SocialData calls use a 15-second request timeout and a 60-second account deadline.

For each source entry in the snapshot:
- If `status === "ok"` or `status === "degraded_stale"`: iterate `articles[]`. Each entry is either target-day `delivery_class: current` or an unconsumed `delivery_class: backfill`; history-backed queue pruning has already removed formally consumed URLs.
- If `status === "error"`: skip for content, note the error for Health Monitoring.
- `articles`: list of `{ title, url, published_at, description, origin_report_date, delivery_class, full_text?, linked_content?, expanded_urls?, quoted_tweet?, reply_to?, thread_group_id?, duplicate_of? }`. `delivery_class` is `current` or `backfill`; at most 10 oldest backfills are selected per report and pending expires after 30 days.
  - `full_text` (blog sources): full article body (markdown from Jina Reader or upstream HTML). Null when enrichment failed. Absent for Twitter sources.
  - `linked_content` (primary Twitter sources only): Jina-fetched body of the primary-blog URL the tweet links to, when one exists. Null when no matching URL or fetch failed.
  - `expanded_urls` (Twitter): `[{ t_co, expanded_url, display_url }]` from `entities.urls`.
  - `quoted_tweet` (Twitter): `{ author, text, url }` when the tweet is a quote-tweet, else null.
  - `reply_to` (Twitter): `{ screen_name, status_id }` when the tweet is a reply, else null.
  - `thread_group_id` (Twitter): deterministic legacy/manual-timeline thread metadata when applicable; normal Search excludes replies, so new Search entries are ordinarily null.
  - `duplicate_of` (Twitter): URL of a primary-source article when this aggregator article's `quoted_tweet.url` or any `expanded_urls[*].expanded_url` points at one; else null. Also deterministic; the routine no longer infers this.
  - **Summary-source priority when analyzing:** `linked_content` > `full_text` > `quoted_tweet.text + description` > `description`.

For newsletter-style sources (Berkeley RDI, The Batch) whose articles bundle multiple topics, split into separate entries — append `#topic-N` to the URL, each entry independently categorized.

After collecting across sources, perform two rounds of semantic dedup: (1) compare new articles against the past 14 days in `history.json` — if a topic was already covered, update the existing entry's `extras.also_covered_by` list instead of creating a duplicate; (2) compare new articles against each other — keep `primary` (official blogs, first-party Twitter) over `aggregator` (newsletters, roundups, personal accounts).

## Rules for the Daily Trigger (subagent fan-out)

The daily trigger is now "analysis-only" AND fan-out. Its full procedure lives in `docs/prompts/daily-trigger.md`. Summary:

- Read `data/fetch-cache/{date}.json`; abort cleanly if missing (no WebFetch fallback)
- Read `data/analysis-cache/{date}.json` for resume state; skip any URLs already analyzed
- Chunk remaining articles into groups of ~10; dispatch in waves of at most 3 Agent subagents in parallel (the main agent occupies the fourth runtime slot)
- Each subagent produces per-article `{title, summary, category, importance, tags, practice_suggestions?}` and carries through `thread_group_id`, `duplicate_of`, `origin_report_date`, and `delivery_class` UNMODIFIED. Backfills are excluded from the daily trend.
- Each subagent writes its chunk to `data/analysis-cache/{date}.chunk-{i}.json`; main agent merges + validates after all return
- Main writes trend_paragraph, writes final `data/analysis-cache/{date}.json`, cleans up chunk files, commits

Deterministic concerns (report rendering, history/health updates, retention, GH issues, commits of reports) are outside the trigger's scope — see `scripts/build-report.js`.

Weekly and monthly triggers aggregate from `data/history.json`, use the same pinned task, and run twice per period for idempotent retry. Both require formal (non-fallback) daily reports for the whole target window before publishing.

## External dependencies

The fetcher depends on external services outside the sources themselves:

- **`api.socialdata.tools`** — paid Twitter REST API used for all `*(Twitter)` sources. Routes hardcode `handle` plus immutable numeric `userId`. Daily collection uses reply-free incremental Search with no automatic timeline audit; a source uses timeline only when explicitly configured with `twitter_fetch_mode: timeline`. The required secret is `SOCIALDATA_API_KEY`. Billing is per tweet returned (currently $0.0002/tweet), recorded in `api_usage`. If the service/key fails all Twitter sources error together; long silence is detected from persisted `last_seen_published_at` and `max_silence_hours`.
- **`r.jina.ai`** — reader proxy used by `scripts/routes/berkeley-rdi.js` to route around Cloudflare IP gates on `berkeleyrdi.substack.com`. Substack blocks Azure / GH-Actions IPs even with browser-like headers; jina fetches from its own origin. Single point of failure; if jina breaks, Berkeley RDI will `error` and the existing alert pipeline surfaces it after 3 consecutive days.
