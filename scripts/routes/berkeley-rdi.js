const { fetchText } = require('../lib/http');

// Substack's Cloudflare gate blocks Azure / GH-Actions IP ranges origin-wide
// — both /feed and /api/v1/archive return 403 there regardless of headers.
// r.jina.ai is a reader proxy (free tier, no auth needed for low volume) that
// fetches the upstream from its own infrastructure and returns a JSON envelope:
//   { code, status, data: { title, description, url, content: "<stringified upstream body>" } }
// We want Substack's archive JSON, so we read the upstream `/api/v1/archive`
// path via jina, then JSON.parse the envelope's `data.content`.
const UPSTREAM_URL = 'https://berkeleyrdi.substack.com/api/v1/archive?sort=new&limit=20';
const PROXY_URL = `https://r.jina.ai/${UPSTREAM_URL}`;
const CANONICAL_BASE = 'https://berkeleyrdi.substack.com';

module.exports = {
  name: 'Berkeley RDI',
  sourceType: 'rss',
  sourceUrl: UPSTREAM_URL,
  async fetch() {
    try {
      const raw = await fetchText(PROXY_URL, { headers: { Accept: 'application/json' } });
      const envelope = JSON.parse(raw);
      if (envelope?.code !== 200 || typeof envelope?.data?.content !== 'string') {
        return { articles: [], error: `unexpected jina envelope shape (code=${envelope?.code})` };
      }
      const posts = JSON.parse(envelope.data.content);
      if (!Array.isArray(posts)) {
        return { articles: [], error: 'upstream archive is not an array' };
      }
      const articles = posts.map((p) => ({
        title: (p.title || '').trim(),
        url: p.canonical_url || `${CANONICAL_BASE}/p/${p.slug}`,
        published_at: p.post_date || null,
        description: (p.subtitle || p.description || p.truncated_body_text || '').trim().slice(0, 500) || null,
        full_text: (p.truncated_body_text || p.description || '').trim() || null,
      }));
      return { articles, error: null };
    } catch (err) {
      return { articles: [], error: err.message };
    }
  },
};
