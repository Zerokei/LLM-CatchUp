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
  '宝玉的分享',
]);

const PRIMARY_BLOG_URL_PATTERNS = [
  /^https?:\/\/(www\.)?anthropic\.com\/(news|research)\//,
  /^https?:\/\/(www\.)?openai\.com\/(index|research|blog)\//,
  /^https?:\/\/blog\.google\//,
  /^https?:\/\/(www\.)?deepmind\.google\//,
  /^https?:\/\/(www\.)?deeplearning\.ai\/the-batch\//,
];

function isPrimaryBlogUrl(url) {
  return typeof url === 'string' && PRIMARY_BLOG_URL_PATTERNS.some((re) => re.test(url));
}

async function enrichSnapshot(snapshot, sourceConfigs, { fetchImpl } = {}) {
  const roleByName = Object.fromEntries((sourceConfigs || []).map((s) => [s.name, s.role]));
  for (const [sourceName, entry] of Object.entries(snapshot.sources)) {
    if (entry.status !== 'ok' && entry.status !== 'degraded_stale') continue;

    const isBlog = BLOG_ENRICH_SOURCES.has(sourceName);
    const isTwitterPrimary = /\(Twitter\)$/.test(sourceName) && roleByName[sourceName] === 'primary';
    if (!isBlog && !isTwitterPrimary) continue;

    for (const article of entry.articles) {
      if (isBlog) {
        article.full_text = await jinaFetch(article.url, { fetchImpl });
      }
      if (isTwitterPrimary) {
        article.linked_content = null;
        for (const { expanded_url } of (article.expanded_urls || [])) {
          if (isPrimaryBlogUrl(expanded_url)) {
            article.linked_content = await jinaFetch(expanded_url, { fetchImpl });
            break;
          }
        }
      }
    }
  }
}

module.exports = {
  jinaFetch, enrichSnapshot,
  BLOG_ENRICH_SOURCES, PRIMARY_BLOG_URL_PATTERNS,
  JINA_BASE, MAX_CHARS,
};
