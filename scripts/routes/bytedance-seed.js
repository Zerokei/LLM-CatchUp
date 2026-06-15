const cheerio = require('cheerio');
const { fetchText } = require('../lib/http');

const SOURCE_URL = 'https://seed.bytedance.com/en/blog';
const SITEMAP_URL = 'https://seed.bytedance.com/sitemap.xml';
const MAX_ARTICLES = 20;

function blogUrlsFromSitemap(xml) {
  const $ = cheerio.load(xml, { xmlMode: true });
  return $('url')
    .map((_, el) => $(el).find('loc').first().text().trim())
    .get()
    .filter((url) => /^https:\/\/seed\.bytedance\.com\/blog\/[^/]+$/.test(url))
    .map((url) => url.replace('https://seed.bytedance.com/blog/', 'https://seed.bytedance.com/en/blog/'))
    .slice(0, MAX_ARTICLES);
}

function articleFromHtml(html, url) {
  const $ = cheerio.load(html);
  const title = $('h1').first().text().replace(/\s+/g, ' ').trim();
  if (!title) return null;

  const dateLabel = $('p').filter((_, el) => $(el).text().trim() === 'Date').first();
  const dateText = dateLabel.next('p').text().trim();
  const published_at = dateText ? new Date(`${dateText}T00:00:00Z`).toISOString() : null;
  const description = $('meta[name="description"]').attr('content')?.trim().slice(0, 500) || null;

  return { title, url, published_at, description };
}

module.exports = {
  name: 'ByteDance Seed',
  sourceType: 'web_scraper',
  sourceUrl: SOURCE_URL,
  async fetch() {
    try {
      const sitemap = await fetchText(SITEMAP_URL);
      const urls = blogUrlsFromSitemap(sitemap);
      if (urls.length === 0) return { articles: [], error: 'no blog URLs found in sitemap' };

      const articles = [];
      for (const url of urls) {
        const article = articleFromHtml(await fetchText(url), url);
        if (article?.published_at) articles.push(article);
      }
      if (articles.length === 0) return { articles: [], error: 'no dated blog articles parsed' };

      articles.sort((a, b) => new Date(b.published_at) - new Date(a.published_at));
      return { articles, error: null };
    } catch (err) {
      return { articles: [], error: err.message };
    }
  },
};
