const crypto = require('node:crypto');

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

module.exports = { urlHash, filterAlreadyReported, mergeThreads, applyDuplicateOf, filterByImportance };
