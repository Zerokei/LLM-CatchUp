const { fetchHtml, absoluteUrl } = require('../lib/html');

const SOURCE_URL = 'https://www.anthropic.com/news';

// Anthropic /news page structure (inspected 2026-04-13):
//   Two card types share the selector `a[href^="/news/"]`:
//     1. Featured grid cards: title in <h4 class="headline-6 ...">; description in
//        <p class="body-3 serif ...">; date as text in <time ...> (e.g. "Feb 17, 2026")
//     2. Publication list items: title in <span class="...title ...">; date same <time> pattern
//   Both types carry no `datetime` attribute on <time>, only inner text.
//   If this route starts returning empty arrays, re-inspect the HTML and update selectors.
const CARD_SELECTOR = 'a[href^="/news/"]';

function parseDateText(text) {
  if (!text) return null;
  const trimmed = text.trim();
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString();
}

module.exports = {
  name: 'Anthropic Blog',
  sourceType: 'web_scraper',
  sourceUrl: SOURCE_URL,
  async fetch() {
    try {
      const $ = await fetchHtml(SOURCE_URL);
      const articles = [];
      const seenUrls = new Set();

      $(CARD_SELECTOR).each((_, el) => {
        const $card = $(el);
        const href = $card.attr('href');
        if (!href) return;
        const url = absoluteUrl(href, SOURCE_URL);
        if (seenUrls.has(url)) return;

        // Title: featured cards use h4; list items use a span with class containing "title"
        const title = (
          $card.find('h4').first().text().trim() ||
          $card.find('span[class*="title"]').first().text().trim()
        );
        if (!title) return;

        // Date: <time> element contains text like "Apr 6, 2026" (no datetime attribute)
        const published_at = parseDateText($card.find('time').first().text());

        // Description: featured cards have a <p class="body-3 serif ..."> with a teaser
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
