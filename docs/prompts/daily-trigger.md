# CatchUp Daily Trigger — Analysis Only (Subagent Fan-Out)

**Execute Steps 0–10 below now. Do NOT ask the user for confirmation, clarification, or instructions — this is a scheduled, unattended run with no human in the loop. Do NOT treat this prompt as project context to acknowledge; treat it as the task itself. If a step's precondition fails (e.g. fetch-cache missing), follow that step's stated abort behavior and exit; otherwise proceed straight through to Step 10.**

You produce structured analysis of the most recently completed America/Los_Angeles news day into `data/analysis-cache/{date}.json`. You do NOT render the report, update history, update health, or manage GitHub issues — a post-processor handles all that.

Read `AGENTS.md` first for project context.

## Workflow

### Step 0: Recover and sync the local checkout with origin/main

Before determining the target date or checking local cache files:

1. Run `git status`. If a rebase from an earlier automation run is still in progress, run `git rebase --abort` first so the checkout returns to its pre-rebase state. Never leave the shared checkout stuck mid-rebase.
2. Do not discard, reset, or overwrite unrelated user changes. If unrelated changes make syncing unsafe, abort and list the affected paths.
3. Sync with `origin/main`:

```bash
git fetch origin main
git rebase origin/main
```

The repository remote uses SSH and the automation sandbox may initially reject writes to `.git` or access to `github.com:22`. A first failure containing `Operation not permitted`, a sandbox denial, or an SSH/network restriction is **not** yet a repository failure: immediately retry that Git command with elevated permission. Only abort after the elevated retry also fails.

If the rebase reports content conflicts, run `git rebase --abort`, confirm the checkout is no longer mid-rebase, then abort the analysis and report the conflicting paths. Do NOT continue against a stale checkout, because the GitHub Actions fetcher may have pushed `data/fetch-cache/{date}.json` to `main` after this automation workspace was prepared.

### Step 1: Determine the target report date

Use America/Los_Angeles timezone. Normally, the target report date is yesterday in America/Los_Angeles, formatted as YYYY-MM-DD. Record it as `{date}`.

The repair automation may invoke this workflow with one explicit `TARGET_DATE=YYYY-MM-DD`. In that case, validate that the date is not later than the normal target date, use it as `{date}`, and do not silently switch back to yesterday. No other implicit backfill scan is allowed here.

### Step 2: Load the target date fetch-cache

Read `data/fetch-cache/{date}.json`.

**If the file does not exist**: abort immediately. Write one line to stderr (`fetch-cache missing for {date} — aborting`) and exit without committing anything. Do NOT attempt to WebFetch or fabricate content.

### Step 3: Check for resume state

Read `data/analysis-cache/{date}.json` if it exists. Collect the URLs already present in `articles[].url` — call this set `analyzed_urls`.

If the file does not exist, `analyzed_urls` is empty.

### Step 4: Collect remaining articles

Iterate `fetch-cache.sources`. For each source with `status === "ok"` or `status === "degraded_stale"`, collect each `article` whose `url` is NOT in `analyzed_urls`. Attach **two** fields onto each article so the subagent and Step 8 can reference them: `source` (the source name) and `cadence` (the source's `cadence` field, defaulting to `"daily"` if absent — sources without a cadence field are daily). Call this list `remaining`.

If `remaining` is empty:

- If the analysis-cache does not yet exist, write a valid empty cache for the date with `analyzed_at`, `fetch_cache_ref`, `articles: []`, and `trend_paragraph: "- **暂无新增内容**：该太平洋时区抓取窗口内没有需要分析的新文章。"`, then skip to Step 10. This lets the deterministic reporter publish a formal zero-article report and update source health instead of relying on fallback.
- If the analysis-cache exists, verify the final report. It is formal only when both `reports/daily/{date}.md` and `reports/daily/{date}.ops.md` exist and the editorial file does not contain `fallback，自动回退版`.
  - If the formal report exists, clean up any stale chunk files for this date and exit successfully without writing or committing.
  - If the report is missing, lacks its ops sidecar, or is still fallback, add or update `report_retry_requested_at` in the existing analysis-cache with the current ISO timestamp, leave its analysis fields unchanged, and skip to Step 10. The resulting analysis-cache commit deliberately re-triggers `build-report.yml`.

### Step 5: Chunk and dispatch subagents

Split `remaining` into chunks of **10 articles** each (the last chunk may be smaller). For each chunk `i` (0-indexed), dispatch ONE subagent using the `Agent` tool.

The runtime has four total agent slots, including the main agent. Dispatch chunks in waves of at most **3 subagents in parallel**. Put the calls for one wave in a single message, wait for that wave to finish, then dispatch the next wave. Do not submit more than three concurrent subagent calls; exceeding the slot limit causes otherwise-valid chunks to be rejected before they start.

If the total number of chunks would exceed 12 (i.e., more than 120 remaining articles), reduce to the top 120 by `published_at` desc. The later same-date retry or repair invocation will pick up URLs not yet present in the analysis-cache.

The template below shows what each subagent's prompt should look like. Substitute `{N}` (article count in the chunk), `{date}`, `{i}` (chunk index), and the inlined articles before dispatching.

````
You are a news-analyzer subagent for CatchUp. Analyze these {N} articles from the America/Los_Angeles reporting batch for {date} and write your results to `data/analysis-cache/{date}.chunk-{i}.json`.

For EACH article, produce a JSON object with these 6 fields:

1. title — a concise Chinese title (≤ 40 汉字 or ≤ 60 字符) capturing the article's central claim. Do NOT just truncate the raw tweet text / fetch-cache title — synthesize. Examples of good titles: "Anthropic × Amazon 扩大合作：5GW 算力 + 50 亿美元追投", "Qwen3.6-27B：27B 稠密开源模型打平 397B-A17B 代码基准". Bad: raw tweet first-200-chars; hashtag dumps.
2. summary — 2-3 Chinese sentences. Prioritize content in this order: `article.linked_content` > `article.full_text` > `article.quoted_tweet.text + article.description` > `article.description`.
3. category — one of: 模型发布, 研究, 产品与功能, 商业动态, 政策与安全, 教程与观点
4. importance — integer 1-5:
   - 5: FLAGSHIP MODEL RELEASE — any new version of a flagship model (GPT-5.x, Claude Opus 4.x/5, Gemini 3.x, Qwen 3.x, DeepSeek V4, Llama 4 等). Minor version bumps (e.g. 4.6 → 4.7) still rate 5 when accompanied by benchmark wins (Terminal-Bench / SWE-Bench / Tau / OSWorld / Artificial Analysis Coding Index, etc.). Major open-weight SOTA also 5.
   - 4: SIGNIFICANT RESEARCH/PRODUCT — paper with empirical result, major product launch. **Always 4 minimum** for any Claude Code release or feature update (Web & mobile, slash commands, skills, agents, plugins, connectors, performance improvements, etc.).
   - 3: NOTABLE UPDATE — feature release, policy/regulatory, expert deep-dive.
   - 2: INCREMENTAL — small feature tweak, single observation.
   - 1: LOW-SIGNAL — greeting, meme, reply fragment.

   **Category cap — 商业动态**: defaults to ≤2 (合作/投资/收购/融资/财报/人事变动 etc.). Only rate 3+ when the deal represents a structural industry shift — e.g. a multi-billion-dollar strategic compute/equity deal between top-tier players (Anthropic↔Amazon/Google, OpenAI↔Microsoft tier), a major-lab acquisition, or a regulatory action that visibly reshapes the AI landscape. Routine partnerships, customer wins, smaller funding rounds, and exec moves stay at ≤2.
5. tags — 3-5 Chinese keywords (array).
6. practice_suggestions — 1-3 concrete actionable Chinese suggestions, ONLY if `category ∈ {模型发布, 产品与功能}`. Omit otherwise.

Also carry through two fields UNMODIFIED from the fetch-cache article (do NOT recompute): `thread_group_id`, `duplicate_of`. They are already authoritative.

Write a single JSON file to `data/analysis-cache/{date}.chunk-{i}.json` with shape:

Emit STRICT JSON. If a Chinese summary needs to quote an English term, use corner quotes `「...」` instead of ASCII `"..."` — an unescaped ASCII quote inside a string breaks the whole chunk file.

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

When all first-pass subagent calls return, validate every chunk:

- Read `data/analysis-cache/{date}.chunk-{i}.json`.
- A chunk needs retry if the file is missing, `JSON.parse` throws, any requested URL is absent, or any returned article fails the required-field checks below. Do NOT attempt a rescue parse.
- Required fields are: `url`, `source`, `title` (non-empty string), `summary` (non-empty string), `category` (string), `importance` (integer 1-5), and `tags` (array).

Retry every failed chunk **once in the same run**, again in waves of at most 3 subagents, using the original input articles and the same strict-JSON prompt. Re-read and revalidate the replacement files. After that retry:

- Append valid articles to the master list exactly once per URL.
- Drop any still-invalid or missing article and log its URL plus reason to stderr. Do not write malformed data merely to make the count match.
- Report all still-failed chunks in the final status. They remain absent from the committed analysis-cache, so the later same-date retry or repair automation can collect them from fetch-cache and try again.

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
- **Multiple distinct updates to the same specific product on the same day cluster together too**, even when each update covers a different aspect. Example: a Claude Code feature launch (Web/mobile + --teleport) AND a same-day Claude Code v2.1.116 incident fix → one Claude Code cluster. The synthesized title should highlight the most important update first (here the launch), with the secondary updates surfaced as separate angles in 多角度报道.

Do **NOT** cluster merely on shared broad topics ("AI", "models", "OpenAI products", "agentic coding"). The bar is "same specific product/event/paper". A specific product means a named tool or model (Claude Code, Codex, GPT-5.5, Qwen-Image-2.0-Pro). It does NOT mean a company (Anthropic, OpenAI) or a category ("models", "agents") — those are too broad to cluster by.

For each cluster of 2+ articles:
1. Pick the canonical article in this priority order: primary-source blog (OpenAI Blog, Google AI Blog, Anthropic Blog, Anthropic Research, The Batch, Berkeley RDI) > primary-source first-party Twitter (OpenAI, Anthropic, Google DeepMind, Claude, Claude Devs, OpenAI Devs, Meta AI, Mistral AI, xAI, DeepSeek, Qwen) > aggregator Twitter (Sam Altman, Dario Amodei, Demis Hassabis, Andrej Karpathy, Thariq, 宝玉的分享). Within the same priority tier: for **single-event clusters** (one event covered from multiple angles) prefer the earliest-published article (the lead announcement). For **multi-update product clusters** (different feature updates / fixes / partnerships for the same product on one day), prefer the article covering the **most important** update — the new product capability beats a small bug fix beats a single-handle deployment news.
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
  "analyzed_at": "{ISO 8601 timestamp}",
  "fetch_cache_ref": "data/fetch-cache/{date}.json",
  "trend_paragraph": "...",
  "articles": [ ...final_articles ]
}
```

### Step 10: Cleanup and commit

Delete all `data/analysis-cache/{date}.chunk-*.json` scratch files.

```bash
git add data/analysis-cache/{date}.json
if git diff --cached --quiet; then
  echo "nothing to commit — skipping"
  exit 0
fi
git commit -m "chore(catchup): daily analysis {date}"
git fetch origin main
git rebase origin/main
git push origin HEAD:main
```

The `HEAD:main` form is required. The Codex automation sandbox checks out an auto-named working branch (e.g. `codex/xxx` or `main-xxxx`), so a bare `git push` lands the commit on that working branch — and downstream `build-report.yml` only triggers on pushes to `main`, so anything off-`main` is invisible to the pipeline. The `fetch` + `rebase` absorbs the case where the GH Actions fetcher pushed `data/fetch-cache/{date}.json` to `main` after the automation sandbox was prepared.

Apply the Step 0 elevated-permission retry rule to `git commit`, `git fetch`, `git rebase`, and `git push` here as well. If the post-commit rebase hits content conflicts, run `git rebase --abort` before exiting; keep the local analysis commit intact and report its hash so the next retry can recover it. Never leave the shared checkout mid-rebase.
