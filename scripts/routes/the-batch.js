const { fetchHtml, absoluteUrl } = require('../lib/html');

const SOURCE_URL = 'https://www.deeplearning.ai/the-batch/';

// The Batch index page structure (inspected 2026-04-13):
//   Each issue is an <article> element containing an overlay <a href="/the-batch/issue-N/">.
//   The article selector is 'article' and the issue link is found with a[href*="/the-batch/issue-"].
//   Title lives in the first <h2> inside the article.
//   Date: most cards use an <a href="/the-batch/tag/MMM-DD-YYYY/"> with text like "Apr 10, 2026".
//   Some older highlighted cards use a <time datetime="..."> attribute instead.
//   Description: first <p> inside the article (mobile-visible teaser text).
//   If this route starts returning empty arrays, re-inspect the HTML and update selectors.
const CARD_SELECTOR = 'article';

function parseDateText(text) {
  if (!text) return null;
  const parsed = Date.parse(text.trim());
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

module.exports = {
  name: 'The Batch',
  sourceType: 'web_scraper',
  sourceUrl: SOURCE_URL,
  async fetch() {
    try {
      const $ = await fetchHtml(SOURCE_URL);
      const articles = [];
      const seenUrls = new Set();

      $(CARD_SELECTOR).each((_, el) => {
        const $card = $(el);

        // Only process articles that link to an issue page
        const $issueLink = $card.find('a[href*="/the-batch/issue-"]').first();
        const href = $issueLink.attr('href');
        if (!href) return;

        const url = absoluteUrl(href, SOURCE_URL);
        if (seenUrls.has(url)) return;

        // Title
        const title = $card.find('h2').first().text().trim();
        if (!title) return;

        // Date: prefer tag link text (e.g. "Apr 10, 2026"), fall back to <time datetime>
        let published_at = null;
        const tagDateText = $card.find('a[href*="/the-batch/tag/"]').first().text().trim();
        if (tagDateText) {
          published_at = parseDateText(tagDateText);
        }
        if (!published_at) {
          const $time = $card.find('time[datetime]').first();
          if ($time.length) published_at = parseDateText($time.attr('datetime'));
        }
        if (!published_at) {
          published_at = parseDateText($card.find('time').first().text());
        }

        // Description: first <p> inside the card (mobile teaser)
        const description = $card.find('p').first().text().trim().slice(0, 500) || null;

        seenUrls.add(url);
        articles.push({ title, url, published_at, description });
      });

      return { articles, error: null };
    } catch (err) {
      return { articles: [], error: err.message };
    }
  },
};
