# CatchUp — AI News Aggregator

An automated AI news aggregation system powered by Claude Code Cloud Scheduled Triggers.

## How It Works

This repo IS the entire system. There is no application code. Cloud Scheduled Triggers run prompts that instruct Claude to:
1. Fetch sources listed in `config.yaml` using WebFetch
2. Analyze articles (summarize, categorize, score importance, suggest practice)
3. Generate markdown reports in `reports/`
4. Persist state to `data/history.json` and `data/health.json`
5. Commit and push

## Key Files

- `config.yaml` — all configuration (sources, categories, analysis dimensions, alerting)
- `data/history.json` — article records keyed by SHA-256 of URL, used for deduplication and report aggregation
- `data/health.json` — per-source health status (healthy / degraded / alert)
- `reports/daily/YYYY-MM-DD.md` — daily reports
- `reports/weekly/YYYY-WNN.md` — weekly reports
- `reports/monthly/YYYY-MM.md` — monthly reports
- `docs/prompts/` — version-controlled trigger prompts (source of truth for trigger configuration)
- `docs/report-examples/` — reference format for each report type

## Rules for Trigger Agents

### Fetching
- Read `config.yaml` for the source list
- For `type: rss` sources: WebFetch the URL, parse the XML to extract article entries
- For `type: web_scraper` sources: WebFetch the URL, extract article titles/links/content from HTML
- Only process articles not already in `data/history.json` (dedup by SHA-256 hash of article URL)
- If a source fails, log the error in `data/health.json` and continue with other sources

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
- After fetching, update `data/health.json` for every source
- Success: set status to "healthy", reset consecutive_failures to 0
- Failure: increment consecutive_failures, set appropriate status
- If consecutive_failures >= threshold from `config.yaml` `alerting.consecutive_failure_threshold`:
  - Check if an open GitHub Issue with label `source-alert` already exists for this source
  - If not, create one with diagnosis and suggestions
- If a previously alerting source recovers, close the corresponding Issue

### Data Cleanup
- During daily runs, remove articles from `data/history.json` where `fetched_at` is older than `retention_days` from config

### Committing
- Stage all changed files: `data/history.json`, `data/health.json`, new report files
- Commit with message: `chore(catchup): daily report YYYY-MM-DD` (or weekly/monthly)
- Push to the repository
