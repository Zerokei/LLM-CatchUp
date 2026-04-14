# Design: Minimal superpowers integration for LLM-CatchUp

**Status:** approved, pending implementation
**Author:** Claude (Opus 4.6)
**Date:** 2026-04-14

## Problem

Throughout the 2026-04-14 session, superpowers skills (`systematic-debugging`, `verification-before-completion`, `writing-plans`) that should have auto-fired during debugging and multi-step feature work did not fire. In parallel, a large amount of new repo behavior was introduced (`max_silence_hours`, `degraded_stale` status, 30h fetch window, `r.jina.ai` reader-proxy fallback, `.claude/skills/` and `.claude/agents/` directories) that CLAUDE.md does not reflect. A fresh session picking up this repo would be missing both the nudge to use the process skills and the project facts those skills would operate on.

## Research-grounded constraints

See the session log; the research agent scouted `obra/superpowers` consumers and surfaced:

1. Superpowers ships its own `SessionStart` hook via the `using-superpowers` skill. Consumer-side hooks are not needed to wake the plugin — the gap is model discipline, not wiring.
2. **CLAUDE.md should remain project-facts-only.** Duplicating the skill's own "Red Flags" / rationalization content into CLAUDE.md is a documented anti-pattern (`microsoft/spec-to-agents` does it; it drifts from upstream and burns tokens in every message).
3. The canonical consumer template (`payloadcms/payload`) shows the expected shape: `.claude/settings.json` with `Skill(superpowers:*)` allowlist entries, CLAUDE.md untouched by plugin-specific content.
4. `subagent-driven-development`'s review loop runs on every task regardless of size and costs ~10–15× the direct-implementation token cost for trivially mechanical work (obra/superpowers#1120). Relevant because a large fraction of this repo's changes are mechanical source-additions.

## Non-goals

- Re-typing the `using-superpowers` guidance into CLAUDE.md.
- Adding SessionStart / UserPromptSubmit / Stop hooks (the plugin handles this).
- Force-disabling any superpowers skill (no current need).
- Building a `catchup-brainstorm` compose skill (YAGNI: we've used `brainstorming` twice and the default spec location has been fine).

## Changes

### 1. `.claude/settings.local.json` — expand Skill allowlist

Add eight `Skill(superpowers:*)` entries so the most commonly used skills stop prompting for permission every run. Match the `payloadcms/payload` reference list verbatim, minus `using-git-worktrees` (issues #1108 / #1091 — pnpm is fine, but the skill has open reliability bugs).

Add:
- `Skill(superpowers:brainstorming)`
- `Skill(superpowers:writing-plans)`
- `Skill(superpowers:writing-skills)`
- `Skill(superpowers:executing-plans)`
- `Skill(superpowers:subagent-driven-development)`
- `Skill(superpowers:systematic-debugging)`
- `Skill(superpowers:requesting-code-review)`
- `Skill(superpowers:verification-before-completion)`

Place alphabetically after the existing `Skill(schedule)` / `Skill(update-config)` entries. No other file modifications.

### 2. `CLAUDE.md` — project-facts refresh

Add ONLY project-fact content. Target sections to update:

**Under "Key Files":**
- Document `data/fetch-cache/YYYY-MM-DD.json` (was never mentioned) — produced by `scripts/fetch-sources.js` in CI, consumed by the daily trigger.
- Add `.claude/skills/` — project-level slash-command skills (`/add-twitter-source`, `/sync-daily-trigger`).
- Add `.claude/agents/` — project-level subagents (`source-diagnoser`, `config-drift-auditor`).

**Under "Rules for Trigger Agents" → "Fetching":**
- Replace the current WebFetch-assuming text with: fetching is done by `scripts/fetch-sources.js` running in GH Actions daily at 07:37 Asia/Shanghai (cron `37 23 * * *` UTC). The cloud trigger reads the JSON snapshot at `data/fetch-cache/{YYYY-MM-DD}.json`. If the snapshot is missing, the trigger aborts instead of attempting a live fetch.
- Document the fetch window as **30h** (not 24h) and explain the overlap rationale.

**Under "Rules for Trigger Agents" → "Health Monitoring":**
- Add a new status: `degraded_stale`. Meaning: fetch HTTP-succeeded but newest item exceeds the source's declared `max_silence_hours` threshold (either a frozen mirror or an empty channel). Shares the accounting path with `status: "error"` — repeated staleness accrues `consecutive_failures` and triggers the same GitHub-issue alert at threshold.
- Reference `max_silence_hours` as a per-source field in `config.yaml`.

**Under a new short "External dependencies" note** (~4 lines):
- `r.jina.ai` is used by `scripts/routes/berkeley-rdi.js` to proxy around Cloudflare blocks on Azure / GH-Actions IPs. If jina goes down, the source errors cleanly and the existing alert pipeline notices.

**Do NOT add:**
- A "Working conventions" section listing which superpowers skill applies to which task. (Research finding: anti-pattern.)
- Any restatement of superpowers triggering rules. (Covered by the plugin's own SessionStart injection.)

Target total delta: ~30–40 lines added to CLAUDE.md, zero removed except the obsolete "Fetching: Read config.yaml, WebFetch sources..." language that's no longer accurate.

## Out of scope for this spec

- A `catchup-brainstorm` compose skill. Revisit when/if the spec-file location becomes inconvenient.
- Gating `subagent-driven-development` off for mechanical tasks. The two existing `.claude/skills/` routes (`add-twitter-source`, `sync-daily-trigger`) already bypass it by being user-invocable slash commands. If the skill becomes a nuisance during feature work, revisit with a CLAUDE.md note per the research's "compose or override" pattern.

## Verification

After changes:
1. `jq '.permissions.allow | length' .claude/settings.local.json` — count increases by 8.
2. `grep -c degraded_stale CLAUDE.md` ≥ 1.
3. `grep -c max_silence_hours CLAUDE.md` ≥ 1.
4. `grep -c "30h" CLAUDE.md` ≥ 1.
5. `grep -c r.jina.ai CLAUDE.md` ≥ 1.
6. New session loads CLAUDE.md + superpowers SessionStart injection cleanly (smoke-test by starting a fresh session; manual check).

## Rollout

Single commit. No migration. Reversible via `git revert`.
