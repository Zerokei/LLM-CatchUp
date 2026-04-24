function extractHandleFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const m = url.match(/^https?:\/\/x\.com\/([^/]+)\/status\/\d+/);
  return m ? m[1] : null;
}

function computeThreadGroups(articles) {
  const byUrl = new Map(articles.map((a) => [a.url, a]));
  const MAX_GAP_MS = 5 * 60 * 1000;

  function parentOf(a) {
    if (!a.reply_to?.status_id) return null;
    const authorHandle = extractHandleFromUrl(a.url);
    if (!authorHandle) return null;
    const replyTo = a.reply_to.screen_name?.toLowerCase();
    if (!replyTo || replyTo !== authorHandle.toLowerCase()) return null;
    const parentUrl = `https://x.com/${authorHandle}/status/${a.reply_to.status_id}`;
    const parent = byUrl.get(parentUrl);
    if (!parent) return null;
    const dt = new Date(a.published_at).getTime() - new Date(parent.published_at).getTime();
    if (!Number.isFinite(dt) || dt < 0 || dt > MAX_GAP_MS) return null;
    return parent;
  }

  function rootOf(a, seen = new Set()) {
    if (seen.has(a.url)) return a;
    seen.add(a.url);
    const p = parentOf(a);
    return p ? rootOf(p, seen) : a;
  }

  const childrenOfRoot = new Map();
  for (const a of articles) {
    const r = rootOf(a);
    if (!childrenOfRoot.has(r.url)) childrenOfRoot.set(r.url, []);
    childrenOfRoot.get(r.url).push(a);
  }

  const groups = new Map();
  for (const [rootUrl, members] of childrenOfRoot) {
    if (members.length < 2) continue;
    const root = byUrl.get(rootUrl);
    const handle = extractHandleFromUrl(rootUrl);
    const ts = new Date(root.published_at);
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${ts.getUTCFullYear()}${pad(ts.getUTCMonth() + 1)}${pad(ts.getUTCDate())}-${pad(ts.getUTCHours())}${pad(ts.getUTCMinutes())}`;
    const id = `thread-${handle}-${stamp}`;
    for (const m of members) groups.set(m.url, id);
  }
  return groups;
}

module.exports = { extractHandleFromUrl, computeThreadGroups };
