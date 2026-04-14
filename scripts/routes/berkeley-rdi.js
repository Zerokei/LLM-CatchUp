const { fetchText } = require('../lib/http');

// Substack's RSS endpoint (/feed) is aggressively Cloudflare-gated and
// returns 403 from Azure/GH-Actions IP ranges regardless of browser-like
// headers. The JSON archive API at /api/v1/archive is less tightly gated
// and returns richer structured data, so we use it instead.
const SOURCE_URL = 'https://berkeleyrdi.substack.com/api/v1/archive?sort=new&limit=20';
const CANONICAL_BASE = 'https://berkeleyrdi.substack.com';

module.exports = {
  name: 'Berkeley RDI',
  sourceType: 'rss',
  sourceUrl: SOURCE_URL,
  async fetch() {
    try {
      const raw = await fetchText(SOURCE_URL, { headers: { Accept: 'application/json,*/*;q=0.8' } });
      const posts = JSON.parse(raw);
      if (!Array.isArray(posts)) {
        return { articles: [], error: 'unexpected archive shape (not an array)' };
      }
      const articles = posts.map((p) => ({
        title: (p.title || '').trim(),
        url: p.canonical_url || `${CANONICAL_BASE}/p/${p.slug}`,
        published_at: p.post_date || null,
        description: (p.subtitle || p.description || p.truncated_body_text || '').trim().slice(0, 500) || null,
      }));
      return { articles, error: null };
    } catch (err) {
      return { articles: [], error: err.message };
    }
  },
};
