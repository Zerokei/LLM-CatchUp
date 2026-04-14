---
name: add-twitter-source
description: Use when adding a new Twitter/X account as a CatchUp source. The procedure resolves the account's api.xgo.ing UUID from the BestBlogs OPML catalog, writes the route file, wires it into the routes registry, adds a config.yaml entry with an appropriate staleness threshold, and smoke-tests.
disable-model-invocation: true
---

# add-twitter-source

Adds a new Twitter/X handle to CatchUp. Takes an argument: the handle, with or without the leading `@` (e.g. `AnthropicAI`, `@sama`).

## Why this skill exists

The steps (resolve UUID, create route, edit registry, edit config, smoke-test) are mechanical but easy to leave inconsistent. Project-specific Twitter sources all follow the same `makeRssRoute` pattern against `api.xgo.ing`, and the UUIDs aren't resolvable from the handle alone — they must be looked up in ginobefun/BestBlogs's OPML catalog.

## Procedure

### 1. Normalize the handle

Strip a leading `@` if present. Keep original case for display; use lowercase for the route filename slug. Example: input `@AnthropicAI` → display `AnthropicAI`, slug `anthropic`. For multi-word handles like `OpenAIDevs`, pick a short kebab slug (`openai-devs`).

### 2. Resolve the UUID from BestBlogs OPML

Fetch the catalog once per run:

```bash
curl -sSL https://raw.githubusercontent.com/ginobefun/BestBlogs/main/BestBlogs_RSS_Twitters.opml
```

Grep for the handle (case-insensitive) in the `text=` or `xmlUrl=` attribute. The outline line looks like:

```
<outline text="Anthropic(@AnthropicAI)" title="..." type="rss" xmlUrl="https://api.xgo.ing/rss/user/fc28a211471b496682feff329ec616e5"/>
```

Extract the UUID (hex string after `/rss/user/`).

**If not found in OPML**: stop and tell the user. Either (a) the handle isn't in BestBlogs' catalog — they can open https://xgo.ing, log in, search, and paste the UUID manually; or (b) the handle is spelled differently than the display name (common — e.g., `@sama` is listed as `Sam Altman(@sama)`).

### 3. Verify the feed works

Before writing any files, smoke-test the feed URL:

```bash
node -e "
const { fetchText } = require('./scripts/lib/http');
const { parseRss } = require('./scripts/lib/xml');
(async () => {
  const xml = await fetchText('https://api.xgo.ing/rss/user/<UUID>');
  const feed = await parseRss(xml);
  console.log('title:', feed.title, '| items:', feed.items?.length);
  feed.items?.slice(0,3).forEach(i => console.log('  ' + (i.isoDate||i.pubDate) + ' | ' + i.title?.slice(0,60)));
})();
"
```

Abort if the feed is empty or errors — the UUID may be wrong.

### 4. Decide the source config

- **role**: `primary` for official org accounts (e.g. @OpenAI, @AnthropicAI, @GoogleDeepMind). `aggregator` for individuals / personalities (e.g. @sama, @karpathy).
- **max_silence_hours** — based on tweet cadence observed in step 3:
  - Multiple per day → `72` (3d)
  - Several per week → `336` (14d)
  - Monthly or rarer → `720` (30d)
  - Unknown / brand-new → default `336`

### 5. Create the route file

Write `scripts/routes/twitter-<slug>.js`:

```js
const { makeRssRoute } = require('../lib/rss-route');

module.exports = makeRssRoute({
  name: '<Display Name> (Twitter)',
  sourceUrl: 'https://api.xgo.ing/rss/user/<UUID>',
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
    url: "https://api.xgo.ing/rss/user/<UUID>"
    role: <primary|aggregator>
    max_silence_hours: <72|336|720>
```

### 8. Final smoke test

```bash
node -e "
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

- **UUID lookup via xgo.ing API fails**: `api.xgo.ing` only accepts UUID-based lookups, not handle-based. The OPML is the only public handle-to-UUID map. If BestBlogs doesn't have the handle, ask the user.
- **Handle collision**: `@claude` vs `@AnthropicAI` are two different accounts. Always verify the `title` in the feed response matches the expected account before wiring up.
- **Forgetting the registry edit**: if you skip `scripts/routes/index.js`, the fetch script silently excludes the source (the `routeByName` lookup returns undefined and the source falls into the "no route module found" error branch).
