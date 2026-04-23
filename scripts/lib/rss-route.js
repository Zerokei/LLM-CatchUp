const { fetchText } = require('./http');
const { parseRss } = require('./xml');

function makeRssRoute({ name, sourceUrl, preserveContent = false }) {
  return {
    name,
    sourceType: 'rss',
    sourceUrl,
    async fetch() {
      try {
        const xml = await fetchText(sourceUrl);
        const feed = await parseRss(xml);
        const articles = (feed.items || []).map((item) => {
          const isoDate = item.isoDate || (item.pubDate ? new Date(item.pubDate).toISOString() : null);
          const article = {
            title: (item.title || '').trim(),
            url: item.link || '',
            published_at: isoDate,
            description: (item.contentSnippet || item.content || item.description || '').trim(),
          };
          if (preserveContent) {
            const body = (item['content:encoded'] || item.content || '').trim();
            article.full_text = body || null;
          }
          return article;
        });
        return { articles, error: null };
      } catch (err) {
        return { articles: [], error: err.message };
      }
    },
  };
}

module.exports = { makeRssRoute };
