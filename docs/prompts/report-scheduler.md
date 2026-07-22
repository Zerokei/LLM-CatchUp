# CatchUp Unified Report Scheduler

**Execute this scheduler now. Do NOT ask the user for confirmation, clarification, or instructions — this is one unattended heartbeat attached to the pinned `CatchUp Daily Report` task. Read and execute the referenced repo prompts; never paste or invent replacement workflows.**

Read `AGENTS.md` first. The automation invokes this file every day at 20:30 and 23:30 Asia/Shanghai. One heartbeat is used because Codex permits only one active heartbeat per task.

## Step 1: Determine the logical slot date

Use Asia/Shanghai time.

- If the current local time is from 19:00 through 22:29, treat this as the **primary slot**.
- Otherwise treat it as the **late slot**. This intentionally classifies a delayed 23:30 invocation that crosses midnight as late.
- For a late invocation occurring between 00:00 and 05:59, set `logical_slot_date` to the previous Asia/Shanghai calendar date. Otherwise use today's local date. Use this logical date for weekly/monthly due checks.

## Step 2: Run the daily analyzer

Execute `docs/prompts/daily-trigger.md` straight through for its normal America/Los_Angeles target date. The primary slot is the main attempt; the late slot is an idempotent same-date retry that resumes missing URLs or re-triggers the reporter.

If the daily workflow aborts only because fetch-cache is missing or an article chunk fails, record that result and continue with other due late-slot tasks. If the checkout cannot be synchronized safely or remains in an unsafe Git state, stop the entire scheduler rather than running later tasks against stale state.

If this is the primary slot, report the daily result and stop.

## Step 3: Run delayed daily repair (late slot only)

Execute `docs/prompts/backfill-trigger.md` straight through. It repairs at most one older date from committed fetch-cache and never competes with the normal target that the daily analyzer just handled.

## Step 4: Run the weekly report when due (late slot only)

If `logical_slot_date` is Tuesday or Wednesday, execute `docs/prompts/weekly-trigger.md` straight through. Tuesday is the main attempt; Wednesday is the idempotent retry. On all other weekdays, skip weekly without treating the skip as a failure.

## Step 5: Run the monthly report when due (late slot only)

If the day-of-month of `logical_slot_date` is 2 or 3, execute `docs/prompts/monthly-trigger.md` straight through. Day 2 is the main attempt; day 3 is the idempotent retry. On all other dates, skip monthly without treating the skip as a failure.

## Step 6: Combined status

Report one compact status covering:

- logical slot and date;
- daily target and analysis/report state;
- repair target or “none needed”;
- weekly target/result or “not due”;
- monthly target/result or “not due”;
- commits and pushes created by each executed workflow;
- any remaining fallback dates or failed chunks.

A preflight-driven weekly/monthly skip is not a successful publication: list the blocking dates explicitly so the next repair/retry can be traced.
