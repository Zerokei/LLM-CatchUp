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

Iterate `fetch-cache.sources`. For each source with `status === "ok"` or `status === "degraded_stale"`, collect each `article` whose `url` is NOT in `analyzed_urls`. Attach **two** fields onto each article so the subagent and Step 8 can reference them: `source` (the source name) and `cadence` (the source's `cadence` field, defaulting to `"daily"` if absent — sources without a cadence field are daily). Call this list `remaining`.

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
   - 5: FLAGSHIP MODEL RELEASE — any new version of a flagship model (GPT-5.x, Claude Opus 4.x/5, Gemini 3.x, Qwen 3.x, DeepSeek V4, Llama 4 等). Minor version bumps (e.g. 4.6 → 4.7) still rate 5 when accompanied by benchmark wins (Terminal-Bench / SWE-Bench / Tau / OSWorld / Artificial Analysis Coding Index, etc.). Major open-weight SOTA also 5.
   - 4: SIGNIFICANT RESEARCH/PRODUCT — paper with empirical result, major product launch. **Always 4 minimum** for any Claude Code release or feature update (Web & mobile, slash commands, skills, agents, plugins, connectors, performance improvements, etc.).
   - 3: NOTABLE UPDATE — feature release, partnership, funding, policy/regulatory, expert deep-dive.
   - 2: INCREMENTAL — small feature tweak, single observation.
   - 1: LOW-SIGNAL — greeting, meme, reply fragment.
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

### Step 7.5: Cluster identification

Scan all articles in `final_articles`. Group articles that share **the same specific product, release, paper, partnership, or news event** — even when each article covers a distinct angle, sub-feature, benchmark, or first-party commentary. **Aggressive clustering is the default: when in doubt, cluster.** Angle differences are NOT a reason to keep them separate — different angles become different "多角度报道" entries under one event in the rendered report.

Examples of valid clusters:
- All articles about the GPT-5.5 release: official announcement + Devs API details + Sam Altman's personality commentary + partner reactions + media test reports → one event.
- All articles about a specific paper (e.g., Google DeepMind DiLoCo): paper drop + author thread + secondary commentary → one event.
- All tweets in a single product launch from the same official handle (lead announcement + follow-up feature highlights), even when split across multiple threads or standalone tweets.

Do **NOT** cluster merely on shared broad topics ("AI", "models", "OpenAI products", "agentic coding"). The bar is "same specific event/product/paper".

For each cluster of 2+ articles:
1. Pick the canonical article in this priority order: primary-source blog (OpenAI Blog, Google AI Blog, Anthropic Blog, Anthropic Research, The Batch, Berkeley RDI) > primary-source first-party Twitter (OpenAI, Anthropic, Google DeepMind, Claude, Claude Devs, OpenAI Devs, Meta AI, Mistral AI, xAI, DeepSeek, Qwen) > aggregator Twitter (Sam Altman, Dario Amodei, Demis Hassabis, Andrej Karpathy, Thariq, 宝玉的分享). Within the same priority tier, prefer the earliest-published article (usually the lead announcement).
2. Set `duplicate_of = <canonical_url>` for every non-canonical member.
3. If a non-canonical member already has a `duplicate_of` set (from the deterministic fetch-time preprocessing), leave it alone — that earlier value is already correct and more specific.

**Thread-group constraint** (gets silently wrong otherwise): the renderer collapses each `thread_group_id` to its earliest-published member BEFORE resolving `duplicate_of`. So:
- The **canonical URL** must be either (a) a standalone article, or (b) the earliest-published member of its thread group. Never use a non-leader thread sibling's URL as canonical — the lookup will fail and the cluster won't collapse.
- For a non-canonical article inside a thread group, set `duplicate_of` only on the thread leader (earliest-published in that group). The rest of that thread's siblings are already absorbed into the leader by thread merge — leave their `duplicate_of` alone.

Singletons (clusters of 1) get no change. They render the same template as clusters but without the multi-angle list.

### Step 7.6: Cluster synthesis

For each cluster identified in Step 7.5 (i.e. each canonical that has ≥1 non-canonical member pointing at it), **rewrite the canonical's fields** to represent the entire event, and **annotate each non-canonical member** with what angle it contributes. Singletons skip this step.

**On the canonical** (rewrite these fields in place):
- `title` (≤40 汉字): an event-level title. Not the canonical's original tweet text — synthesize. Example: "GPT-5.5 全面上线：API 开放 + 1M 上下文 + Agent 升级".
- `summary` (3-5 sentences, Chinese): synthesize across all cluster members. The reader should get the full picture in one read — main facts from the canonical, plus any distinct contributions each member adds (benchmarks, third-party tests, official commentary, sub-feature highlights). Don't list sources by name in the summary — that's what 多角度报道 is for; just weave in the substance.
- `tags`: union of all members' tags, deduped, capped at 5-7. Order: most-specific first.
- `practice_suggestions`: union of all members' suggestions, deduped (drop near-duplicates), capped at 3-4. Only present if `category ∈ {模型发布, 产品与功能}`.
- `importance`: re-evaluate the cluster as a single event using the same 1-5 rubric — broad cross-source coverage often signals real impact and warrants a higher score than any single member. Don't blindly take max; assess the event's overall significance. A flagship release covered by official blog + 3+ first-party threads + commentary should usually be a 5.
- `category`: usually the canonical's existing category. Only change if the cluster's center-of-gravity is clearly elsewhere (rare).

**On each non-canonical member** (the articles whose `duplicate_of` points at this canonical):
- Add an `angle` field (≤20 汉字, Chinese): a one-line characterization of what this specific source contributes. Examples: "API 上线细节", "第三方实测", "Altman 人格点评", "Agent 能力侧重", "竞品对比". This is what the reader sees in the 多角度报道 list under the event.
- Leave all other fields (title, summary, etc.) UNCHANGED — they're not rendered for non-canonical members, but the title is still used as the link text in 多角度报道.

The renderer reads `duplicate_of` to gather members under each canonical and uses the canonical's rewritten fields plus each member's `angle` to render a unified event entry.

### Step 8: Compute trend_paragraph

The value MUST be a bulleted markdown list, NOT prose. Synthesize **only from articles whose `source.cadence === "daily"`** (i.e. ignore weekly-cadence sources like Berkeley RDI and The Batch — their themes are summarized in the weekly report instead). Use `final_articles[*].title + summary` for the daily-cadence subset.

Shape — 3-5 bullets, one sentence each:

```
- **{主题词 6-10 汉字}**：{一句话解释 30-60 汉字}。
- **{下一主题}**：{下一句}。
```

Rules:
- One sentence per bullet. Two ideas = two bullets, never comma-chained.
- Each bullet leads with a **加粗主题词** + `：`（全角冒号）+ explanation.
- Cite 1-2 specific products/companies as evidence; don't itemize partner lists.
- No "今日主线是…" opener, no closing summary. Bullets only.

Field name stays `trend_paragraph` for back-compat; the value is a markdown string with `\n`-separated bullets.

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
