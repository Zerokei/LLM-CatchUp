# CatchUp Daily Trigger — Analysis Only (Subagent Fan-Out)

You produce structured analysis of today's AI news into `data/analysis-cache/{date}.json`. You do NOT render the report, update history, update health, or manage GitHub issues — a post-processor handles all that.

Read `CLAUDE.md` first for project context.

## Workflow

### Step 1: Determine today's date

Use Asia/Shanghai timezone, YYYY-MM-DD format. Record as `{date}`.

### Step 2: Load today's fetch-cache

Read `data/fetch-cache/{date}.json`.

**If the file does not exist**: abort immediately. Write one line to stderr (`fetch-cache missing for {date} — aborting`) and exit without committing anything. Do NOT attempt to WebFetch or fabricate content.

### Step 3: Check for resume state

Read `data/analysis-cache/{date}.json` if it exists. Collect the URLs already present in `articles[].url` — call this set `analyzed_urls`.

If the file does not exist, `analyzed_urls` is empty.

### Step 4: Collect remaining articles

Iterate `fetch-cache.sources`. For each source with `status === "ok"` or `status === "degraded_stale"`, collect each `article` whose `url` is NOT in `analyzed_urls`. Attach the source name onto each article so the subagent can reference it. Call this list `remaining`.

If `remaining` is empty, exit cleanly — the analysis-cache, if one exists, is already complete. Do NOT write, commit, or push anything.

### Step 5: Chunk and dispatch subagents

Split `remaining` into chunks of **10 articles** each (the last chunk may be smaller). For each chunk `i` (0-indexed), dispatch ONE subagent using the `Agent` tool. **Dispatch all chunks in a SINGLE message with multiple Agent tool calls** so they run in parallel.

If the total number of chunks would exceed 12 (i.e., more than 120 remaining articles), reduce to the top 120 by `published_at` desc and let tomorrow's run pick up the rest — this bounds the parallel fan-out to a size the runtime can comfortably handle.

The template below shows what each subagent's prompt should look like. Substitute `{N}` (article count in the chunk), `{date}`, `{i}` (chunk index), and the inlined articles before dispatching.

````
You are a news-analyzer subagent for CatchUp. Analyze these {N} articles from today's batch and write your results to `data/analysis-cache/{date}.chunk-{i}.json`.

For EACH article, produce a JSON object with these 6 fields:

1. title — a concise Chinese title (≤ 40 汉字 or ≤ 60 字符) capturing the article's central claim. Do NOT just truncate the raw tweet text / fetch-cache title — synthesize. Examples of good titles: "Anthropic × Amazon 扩大合作：5GW 算力 + 50 亿美元追投", "Qwen3.6-27B：27B 稠密开源模型打平 397B-A17B 代码基准". Bad: raw tweet first-200-chars; hashtag dumps.
2. summary — 2-3 Chinese sentences. Prioritize content in this order: `article.linked_content` > `article.full_text` > `article.quoted_tweet.text + article.description` > `article.description`.
3. category — one of: 模型发布, 研究, 产品与功能, 商业动态, 政策与安全, 教程与观点
4. importance — integer 1-5:
   - 5: NEW MODEL RELEASE (GPT-5, Claude 5, Gemini 3, major open-weight SOTA)
   - 4: SIGNIFICANT RESEARCH/PRODUCT (paper with empirical result, major product launch)
   - 3: NOTABLE UPDATE (feature release, partnership, funding, policy/regulatory, expert deep-dive)
   - 2: INCREMENTAL (small feature tweak, single observation)
   - 1: LOW-SIGNAL (greeting, meme, reply fragment)
5. tags — 3-5 Chinese keywords (array).
6. practice_suggestions — 1-3 concrete actionable Chinese suggestions, ONLY if `category ∈ {模型发布, 产品与功能}`. Omit otherwise.

Also carry through two fields UNMODIFIED from the fetch-cache article (do NOT recompute): `thread_group_id`, `duplicate_of`. They are already authoritative.

Write a single JSON file to `data/analysis-cache/{date}.chunk-{i}.json` with shape:

```json
{
  "chunk_index": {i},
  "articles": [
    {
      "url": "...", "source": "...", "title": "...", "summary": "...",
      "category": "...", "importance": N, "tags": ["..."],
      "practice_suggestions": ["..."] (optional, omit if not applicable),
      "thread_group_id": null_or_string,
      "duplicate_of": null_or_string
    },
    ...
  ]
}
```

Articles to analyze:

{INLINE THE N ARTICLES HERE — full fields: url, source, title, published_at, description, full_text, linked_content, quoted_tweet, expanded_urls, reply_to, thread_group_id, duplicate_of}

Return just "done" when the file is written.
````

### Step 6: Wait for all subagents, then merge

When all subagent calls return, for each chunk `i` in `[0..chunks-1]`:
- Read `data/analysis-cache/{date}.chunk-{i}.json`.
- If the file is missing OR JSON.parse throws (subagents occasionally emit unescaped ASCII `"` inside Chinese strings), note the chunk index and continue — the affected articles will be re-tried tomorrow since they won't be in the committed analysis-cache. Do NOT attempt a rescue parse.
- For each article in the chunk, validate it has the required fields: `url`, `source`, `title` (non-empty string), `summary` (non-empty string), `category` (string), `importance` (integer 1-5), `tags` (array). Drop any article that fails this check and log which URL+reason to stderr — downstream `scripts/build-report.js` will crash on a malformed article, so it's safer to drop and retry tomorrow than to write a broken cache.
- Append the surviving `articles[]` into the master articles list.

Note: when building the subagent prompt in Step 5, add this sentence near the output-shape block: *"Emit STRICT JSON. If a Chinese summary needs to quote an English term, use corner quotes `「...」` instead of ASCII `\"...\"` — an unescaped ASCII `\"` inside a string breaks the whole chunk file."*

### Step 7: Assemble resume-merged articles

Merge:
- Pre-existing `articles` from `data/analysis-cache/{date}.json` (if it existed at Step 3)
- Plus the new articles from Step 6

Call the combined list `final_articles`.

### Step 8: Compute trend_paragraph

Write a 3-6 Chinese sentence trend paragraph synthesizing the day's themes, based on `final_articles[*].title` + `summary`. (You do NOT need the raw articles — the summaries are enough.)

### Step 9: Write the analysis-cache

Write `data/analysis-cache/{date}.json`:

```json
{
  "analyzed_at": "{ISO 8601 timestamp, Asia/Shanghai}",
  "fetch_cache_ref": "data/fetch-cache/{date}.json",
  "trend_paragraph": "...",
  "articles": [ ...final_articles ]
}
```

### Step 10: Cleanup and commit

Delete all `data/analysis-cache/{date}.chunk-*.json` scratch files.

```bash
git add data/analysis-cache/{date}.json
git commit -m "chore(catchup): daily analysis {date}"
git push
```

If `git diff --cached` is empty (no new articles this run), skip the commit.
