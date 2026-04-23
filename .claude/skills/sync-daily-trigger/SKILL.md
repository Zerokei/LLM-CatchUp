---
name: sync-daily-trigger
description: Use when docs/prompts/daily-trigger.md has been edited and the live CatchUp daily RemoteTrigger needs to match. The prompt embedded in the cloud trigger is an independent copy — edits to the repo file only take effect after pushing through the RemoteTrigger update API. Use this to push.
disable-model-invocation: true
---

# sync-daily-trigger

Pushes the current `docs/prompts/daily-trigger.md` content to the live CatchUp daily RemoteTrigger. Call after any edit to that file.

## Why this skill exists

The cloud scheduled trigger holds its own copy of the prompt, baked in at trigger-create time. Editing the repo file keeps `CLAUDE.md`'s claim that `docs/prompts/` is "source of truth" honest, but **the running trigger doesn't re-read from git** — it uses the embedded copy. The weekly and monthly triggers have the same property (separate skill if you need those too).

**Prompt shape (as of 2026-04-22):** the daily prompt is now "analysis-only" — it produces `data/analysis-cache/{date}.json` and exits. A separate GH Actions workflow (`build-report.yml`) renders the final markdown report and updates history/health. If you're reading the prompt and it looks much shorter than the weekly/monthly ones, that's intentional — don't restore the removed steps.

## Procedure

### 1. List triggers to find the daily one

Use the `RemoteTrigger` tool (fetch schema via `ToolSearch select:RemoteTrigger` first). Call `{action: "list"}` and find the trigger with `name` matching "LLM-CatchUp Daily Report".

Record:
- `id` (e.g. `trig_01DXDCksKqHGvnWTm9Ycb4rj`) — needed for the update call
- `job_config.ccr.environment_id` — preserve on update
- `job_config.ccr.events[0].data.uuid` — preserve the same UUID (don't regenerate)
- `job_config.ccr.session_context` — preserve as-is

Do NOT hardcode the trigger ID in this skill — the user may re-create the trigger and the ID will change.

### 2. Read the local prompt

```bash
cat docs/prompts/daily-trigger.md
```

Keep the full content as a single string (preserve all newlines, code blocks, Chinese text).

### 3. Call RemoteTrigger update

```
RemoteTrigger {
  action: "update",
  trigger_id: "<id from step 1>",
  body: {
    job_config: {
      ccr: {
        environment_id: "<preserved from step 1>",
        events: [{
          data: {
            uuid: "<preserved from step 1>",
            session_id: "",
            type: "user",
            parent_tool_use_id: null,
            message: { role: "user", content: "<full prompt text from step 2>" }
          }
        }],
        session_context: <preserved from step 1>
      }
    }
  }
}
```

### 4. Verify the response

- HTTP 200 means update accepted.
- Inspect the echoed `events[0].data.message.content` — it should start with `# CatchUp Daily Trigger Prompt` and include any new terms you introduced (e.g., `degraded_stale`, `max_silence_hours`, the current `window_hours` wording).
- If the echo looks identical to the OLD prompt, the update silently failed — re-check the body shape.

### 5. Report

Print a diff-style summary to the user: "Synced daily-trigger.md (N lines, M chars) to trigger <id>. Next run at <next_run_at from response>."

## Common pitfalls

- **Regenerating the UUID**: the event uuid identifies the trigger's message across API calls. Don't generate a fresh one on update — reuse the existing one from the list response.
- **Dropping `session_context`**: the update is a partial merge on `job_config`, but in practice it's safer to echo the whole `ccr` object back. Missing `session_context` may reset allowed_tools or the git source to defaults.
- **Escaping content**: the prompt contains backticks, triple-backticks, Chinese text, and special chars. Pass it as a JSON string — the JSON encoder handles escaping; do NOT pre-escape manually.
- **Weekly/monthly triggers drift the same way**: this skill only syncs daily. If you edit `weekly-trigger.md` or `monthly-trigger.md`, you'll need to sync those separately (same procedure, different trigger name).
