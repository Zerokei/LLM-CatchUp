# Design: Email push for generated reports

**Status:** approved, pending implementation
**Author:** Claude (Opus 4.6)
**Date:** 2026-04-14

## Problem

Reports land as markdown in `reports/{daily,weekly,monthly}/YYYY-*.md` but the user has to open GitHub to read them. For a product that's supposed to be a daily-habit feed, "must browse to a repo" is a real friction tax. Users want the completed report delivered to inbox — read on phone, archive by date, skim in spare moments.

## Non-goals

- Subscription management (single fixed recipient — no signup/unsubscribe flow).
- Custom email templates per cadence (one CSS covers all three).
- Retry logic on send failure (GH Actions surfaces workflow failures natively; manual re-run is the recovery path).
- Image attachments or embedded media (reports contain none).
- A pluggable transport abstraction (Resend is the only target; swap is a 5-line code change if ever needed).

## Architecture

Send happens **downstream of the cloud trigger, as a separate GitHub Actions workflow** — not inside any trigger prompt. This keeps the three trigger prompts untouched and puts the email send in a standard Node environment with easy secret management.

Flow:

1. Cloud trigger generates `reports/<cadence>/<date>.md` and commits + pushes (unchanged behavior).
2. New GH Actions workflow `.github/workflows/email-reports.yml` is triggered `on.push` for paths under `reports/{daily,weekly,monthly}/**`.
3. Workflow computes which report file(s) this push introduced (via `git diff --name-only HEAD~1 HEAD`) and loops over them.
4. For each file, `node scripts/email-reports.js <path>` reads the markdown, renders to HTML with inline CSS, and sends via the Resend API.
5. One email = one report (per the user's scope decision). If a push adds both a daily and a monthly report (e.g., end of month), two emails go out.

## Components

### New files
- `scripts/email-reports.js` — single-file CLI that takes one report path as its argument, reads the markdown, renders to HTML, and sends. ~80 lines.
- `.github/workflows/email-reports.yml` — push-triggered + `workflow_dispatch`-enabled GH Actions workflow. ~40 lines.

### Modified files
- `package.json` — add dev deps `marked` (markdown → HTML) and `resend` (Resend SDK).
- `pnpm-lock.yaml` — lockfile regeneration (machine-written).

### CLI contract: `scripts/email-reports.js`

```
Usage: node scripts/email-reports.js <path-to-report.md>

Environment:
  RESEND_API_KEY   required — Resend API key
  RESEND_TO        required — recipient email address
  RESEND_FROM      optional — override sender; defaults to onboarding@resend.dev

Exits 0 on successful send, 1 on any error (malformed path, missing env, render error, API error).
```

Subject derivation (by path matching):
- `reports/daily/YYYY-MM-DD.md`   → `CatchUp 日报 YYYY-MM-DD`
- `reports/weekly/YYYY-WNN.md`    → `CatchUp 周报 YYYY-WNN`
- `reports/monthly/YYYY-MM.md`    → `CatchUp 月报 YYYY-MM`

Body: `<html><body><style>…inline CSS…</style>{marked(md)}</body></html>`. CSS covers: system-ui/Hei font stack (CJK friendly), `line-height: 1.6`, `max-width: 720px` centered, monospace+gray-bg code blocks, border-collapse tables with 1px borders, descending h1–h4 sizing. Kept in a single string constant in the script, not a separate file.

### Workflow: `.github/workflows/email-reports.yml`

```yaml
name: Email Reports
on:
  push:
    branches: [main]
    paths:
      - 'reports/daily/**'
      - 'reports/weekly/**'
      - 'reports/monthly/**'
  workflow_dispatch:
    inputs:
      report_path:
        description: 'Exact report path to send (e.g., reports/daily/2026-04-14.md)'
        required: false
        type: string
      backfill_days:
        description: 'Send all reports whose filename-embedded date is within the last N days (inclusive)'
        required: false
        type: number
        default: 0
```

Job steps:
1. Checkout with `fetch-depth: 2` (need `HEAD~1` for the diff).
2. Setup pnpm + Node (matching `daily-fetch.yml`).
3. Install deps.
4. Compute `TARGETS` (list of report paths to send) based on trigger:
   - `on.push`: `git diff --name-only HEAD~1 HEAD -- 'reports/**/*.md'`
   - `workflow_dispatch` with `report_path` set: that single path
   - `workflow_dispatch` with `backfill_days > 0`: find all `reports/**/*.md` whose filename-embedded date is within N days of today (Asia/Shanghai). Daily matches `YYYY-MM-DD`, weekly matches `YYYY-WNN` (converted to the Monday of that ISO week), monthly matches `YYYY-MM` (first of month). Excludes nothing — a `backfill_days=7` run on 2026-04-14 picks up the last 7 daily reports plus any weekly/monthly whose anchor date falls in that window.
   - `workflow_dispatch` with both empty: fail with a clear error message.
5. Loop: `for path in TARGETS; do node scripts/email-reports.js "$path"; done`.
6. No commit — this workflow is purely outbound.

### Backfill semantics (detail)

`backfill_days` parses filename dates and includes each cadence when its representative date falls in the window `[today - N days, today]` inclusive (Asia/Shanghai). Rationale: simpler and deterministic compared to using git mtime, and it handles the case where you first install the workflow today and want to backfill the last week of reports.

Concrete: on `2026-04-14` with `backfill_days=7`:
- Daily: `reports/daily/2026-04-08.md` through `reports/daily/2026-04-14.md` (if they exist)
- Weekly: `reports/weekly/2026-W15.md` (Monday 2026-04-06, within window)
- Monthly: `reports/monthly/2026-04.md` (first of month 2026-04-01, **outside** 7-day window → not included unless `backfill_days >= 14`)

### Secrets

Two GitHub Actions repository secrets:
- `RESEND_API_KEY` — obtained from resend.com after signup
- `RESEND_TO` — the user's personal email address

No committed config — everything environment-driven. `RESEND_FROM` not set initially → script uses `onboarding@resend.dev` default.

## Data flow

```
cloud trigger (unchanged)
  └─→ git push → origin/main
        └─→ GH Actions: email-reports.yml
              └─→ git diff identifies new report files
                    └─→ node scripts/email-reports.js <path>
                          └─→ read file, marked() → HTML
                                └─→ Resend.emails.send({from, to, subject, html})
                                      └─→ email delivered to RESEND_TO inbox
```

## Error handling

- Missing env var → script exits 1 with a named error. GH Actions run turns red; default workflow-failure notification emails the repo owner.
- `marked` error (shouldn't happen with well-formed markdown) → exits 1.
- Resend API error (rate limit, auth, bad recipient) → exits 1 with the Resend error message surfaced to the log.
- No retry. Manual recovery via `workflow_dispatch` with the specific `report_path`.

## Verification

After implementation:
1. `pnpm install` succeeds with the two new deps.
2. Local dry-run: `RESEND_API_KEY=<test> RESEND_TO=<test> node scripts/email-reports.js reports/daily/2026-04-14.md` — with a real test key, an email arrives with correct subject, rendered HTML, and no broken styling in Gmail + Apple Mail.
3. After push + secrets set: a routine daily-fetch / daily-trigger run should, after the trigger's commit lands, kick off the email-reports workflow and deliver a real report email.
4. `gh workflow run email-reports.yml -f report_path=reports/daily/<recent-date>.md` manually resends a specific report — inbox confirms.
5. `gh workflow run email-reports.yml -f backfill_days=7` — inbox receives ~7-8 emails (7 daily + 0-1 weekly).

## Rollout

- Single PR / commit block for new files + package.json update.
- Secrets must be set in GH Actions before the workflow can do anything useful — document in the PR description.
- First "real" email happens on the next cloud trigger run (daily 08:00 Shanghai).
- Reversible: delete the workflow file + revert the package.json bump. The rest of the system is untouched.
