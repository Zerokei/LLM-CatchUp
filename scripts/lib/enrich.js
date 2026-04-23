const { fetchText } = require('./http');

const JINA_BASE = 'https://r.jina.ai/';
const MAX_CHARS = 20_000;

async function jinaFetch(url, { fetchImpl } = {}) {
  const impl = fetchImpl || ((u) => fetchText(u, { headers: { Accept: 'text/plain' } }));
  try {
    const text = await impl(JINA_BASE + url);
    if (typeof text !== 'string') return null;
    return text.slice(0, MAX_CHARS);
  } catch {
    return null;
  }
}

const BLOG_ENRICH_SOURCES = new Set([
  'OpenAI Blog', 'Google AI Blog', 'Anthropic Blog', 'Anthropic Research', 'The Batch',
]);

async function enrichSnapshot(snapshot, sourceConfigs, { fetchImpl } = {}) {
  for (const [sourceName, entry] of Object.entries(snapshot.sources)) {
    if (entry.status !== 'ok' && entry.status !== 'degraded_stale') continue;
    if (!BLOG_ENRICH_SOURCES.has(sourceName)) continue;
    for (const article of entry.articles) {
      article.full_text = await jinaFetch(article.url, { fetchImpl });
    }
  }
}

module.exports = { jinaFetch, enrichSnapshot, BLOG_ENRICH_SOURCES, JINA_BASE, MAX_CHARS };
