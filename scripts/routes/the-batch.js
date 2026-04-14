const { fetchText } = require('../lib/http');

const SOURCE_URL = 'https://www.deeplearning.ai/the-batch/';
const SITEMAP_URL = 'https://www.deeplearning.ai/sitemap-0.xml';
// 4 covers ~4 weekly issues. 2 was too tight: if a daily run lands right
// before a new Friday publish, the two most recent tags can both be >30h
// old and the source reports zero articles despite being healthy.
const TAGS_TO_FETCH = 4;

// Why the sitemap+tag dance instead of scraping the index page:
//   /the-batch/ and /the-batch/page/1/ are SSG'd and currently stuck on 2021
//   content server-side. /page/2..N/ only goes back to 2025-09 — none of the
//   2026 weekly issues appear in the paginated archive at all.
//   2026 issues live only under /the-batch/tag/<mmm-dd-yyyy>/ (one tag per
//   weekly publish date). The sitemap is the only place that enumerates them.
// If this breaks: re-verify the sitemap URL and the tag slug format below.

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const TAG_LOC_RE = /<loc>https:\/\/www\.deeplearning\.ai\/the-batch\/tag\/([a-z]{3}-\d{2}-\d{4})\/<\/loc>/g;
const NEXT_DATA_RE = /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/;

function parseTagDate(slug) {
  const m = slug.match(/^([a-z]{3})-(\d{2})-(\d{4})$/);
  if (!m) return null;
  const mon = MONTHS[m[1]];
  if (mon === undefined) return null;
  return new Date(Date.UTC(+m[3], mon, +m[2], 19, 0, 0));
}

function extractPosts(html) {
  const m = html.match(NEXT_DATA_RE);
  if (!m) return [];
  try {
    const data = JSON.parse(m[1]);
    return data?.props?.pageProps?.posts || [];
  } catch {
    return [];
  }
}

module.exports = {
  name: 'The Batch',
  sourceType: 'web_scraper',
  sourceUrl: SOURCE_URL,
  async fetch() {
    try {
      const sitemap = await fetchText(SITEMAP_URL);
      const tags = [...sitemap.matchAll(TAG_LOC_RE)]
        .map((m) => ({ slug: m[1], date: parseTagDate(m[1]) }))
        .filter((t) => t.date)
        .sort((a, b) => b.date - a.date)
        .slice(0, TAGS_TO_FETCH);

      if (tags.length === 0) {
        return { articles: [], error: 'no weekly tags found in sitemap' };
      }

      const seen = new Set();
      const articles = [];
      let anyTagYieldedPosts = false;
      for (const t of tags) {
        const html = await fetchText(`https://www.deeplearning.ai/the-batch/tag/${t.slug}/`);
        const posts = extractPosts(html);
        if (posts.length > 0) anyTagYieldedPosts = true;
        for (const p of posts) {
          if (!p.slug) continue;
          const url = `https://www.deeplearning.ai/the-batch/${p.slug}/`;
          if (seen.has(url)) continue;
          seen.add(url);
          articles.push({
            title: (p.title || '').trim(),
            url,
            published_at: p.published_at ? new Date(p.published_at).toISOString() : null,
            description: (p.custom_excerpt || p.excerpt || '').replace(/\s+/g, ' ').trim().slice(0, 500) || null,
          });
        }
      }

      // If every tag page yielded zero posts, the __NEXT_DATA__ script tag has
      // probably been renamed or restructured. Raise this loudly rather than
      // returning silently-empty articles, which would otherwise be swallowed
      // again by the staleness check's fetched_count > 0 guard.
      if (!anyTagYieldedPosts) {
        return { articles: [], error: 'all tag pages yielded no posts — __NEXT_DATA__ shape may have changed' };
      }

      return { articles, error: null };
    } catch (err) {
      return { articles: [], error: err.message };
    }
  },
};
