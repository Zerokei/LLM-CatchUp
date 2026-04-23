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

module.exports = { jinaFetch, JINA_BASE, MAX_CHARS };
