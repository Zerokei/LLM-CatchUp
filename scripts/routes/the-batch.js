const { fetchText } = require('../lib/http');

const SOURCE_URL = 'https://www.deeplearning.ai/the-batch/';
const SITEMAP_URL = 'https://www.deeplearning.ai/sitemap-0.xml';

// The sitemap enumerates every post directly as /the-batch/<slug>/ with a
// lastmod timestamp. This route previously traversed /the-batch/tag/<mmm-dd-yyyy>/
// weekly index pages, but those date-tagged URLs were removed from the sitemap
// in ~2026-04 and the tag index pages no longer exist — so we now pull recent
// article URLs from the sitemap directly and fetch each one's __NEXT_DATA__
// (pageProps.post is a singular post object) for metadata.
//
// If this breaks: re-inspect https://www.deeplearning.ai/sitemap-0.xml (expect
// <url><loc>...</loc><lastmod>...</lastmod></url> blocks) and a sample article
// page's __NEXT_DATA__ (expect props.pageProps.post with title/published_at/
// custom_excerpt).

const LOOKBACK_DAYS = 3; // fetch-sources.js applies a 30h window after; 3d covers cron drift.
const MAX_ARTICLES = 15;

const URL_ENTRY_RE = /<url>\s*<loc>https:\/\/www\.deeplearning\.ai\/the-batch\/([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/g;
const NEXT_DATA_RE = /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/;

function isArticlePath(path) {
  if (!path || path === 'about/') return false;
  if (path.startsWith('tag/')) return false;
  // Accept single-segment trailing-slash slugs (e.g. "foo-bar/", "issue-349/").
  // Reject anything with further path segments.
  return path.endsWith('/') && !path.slice(0, -1).includes('/');
}

function extractPost(html) {
  const m = html.match(NEXT_DATA_RE);
  if (!m) return null;
  try {
    return JSON.parse(m[1])?.props?.pageProps?.post || null;
  } catch {
    return null;
  }
}

module.exports = {
  name: 'The Batch',
  sourceType: 'web_scraper',
  sourceUrl: SOURCE_URL,
  async fetch() {
    try {
      const sitemap = await fetchText(SITEMAP_URL);
      const cutoff = Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000;

      const entries = [];
      for (const m of sitemap.matchAll(URL_ENTRY_RE)) {
        const path = m[1];
        if (!isArticlePath(path)) continue;
        const lastmod = Date.parse(m[2]);
        if (!isFinite(lastmod) || lastmod < cutoff) continue;
        entries.push({
          url: `https://www.deeplearning.ai/the-batch/${path}`,
          lastmod,
        });
      }

      if (entries.length === 0) {
        return { articles: [], error: 'no recent article URLs found in sitemap' };
      }

      entries.sort((a, b) => b.lastmod - a.lastmod);
      const recent = entries.slice(0, MAX_ARTICLES);

      let anyExtracted = false;
      const articles = [];
      for (const { url } of recent) {
        const html = await fetchText(url);
        const post = extractPost(html);
        if (!post) continue;
        anyExtracted = true;
        articles.push({
          title: (post.title || '').trim(),
          url,
          published_at: post.published_at ? new Date(post.published_at).toISOString() : null,
          description: (post.custom_excerpt || post.excerpt || '').replace(/\s+/g, ' ').trim().slice(0, 500) || null,
        });
      }

      if (!anyExtracted) {
        return { articles: [], error: '__NEXT_DATA__ shape may have changed — pageProps.post not found on any article page' };
      }

      return { articles, error: null };
    } catch (err) {
      return { articles: [], error: err.message };
    }
  },
};
