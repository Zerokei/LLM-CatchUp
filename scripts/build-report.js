const crypto = require('node:crypto');
const { execSync } = require('node:child_process');

function urlHash(url) {
  return crypto.createHash('sha256').update(url).digest('hex');
}

function filterAlreadyReported(articles, history) {
  const known = new Set(Object.keys(history.articles || {}));
  return articles.filter((a) => !known.has(urlHash(a.url)));
}

function mergeThreads(articles) {
  const byId = new Map();
  const standalone = [];
  for (const a of articles) {
    if (!a.thread_group_id) { standalone.push(a); continue; }
    const group = byId.get(a.thread_group_id) || [];
    group.push(a);
    byId.set(a.thread_group_id, group);
  }
  const merged = [];
  for (const group of byId.values()) {
    group.sort((x, y) => String(x.published_at).localeCompare(String(y.published_at)));
    const [canonical, ...rest] = group;
    const summary = [canonical.summary, ...rest.map((r) => r.summary).filter(Boolean)].filter(Boolean).join(' ');
    merged.push({ ...canonical, summary, extras: { ...(canonical.extras || {}), thread_urls: group.map((g) => g.url) } });
  }
  return [...merged, ...standalone];
}

function applyDuplicateOf(articles) {
  const byUrl = new Map(articles.map((a) => [a.url, a]));
  const surviving = [];
  for (const a of articles) {
    if (!a.duplicate_of) { surviving.push(a); continue; }
    const canonical = byUrl.get(a.duplicate_of);
    if (!canonical) { surviving.push(a); continue; }  // canonical missing: keep the duplicate
    canonical.also_covered_by = [...(canonical.also_covered_by || []), a.source];
  }
  return surviving.filter((a) => !a.duplicate_of || !byUrl.get(a.duplicate_of));
}

function filterByImportance(articles, minImportance) {
  return articles.filter((a) => (a.importance || 0) >= minImportance);
}

function appendToHistory(history, articles, fetchedAtISO) {
  for (const a of articles) {
    const extras = { tags: a.tags || [] };
    if (a.practice_suggestions?.length) extras.practice_suggestions = a.practice_suggestions;
    if (a.also_covered_by?.length) extras.also_covered_by = a.also_covered_by;
    if (a.extras?.thread_urls) extras.thread_urls = a.extras.thread_urls;
    history.articles[urlHash(a.url)] = {
      title: a.title,
      url: a.url,
      source: a.source,
      published_at: a.published_at,
      fetched_at: fetchedAtISO,
      summary: a.summary,
      category: a.category,
      importance: a.importance,
      extras,
    };
  }
  history.last_fetch = fetchedAtISO;
}

function applyRetention(history, now, retentionDays) {
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 3600 * 1000);
  let removed = 0;
  for (const [k, v] of Object.entries(history.articles)) {
    if (v.fetched_at && new Date(v.fetched_at) < cutoff) {
      delete history.articles[k];
      removed++;
    }
  }
  return removed;
}

function defaultShell(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

async function manageAlerts(health, prevHealth, { shell } = {}) {
  const run = shell || defaultShell;
  for (const [name, h] of Object.entries(health)) {
    const prev = prevHealth[name] || { status: 'healthy' };
    if (h.status === 'alert' && prev.status !== 'alert') {
      const raw = await run(`gh issue list --label source-alert --state open --json number,title`);
      const issues = JSON.parse(raw || '[]');
      const hasOpen = issues.some((i) => i.title.includes(name));
      if (!hasOpen) {
        const title = `CatchUp: ${name} 连续抓取失败`;
        const body = `Source: ${name}\nConsecutive failures: ${h.consecutive_failures}\nLast error: ${h.last_error}`;
        await run(`gh issue create --title ${JSON.stringify(title)} --label source-alert --body ${JSON.stringify(body)}`);
      }
    }
    if (prev.status === 'alert' && h.status === 'healthy') {
      const raw = await run(`gh issue list --label source-alert --state open --json number,title`);
      const issues = JSON.parse(raw || '[]');
      const match = issues.find((i) => i.title.includes(name));
      if (match) {
        await run(`gh issue close ${match.number} --comment "Source recovered and is now healthy."`);
      }
    }
  }
}

module.exports = {
  urlHash,
  filterAlreadyReported, mergeThreads, applyDuplicateOf, filterByImportance,
  appendToHistory, applyRetention,
  manageAlerts,
};
