# CatchUp Daily Trigger — Analysis Only

You produce structured analysis of today's AI news into `data/analysis-cache/{date}.json`. You do NOT render the report, update history, update health, or manage GitHub issues — a post-processor handles all that.

Read `CLAUDE.md` first for project context.

## Workflow

### Step 1: Determine today's date

Use Asia/Shanghai timezone, YYYY-MM-DD format. Record as `{date}`.

### Step 2: Load today's fetch-cache

Read `data/fetch-cache/{date}.json`.

**If the file does not exist**: abort immediately. Write one line to stderr (`fetch-cache missing for {date} — aborting`) and exit without committing anything. Do NOT attempt to WebFetch or fabricate content.

### Step 3: Check for resume state

Read `data/analysis-cache/{date}.json` if it exists. It is a partial analysis from an earlier run of this same trigger. Collect the URLs already present in `articles[].url` — call this set `analyzed_urls`.

If the file does not exist, `analyzed_urls` is empty and you will create the file fresh.

### Step 4: Iterate new articles

For each source in `fetch-cache.sources` with `status === "ok"` or `status === "degraded_stale"`:
- For each article in `articles[]`:
  - If `article.url` is in `analyzed_urls`: skip.
  - Else: perform the analysis below.

For each article, determine:

1. **title** — a concise Chinese title (≤ 40 汉字 or ≤ 60 字符) capturing the article's central claim. Do NOT just truncate the raw tweet text / fetch-cache title — synthesize. Examples of good titles: "Anthropic × Amazon 扩大合作：5GW 算力 + 50 亿美元追投", "Qwen3.6-27B：27B 稠密开源模型打平 397B-A17B 代码基准", "OpenAI 推出 Workspace Agents：Codex 驱动的企业 Agent 研究预览". Bad titles (do not produce): raw tweet first-200-chars; abstract hashtag dumps; single words.
2. **summary** — 2-3 Chinese sentences capturing the key point. Prioritize content sources in this order:
   - `article.linked_content` (Twitter primary, jina-fetched blog body the tweet points to)
   - `article.full_text` (blog, jina-fetched body)
   - `article.quoted_tweet.text + article.description` (when quote-tweet)
   - `article.description` (fallback)
3. **category** — one of: `模型发布`, `研究`, `产品与功能`, `商业动态`, `政策与安全`, `教程与观点`
4. **importance** — integer 1-5. Base score:
   - **5** NEW MODEL RELEASE (GPT-5, Claude 5, Gemini 3, major open-weight SOTA)
   - **4** SIGNIFICANT RESEARCH/PRODUCT (paper with empirical result, major product launch, minor version with real capability gain)
   - **3** NOTABLE UPDATE (feature release, partnership, funding, policy/regulatory, expert deep-dive)
   - **2** INCREMENTAL (small feature tweak, single observation)
   - **1** LOW-SIGNAL (greeting, meme, pure RT, reply fragment)
   Modifier: -1 if source role is `aggregator` AND raw text starts with `RT @` or `@<handle>` (pure retweet/reply).
5. **tags** — 3-5 Chinese keywords (array).
6. **practice_suggestions** — 1-3 concrete actionable Chinese suggestions with operating steps, ONLY if `category ∈ {模型发布, 产品与功能}`. Omit the field otherwise.
7. **thread_group_id** — if this article is one of a self-reply chain of tweets from the same author within **5 minutes** covering the same topic, assign them a shared id like `thread-{screen_name}-{YYYYMMDD-HHMM}`. The 5-minute constraint is strict — tweets more than 5 minutes apart are NOT a thread even if they cover the same topic; use `duplicate_of` for those cases instead. Non-thread articles get `null`.
8. **duplicate_of** — if this article covers the same topic as another article in today's batch, and that other article is from a `role: primary` source (while this one is aggregator), set `duplicate_of` to the canonical article's URL. Non-duplicates get `null`.

### Step 5: Write incremental progress

**After analyzing each article**:
- Read the current contents of `data/analysis-cache/{date}.json` (or treat as `{articles: []}` if missing).
- Append the new article's analysis to `articles[]`.
- Write the whole file back.

Keeping progress on disk after each article means a crash or timeout does not require re-analyzing everything.

The article JSON shape:
```json
{
  "url": "...",
  "source": "...",
  "title": "...",
  "summary": "...",
  "category": "...",
  "importance": 4,
  "tags": ["..."],
  "practice_suggestions": ["..."],
  "thread_group_id": null,
  "duplicate_of": null
}
```

(Omit `practice_suggestions` when not applicable. Use `null` for `thread_group_id` and `duplicate_of` when not set.)

### Step 6: Trend paragraph

Once all articles are analyzed (no unprocessed URLs left), write the whole-batch **trend paragraph** (3-6 Chinese sentences synthesizing the day's themes). Update `data/analysis-cache/{date}.json` to include:

```json
{
  "analyzed_at": "{ISO 8601 timestamp, Asia/Shanghai}",
  "fetch_cache_ref": "data/fetch-cache/{date}.json",
  "trend_paragraph": "...",
  "articles": [ ... all articles analyzed above ... ]
}
```

If the trigger is re-run and the file already has a `trend_paragraph` but new articles were added, regenerate the trend paragraph to reflect the full current batch.

### Step 7: Commit and push

```bash
git add data/analysis-cache/{date}.json
git commit -m "chore(catchup): daily analysis {date}"
git push
```

If the file was unchanged (no new articles to add, e.g., resume after full batch was already done), skip the commit.
