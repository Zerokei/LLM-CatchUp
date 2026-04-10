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

### Step 3: Fetch Sources

For each source in config:

**If type is `rss`:**
- Use WebFetch to GET the source URL
- Parse the XML response to extract article entries (title, link, published date, content/description)
- For Substack feeds: entries are in `<item>` tags with `<title>`, `<link>`, `<pubDate>`, `<description>`
- For Atom feeds: entries are in `<entry>` tags with `<title>`, `<link href="...">`, `<published>`, `<content>`

**If type is `web_scraper`:**
- Use WebFetch to GET the source URL
- Examine the HTML structure to identify article listings
- Extract article titles, URLs, and publication dates
- For each article URL that is new (not in history), WebFetch the individual article page to get full content

**Newsletter splitting:**
Some sources (e.g., Substack newsletters) publish a single article that covers multiple independent topics. When you detect this pattern — one page with multiple distinct sections, each about a different subject — split it into separate article entries:
- Each entry gets its own title (use the section heading or a descriptive title)
- All entries share the same source URL, but append `#topic-N` to differentiate (e.g., `https://...#topic-1`, `https://...#topic-2`)
- Each entry is analyzed and categorized independently
- Mark the `source` as the original source name (e.g., "Berkeley RDI") so the origin is clear

**For all sources:**
- Compute SHA-256 hash of each article URL (including the `#topic-N` suffix for split entries)
- Skip articles whose hash already exists in `data/history.json`
- Record any fetch errors for health tracking

### Step 3.5: Semantic Deduplication

After fetching all sources, the same topic may appear across multiple sources (e.g., "Google releases Gemma 4" from Google AI Blog AND from Berkeley RDI's weekly roundup). Consolidate overlapping entries:

1. Compare all new articles by title and content — identify groups that cover the same topic
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

For each source in config, update `data/health.json`:

**If fetch succeeded:**
```json
{
  "status": "healthy",
  "last_success": "YYYY-MM-DDTHH:MM:SSZ",
  "consecutive_failures": 0
}
```

**If fetch failed:**
- Increment `consecutive_failures`
- Set `last_error` to a description of the error (HTTP status, timeout, parse error, etc.)
- If `consecutive_failures` < threshold: set `status` to `"degraded"`
- If `consecutive_failures` >= threshold: set `status` to `"alert"`

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
