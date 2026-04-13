# CatchUp Daily Trigger Prompt

You are the CatchUp daily news aggregator agent. Your job is to fetch AI news from configured sources, analyze each article, generate a daily markdown report, update state files, and commit/push.

Read `CLAUDE.md` first for project context and rules.

## Workflow

Execute these steps in order:

### Step 1: Load Configuration

Read `config.yaml`. Extract:
- `sources`: list of data sources to fetch
- `categories`: the classification categories
- `analysis.dimensions`: extra analysis dimensions to apply
- `output_path`: where to write reports
- `retention_days`: how long to keep history
- `alerting`: failure threshold and alert method

### Step 2: Load State

Read `data/history.json`. This contains all previously processed articles keyed by SHA-256 hash of the article URL. You will use this for deduplication.

Read `data/health.json`. This tracks each source's health status.

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

### Step 3.5: Semantic Deduplication

After fetching all sources, perform two rounds of deduplication:

**Round 1 — Cross-temporal dedup (new articles vs history):**

Aggregator sources (newsletters, roundups) often cover topics that primary sources already reported days earlier. For each new article, compare it against recent articles in `data/history.json` (within the past 14 days) by title and topic:

- If a new article covers the same topic as an existing history entry:
  - Do NOT create a duplicate entry
  - Update the existing entry's `extras.also_covered_by` list to append the new source name
  - If the existing entry had lower importance and this is the 3rd+ source covering it, bump importance by +1 (capped at 5)
  - The new article is consumed — it will not appear in today's report as a separate entry

**Round 2 — Same-batch dedup (new articles vs each other):**

The same topic may also appear across multiple sources fetched in the same run (e.g., Google AI Blog and Berkeley RDI both fetched today). Consolidate overlapping entries:

1. Compare all remaining new articles by title and content — identify groups that cover the same topic
2. For each group of duplicates, apply source priority:
   - Sources with `role: primary` take precedence over `role: aggregator`
   - If multiple primary sources cover the same topic, keep the more detailed one
   - If only aggregator sources cover a topic (no primary source), keep the aggregator entry
3. The winning entry becomes the canonical article. Add a `also_covered_by` field in `extras` listing the other sources that covered the same topic (e.g., `["Berkeley RDI", "The Batch"]`)
4. Being covered by multiple sources is itself a signal — add +1 to the importance score (capped at 5) for articles covered by 3+ sources

Discard the duplicate entries (do not store them in history.json).

### Step 4: Analyze New Articles

For each new article (including split newsletter entries), determine:
1. **summary**: 2-3 sentence Chinese summary capturing the key point
2. **category**: one of the categories from config (use Chinese names)
3. **importance**: 1-5 score based on:
   - 5: Major model release or breakthrough, will reshape the field
   - 4: Significant product update or important research result
   - 3: Notable news worth knowing about
   - 2: Incremental update or niche topic
   - 1: Minor or tangential

Then apply each dimension from `config.yaml` `analysis.dimensions`:
- Check the `condition` field — only apply if condition matches (e.g., category matches)
- Use the `prompt` field as guidance for generating the dimension's content
- Store result under the dimension's `name` in the article's `extras` object

### Step 5: Generate Daily Report

Get today's date in YYYY-MM-DD format.

Create the report file at `{output_path}/daily/{YYYY-MM-DD}.md`.

Follow the format in `docs/report-examples/daily-example.md` exactly:
- Header with date
- Overview table with article counts by category
- Article details sorted by importance (highest first), each with:
  - Title as link
  - Source, category, importance stars, tags (rendered as inline code)
  - Summary paragraph
  - Practice suggestions in blockquote (only if present in extras)
- Trend summary at the bottom
- Data source status table

### Step 6: Update History

Add each newly analyzed article to `data/history.json` under `articles`, keyed by the SHA-256 hash of the URL:

```json
{
  "title": "Article Title",
  "url": "https://...",
  "source": "Source Name",
  "published_at": "YYYY-MM-DD",
  "fetched_at": "YYYY-MM-DDTHH:MM:SSZ",
  "summary": "...",
  "category": "...",
  "importance": 4,
  "extras": {
    "tags": ["tag1", "tag2"],
    "practice_suggestions": ["suggestion1"]
  }
}
```

Update `last_fetch` to current ISO timestamp.

### Step 7: Clean Up Old Data

Calculate the cutoff date: today minus `retention_days` from config.

Remove any article from `data/history.json` where `fetched_at` is before the cutoff date.

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

### Step 9: Handle Alerts

For each source with status `"alert"`:
1. Use `gh issue list --label source-alert --state open` to check for existing open issues for this source
2. If no existing issue, create one:
   ```
   gh issue create --title "CatchUp: [Source Name] 连续抓取失败" --label "source-alert" --body "..."
   ```
   Body should include: source name, URL, error type, consecutive failure count, diagnosis, and fix suggestions.

For each source that recovered (was in alert/degraded, now healthy):
1. Find the open issue for this source and close it:
   ```
   gh issue close <issue-number> --comment "Source recovered and is now healthy."
   ```

### Step 10: Commit and Push

```bash
git add data/history.json data/health.json reports/
git commit -m "chore(catchup): daily report YYYY-MM-DD"
git push
```

Replace YYYY-MM-DD with today's actual date.
