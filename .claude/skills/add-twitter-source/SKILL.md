---
name: add-twitter-source
description: Use when adding a new Twitter/X account as a CatchUp source. Resolves the account's stable numeric user ID via socialdata.tools, writes the route file that calls the shared `makeTwitterRoute` helper, wires it into the routes registry, adds a config.yaml entry with an appropriate staleness threshold, and smoke-tests.
disable-model-invocation: true
---

# add-twitter-source

Adds a new Twitter/X handle to CatchUp. Takes an argument: the handle, with or without the leading `@` (e.g. `AnthropicAI`, `@sama`).

## Why this skill exists

All Twitter sources share the same `makeTwitterRoute` helper in `scripts/lib/socialdata-twitter.js` which calls the socialdata.tools REST API. The route file must declare both the screen-name `handle` (for display and URL) and the stable numeric `userId` (socialdata's tweets endpoint is keyed by ID, and a handle rename wouldn't change the ID). The ID lookup is a one-time call that should happen during this skill — cheaper than resolving on every fetch.

## Procedure

### 1. Normalize the handle

Strip a leading `@` if present. **Preserve the exact case** of the handle — it appears in URLs that are user-facing. Use lowercase only for the route filename slug. Example: input `@AnthropicAI` → handle `AnthropicAI`, slug `anthropic`. For multi-word handles like `OpenAIDevs`, pick a short kebab slug (`openai-devs`).

### 2. Resolve the numeric userId

```bash
curl -s -H "Authorization: Bearer $SOCIALDATA_API_KEY" \
  "https://api.socialdata.tools/twitter/user/<HANDLE>" | \
  python3 -c "import json,sys; d=json.load(sys.stdin); print(d['id_str'])"
```

Record the `id_str` (a numeric string). Abort if the response is a 404 HTML page — the handle may be wrong or the account may have been suspended/renamed.

### 3. Verify the feed works

Before writing any files, smoke-test the route:

```bash
SOCIALDATA_API_KEY=<key> node -e "
const { makeTwitterRoute } = require('./scripts/lib/socialdata-twitter');
const r = makeTwitterRoute({ name: 'test', handle: '<HANDLE>', userId: '<ID>' });
r.fetch().then(res => {
  if (res.error) return console.log('ERR:', res.error);
  console.log('items:', res.articles.length);
  res.articles.slice(0,3).forEach(a => console.log('  ' + a.published_at + ' | ' + a.title.slice(0,60)));
});
"
```

Abort if the feed is empty or errors.

### 4. Decide the source config

- **role**: `primary` for official org accounts (e.g. @OpenAI, @AnthropicAI, @GoogleDeepMind). `aggregator` for individuals / personalities (e.g. @sama, @karpathy).
- **max_silence_hours** — based on tweet cadence observed in step 3:
  - Multiple per day → `168` (7d)
  - Several per week → `336` (14d)
  - Monthly or rarer → `720` (30d)
  - Very rare (like DeepSeek) → `8760` (1 year)
  - Unknown / brand-new → default `336`

### 5. Create the route file

Write `scripts/routes/twitter-<slug>.js`:

```js
const { makeTwitterRoute } = require('../lib/socialdata-twitter');

module.exports = makeTwitterRoute({
  name: '<Display Name> (Twitter)',
  handle: '<HANDLE>',
  userId: '<ID>',
});
```

`<Display Name>` should match how you'd refer to them in a report — e.g. `Anthropic`, `Sam Altman`, `Andrej Karpathy`.

### 6. Wire into the routes registry

Edit `scripts/routes/index.js`. Add `require('./twitter-<slug>'),` in the Twitter block (after blog-like sources, grouped with other Twitter routes).

### 7. Add the config.yaml entry

Add after a nearby Twitter source, preserving the grouping order:

```yaml
  - name: "<Display Name> (Twitter)"
    type: rss
    url: "https://x.com/<HANDLE>"
    role: <primary|aggregator>
    max_silence_hours: <168|336|720|8760>
```

The `url` field is documentation-only (not used for fetching); point it to the human-readable X.com profile.

### 8. Final smoke test

```bash
SOCIALDATA_API_KEY=<key> node -e "
const r = require('./scripts/routes/twitter-<slug>');
r.fetch().then(res => {
  if (res.error) { console.log('ERR:', res.error); return; }
  console.log('name:', r.name, 'count:', res.articles.length);
  res.articles.slice(0,2).forEach(a => console.log('  ' + a.published_at + ' | ' + a.title.slice(0,70)));
});
"
```

### 9. Report back

Summarize to the user: name, role, silence threshold, count of items in feed, date of newest item. Do NOT commit — let the user review and commit.

## Common pitfalls

- **Forgetting the registry edit**: if you skip `scripts/routes/index.js`, the fetch script silently excludes the source (the `routeByName` lookup returns undefined and the source falls into the "no route module found" error branch).
- **Handle collision**: `@claude` vs `@claudeai` vs `@AnthropicAI` are distinct accounts. Always verify the `user.name` returned by step 2 matches the expected account before wiring up.
- **Missing `SOCIALDATA_API_KEY` in local dev**: without the env var, the helper returns `{ error: 'SOCIALDATA_API_KEY not set' }`. Export it before running any smoke test locally.
- **Handle rename**: a user can change their Twitter handle without changing their numeric ID. The route file's `userId` stays stable; only `handle` (display/URL field) would need updating if the account renames.
