# Superpowers Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the design in `docs/superpowers/specs/2026-04-14-superpowers-integration-design.md` — refresh CLAUDE.md with today's new project facts and expand the superpowers skill allowlist in `.claude/settings.local.json`.

**Architecture:** Two files modified, one commit. Each task is a narrow edit with an explicit old/new string and a grep-based verification. No tests to write — this is pure documentation + configuration — so the TDD steps collapse to "edit, verify string present, move on." Final task runs all the verification checks at once and commits.

**Tech Stack:** Markdown (CLAUDE.md), JSON (settings.local.json), shell (`grep`, `jq`) for verification.

---

## File Structure

- Modify: `CLAUDE.md` (4 sections rewritten, 1 new section appended)
- Modify: `.claude/settings.local.json` (8 entries inserted into `permissions.allow`)

No files created. No deletions.

---

### Task 1: Update CLAUDE.md "How It Works" section

**Files:**
- Modify: `/Users/kevin/Projects/LLM-CatchUp/CLAUDE.md:5-12`

The current text describes a single-agent architecture where the trigger itself fetches via WebFetch. That hasn't been accurate since the fetch-sources.js migration. Rewrite to describe the two-half architecture (CI fetcher + cloud-trigger reporter).

- [ ] **Step 1: Apply the edit**

Use the Edit tool on `/Users/kevin/Projects/LLM-CatchUp/CLAUDE.md`.

**old_string:**

```
## How It Works

This repo IS the entire system. There is no application code. Cloud Scheduled Triggers run prompts that instruct Claude to:
1. Fetch sources listed in `config.yaml` using WebFetch
2. Analyze articles (summarize, categorize, score importance, suggest practice)
3. Generate markdown reports in `reports/`
4. Persist state to `data/history.json` and `data/health.json`
5. Commit and push
```

**new_string:**

```
## How It Works

This repo has two runtime halves:

**Fetcher half** — `scripts/fetch-sources.js` runs in a daily GitHub Actions workflow (cron `37 23 * * *` UTC = 07:37 Asia/Shanghai). It reads `config.yaml`, fetches each source using route modules under `scripts/routes/`, filters each source's articles to a 30h window (slight overlap covers cron drift), and writes the snapshot to `data/fetch-cache/{YYYY-MM-DD}.json`.

**Reporter half** — Claude Code Cloud Scheduled Triggers run daily / weekly / monthly. The daily trigger reads the pre-built fetch-cache snapshot (it does NOT fetch external URLs), analyzes articles, generates a markdown report in `reports/`, updates `data/history.json` and `data/health.json`, and commits/pushes.
```

- [ ] **Step 2: Verify**

Run: `grep -c "scripts/fetch-sources.js" /Users/kevin/Projects/LLM-CatchUp/CLAUDE.md`
Expected: `≥ 1`

Run: `grep -c "fetch-cache" /Users/kevin/Projects/LLM-CatchUp/CLAUDE.md`
Expected: `≥ 1`

---

### Task 2: Update CLAUDE.md "Key Files" section

**Files:**
- Modify: `/Users/kevin/Projects/LLM-CatchUp/CLAUDE.md:14-23`

Add `scripts/fetch-sources.js`, `scripts/routes/`, `data/fetch-cache/`, `.claude/skills/`, `.claude/agents/` to the Key Files enumeration. Annotate `config.yaml` with the `max_silence_hours` field reference. Note the cloud-trigger sync caveat on `docs/prompts/`.

- [ ] **Step 1: Apply the edit**

Use the Edit tool on `/Users/kevin/Projects/LLM-CatchUp/CLAUDE.md`.

**old_string:**

```
## Key Files

- `config.yaml` — all configuration (sources, categories, analysis dimensions, alerting)
- `data/history.json` — article records keyed by SHA-256 of URL, used for deduplication and report aggregation
- `data/health.json` — per-source health status (healthy / degraded / alert)
- `reports/daily/YYYY-MM-DD.md` — daily reports
- `reports/weekly/YYYY-WNN.md` — weekly reports
- `reports/monthly/YYYY-MM.md` — monthly reports
- `docs/prompts/` — version-controlled trigger prompts (source of truth for trigger configuration)
- `docs/report-examples/` — reference format for each report type
```

**new_string:**

```
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
```

- [ ] **Step 2: Verify**

Run: `grep -c "max_silence_hours" /Users/kevin/Projects/LLM-CatchUp/CLAUDE.md`
Expected: `≥ 1`

Run: `grep -c ".claude/skills/" /Users/kevin/Projects/LLM-CatchUp/CLAUDE.md`
Expected: `≥ 1`

Run: `grep -c ".claude/agents/" /Users/kevin/Projects/LLM-CatchUp/CLAUDE.md`
Expected: `≥ 1`

---

### Task 3: Update CLAUDE.md "Fetching" subsection

**Files:**
- Modify: `/Users/kevin/Projects/LLM-CatchUp/CLAUDE.md:27-35`

Replace the WebFetch-assuming guidance with the snapshot-based contract. Explicitly forbid fallback fetches. Document the 30h window and its rationale. Describe the three source statuses the trigger will see.

- [ ] **Step 1: Apply the edit**

Use the Edit tool on `/Users/kevin/Projects/LLM-CatchUp/CLAUDE.md`.

**old_string:**

```
### Fetching
- Read `config.yaml` for the source list
- For `type: rss` sources: WebFetch the URL, parse the XML to extract article entries
- For `type: web_scraper` sources: WebFetch the URL, extract article titles/links/content from HTML
- For newsletter-style sources that cover multiple topics in one article, split into separate entries (each independently categorized and analyzed, sharing the source URL with `#topic-N` suffix)
- Only process articles not already in `data/history.json` (dedup by SHA-256 hash of article URL)
- Fetch `role: primary` sources before `role: aggregator` sources, so primary content enters history first
- After fetching all sources, perform semantic dedup in two rounds: (1) compare new articles against recent history.json entries (past 14 days) — if a topic was already covered, update the existing entry's `also_covered_by` instead of creating a duplicate; (2) compare new articles against each other — keep `primary` source version over `aggregator`. Sources have `role: primary` (official blogs) or `role: aggregator` (newsletters/roundups)
- If a source fails, log the error in `data/health.json` and continue with other sources
```

**new_string:**

```
### Fetching

Fetching itself is done by `scripts/fetch-sources.js` in GH Actions, not by the trigger. The trigger only reads `data/fetch-cache/{YYYY-MM-DD}.json` (Asia/Shanghai date). If the snapshot is missing, abort — do NOT attempt WebFetch or fabricate content; a missing cache means the upstream fetch script needs human attention.

The fetch window is **30h** (not 24h): daily runs don't fire at exactly the same wall-clock time due to GH Actions queue drift. 6h of overlap between consecutive runs guarantees no article falls through the gap; dedup-by-URL-hash in `data/history.json` absorbs the duplicates.

For each source entry in the snapshot:
- If `status === "ok"` or `status === "degraded_stale"`: iterate `articles[]` (already pre-filtered to the 30h window). Skip any whose SHA-256 URL hash is already in `data/history.json`. Collect the rest for analysis.
- If `status === "error"`: skip for content, note the error for Health Monitoring.

For newsletter-style sources (Berkeley RDI, The Batch) whose articles bundle multiple topics, split into separate entries — append `#topic-N` to the URL, each entry independently categorized.

After collecting across sources, perform two rounds of semantic dedup: (1) compare new articles against the past 14 days in `history.json` — if a topic was already covered, update the existing entry's `extras.also_covered_by` list instead of creating a duplicate; (2) compare new articles against each other — keep `primary` (official blogs, first-party Twitter) over `aggregator` (newsletters, roundups, personal accounts).
```

- [ ] **Step 2: Verify**

Run: `grep -c "30h" /Users/kevin/Projects/LLM-CatchUp/CLAUDE.md`
Expected: `≥ 1`

Run: `grep -c "degraded_stale" /Users/kevin/Projects/LLM-CatchUp/CLAUDE.md`
Expected: `≥ 1`

---

### Task 4: Update CLAUDE.md "Health Monitoring" subsection

**Files:**
- Modify: `/Users/kevin/Projects/LLM-CatchUp/CLAUDE.md:48-55`

Rewrite to explain the three statuses the snapshot now produces (`ok`, `degraded_stale`, `error`), how each maps to health.json transitions, and detail the alert-opening procedure (moved from vague "create with diagnosis" to a concrete `gh issue create` template).

- [ ] **Step 1: Apply the edit**

Use the Edit tool on `/Users/kevin/Projects/LLM-CatchUp/CLAUDE.md`.

**old_string:**

```
### Health Monitoring
- After fetching, update `data/health.json` for every source
- Success: set status to "healthy", reset consecutive_failures to 0
- Failure: increment consecutive_failures, set appropriate status
- If consecutive_failures >= threshold from `config.yaml` `alerting.consecutive_failure_threshold`:
  - Check if an open GitHub Issue with label `source-alert` already exists for this source
  - If not, create one with diagnosis and suggestions
- If a previously alerting source recovers, close the corresponding Issue
```

**new_string:**

```
### Health Monitoring

The fetch-cache produces one of three statuses per source:
- `ok` — HTTP succeeded, newest item within the source's `max_silence_hours` threshold (or no threshold declared).
- `degraded_stale` — HTTP succeeded, but either the newest item is older than `max_silence_hours` OR the fetch returned zero items with a threshold set. Indicates an upstream freeze (e.g., a Twitter-to-RSS mirror no longer syncing, or an empty feed). Distinct from `error` because the fetcher did not throw.
- `error` — HTTP error, parse failure, or route logic error. Message in the `error` field.

For each source, update `data/health.json`:
- `ok` → status "healthy", reset `consecutive_failures` to 0.
- `degraded_stale` or `error` → increment `consecutive_failures`, copy the `error` field into `last_error`. If `consecutive_failures` < `alerting.consecutive_failure_threshold` from config: status "degraded". If >= threshold: status "alert" (see alert handling below).

For each source with status `"alert"`:
1. Check `gh issue list --label source-alert --state open` for an existing open issue.
2. If none exists, open one with `gh issue create --title "CatchUp: [Source Name] 连续失败" --label source-alert --body "<diagnosis>"`. Body should include source name, URL, error type, consecutive_failure count, diagnosis, and fix suggestions.

For each previously-alerting source that is now healthy, close its open issue with a recovery comment.
```

- [ ] **Step 2: Verify**

Run: `grep -c "three statuses" /Users/kevin/Projects/LLM-CatchUp/CLAUDE.md`
Expected: `≥ 1`

---

### Task 5: Append "External dependencies" section to CLAUDE.md

**Files:**
- Modify: `/Users/kevin/Projects/LLM-CatchUp/CLAUDE.md` (append after the last section)

Add a short new top-level section naming `api.xgo.ing` and `r.jina.ai` as external deps, with the rationale for why we route through them. Goes after "### Committing" at the end of the file.

- [ ] **Step 1: Apply the edit**

Use the Edit tool on `/Users/kevin/Projects/LLM-CatchUp/CLAUDE.md`.

**old_string:**

```
### Committing
- Stage all changed files: `data/history.json`, `data/health.json`, new report files
- Commit with message: `chore(catchup): daily report YYYY-MM-DD` (or weekly/monthly)
- Push to the repository
```

**new_string:**

```
### Committing
- Stage all changed files: `data/history.json`, `data/health.json`, new report files
- Commit with message: `chore(catchup): daily report YYYY-MM-DD` (or weekly/monthly)
- Push to the repository

## External dependencies

The fetcher depends on two external services outside the sources themselves:

- **`api.xgo.ing`** — Twitter-to-RSS mirror used for all `*(Twitter)` sources. Looks up tweets by opaque UUID (one per handle); the UUIDs are sourced from the public [BestBlogs OPML](https://github.com/ginobefun/BestBlogs). When the mirror freezes (all same-tier handles go quiet simultaneously), the `max_silence_hours` staleness check catches it as `degraded_stale`.
- **`r.jina.ai`** — reader proxy used by `scripts/routes/berkeley-rdi.js` to route around Cloudflare IP gates on `berkeleyrdi.substack.com`. Substack blocks Azure / GH-Actions IPs even with browser-like headers; jina fetches from its own origin. Single point of failure; if jina breaks, Berkeley RDI will `error` and the existing alert pipeline surfaces it after 3 consecutive days.
```

- [ ] **Step 2: Verify**

Run: `grep -c "r.jina.ai" /Users/kevin/Projects/LLM-CatchUp/CLAUDE.md`
Expected: `≥ 1`

Run: `grep -c "api.xgo.ing" /Users/kevin/Projects/LLM-CatchUp/CLAUDE.md`
Expected: `≥ 1`

Run: `grep -c "^## External dependencies" /Users/kevin/Projects/LLM-CatchUp/CLAUDE.md`
Expected: `1`

---

### Task 6: Add superpowers Skill allowlist to settings.local.json

**Files:**
- Modify: `/Users/kevin/Projects/LLM-CatchUp/.claude/settings.local.json`

Insert 8 `Skill(superpowers:*)` entries alphabetically between `Skill(update-config)` and the `Bash(gh …)` block. Matches the `payloadcms/payload` reference pattern, minus `using-git-worktrees` (has open reliability bugs in the plugin — `obra/superpowers#1108`, `#1091`).

- [ ] **Step 1: Apply the edit**

Use the Edit tool on `/Users/kevin/Projects/LLM-CatchUp/.claude/settings.local.json`.

**old_string:**

```
      "Skill(schedule)",
      "Skill(update-config)",
      "Bash(gh workflow:*)",
```

**new_string:**

```
      "Skill(schedule)",
      "Skill(update-config)",
      "Skill(superpowers:brainstorming)",
      "Skill(superpowers:executing-plans)",
      "Skill(superpowers:requesting-code-review)",
      "Skill(superpowers:subagent-driven-development)",
      "Skill(superpowers:systematic-debugging)",
      "Skill(superpowers:verification-before-completion)",
      "Skill(superpowers:writing-plans)",
      "Skill(superpowers:writing-skills)",
      "Bash(gh workflow:*)",
```

- [ ] **Step 2: Verify**

Run: `jq -r '.permissions.allow[] | select(startswith("Skill(superpowers:"))' /Users/kevin/Projects/LLM-CatchUp/.claude/settings.local.json | wc -l`
Expected: `8`

Run: `jq '.' /Users/kevin/Projects/LLM-CatchUp/.claude/settings.local.json > /dev/null && echo ok`
Expected: `ok` (JSON is still valid after the edit)

---

### Task 7: Run the full verification battery

**Files:** none modified — this is a verification gate before commit.

Run every grep/jq check from the design spec, as a single copy-pasteable block, so any regressions from earlier tasks surface now instead of in the commit log.

- [ ] **Step 1: Run all verifications**

```bash
cd /Users/kevin/Projects/LLM-CatchUp

echo "== settings allowlist length =="
jq '.permissions.allow | length' .claude/settings.local.json

echo "== settings JSON validity =="
jq '.' .claude/settings.local.json > /dev/null && echo "ok"

echo "== CLAUDE.md key term counts =="
for term in degraded_stale max_silence_hours "30h" r.jina.ai api.xgo.ing fetch-cache; do
  count=$(grep -c "$term" CLAUDE.md)
  echo "  $term: $count"
done

echo "== CLAUDE.md new section header =="
grep -c "^## External dependencies" CLAUDE.md
```

Expected output:
- allowlist length: ≥ 10 more than before (8 new superpowers + whatever was there)
- JSON validity: `ok`
- All six grep counts ≥ 1
- `## External dependencies`: `1`

If any check fails, identify which task's edit didn't land, fix it, and re-run this battery before committing.

---

### Task 8: Commit and push

**Files:** none modified — finalization.

- [ ] **Step 1: Stage the two modified files**

```bash
cd /Users/kevin/Projects/LLM-CatchUp
git add CLAUDE.md .claude/settings.local.json
git status
```

Expected: 2 files staged (`CLAUDE.md`, `.claude/settings.local.json`). If other files are dirty, inspect them — they should not be in this commit.

- [ ] **Step 2: Commit with a message pointing at the spec**

```bash
git commit -m "$(cat <<'EOF'
docs(claude): refresh CLAUDE.md for today's new mechanisms + allowlist superpowers skills

CLAUDE.md changes (project facts only; no superpowers-trigger guidance
per community anti-pattern research):
- How It Works: describe the CI-fetcher / cloud-trigger two-half architecture
- Key Files: add scripts/fetch-sources.js, scripts/routes/, data/fetch-cache/,
  .claude/skills/, .claude/agents/; note max_silence_hours and trigger
  prompt drift on docs/prompts/
- Fetching: replace WebFetch-assuming text with the snapshot-read contract,
  30h window rationale, three status branches
- Health Monitoring: document ok / degraded_stale / error transitions and
  concrete gh issue create template
- External dependencies: new section naming api.xgo.ing and r.jina.ai

.claude/settings.local.json:
- allowlist 8 Skill(superpowers:*) entries to stop the permission prompts
  during routine work. Excludes using-git-worktrees (open plugin bugs per
  obra/superpowers#1108 and #1091).

Implements docs/superpowers/specs/2026-04-14-superpowers-integration-design.md.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: Push**

```bash
git push
```

Expected: push succeeds. If rejected (remote has new commits), `git pull --rebase` then re-push.

- [ ] **Step 4: Final sanity check**

```bash
git log --oneline -1
git show --stat HEAD
```

Expected: latest commit is the one you just created, touching exactly `CLAUDE.md` and `.claude/settings.local.json`.

---

## Self-review log

- [x] Every spec change has at least one task: `How It Works`→T1, `Key Files`→T2, `Fetching`→T3, `Health Monitoring`→T4, `External dependencies`→T5, Skill allowlist→T6, all 6 verification checks from spec→T7, commit→T8. ✓
- [x] No "TBD" / "TODO" / "fill in details" placeholders — every edit has literal old_string and new_string. ✓
- [x] Type consistency: no types or function names to track (doc/config edits only). ✓
- [x] No implementation step references a symbol defined elsewhere in the plan. ✓
- [x] Verification commands have exact paths and expected output strings. ✓
