const { fetchHtml, absoluteUrl } = require('../lib/html');

const SOURCE_URL = 'https://www.anthropic.com/research';

// Anthropic /research page structure (inspected 2026-04-13):
//   Two card types share the selector `a[href^="/research/"]`:
//     1. FeaturedGrid cards: featured article uses <h2 class="headline-4 ...">; side-link articles
//        use <h4 class="headline-6 ...">; description in <p class="body-3 serif ...">; date as
//        text in <time class="FeaturedGrid-module-scss-module__...date ..."> (e.g. "Apr 2, 2026")
//     2. PublicationList items: title in <span class="PublicationList-module-scss-module__...title
//        body-3">; date in <time class="PublicationList-module-scss-module__...date body-3">
//   Team nav links also match the selector (href="/research/team/...") but carry only a
//   <span class="caption"> and no h2/h4/span[class*="title"], so they are filtered out by
//   the title guard below.
//   No `datetime` attribute on <time> elements — only inner text.
//   If this route starts returning empty arrays, re-inspect the HTML and update selectors.
const CARD_SELECTOR = 'a[href^="/research/"]';

function parseDateText(text) {
  if (!text) return null;
  const trimmed = text.trim();
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString();
}

module.exports = {
  name: 'Anthropic Research',
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

        // Title: FeaturedGrid featured card uses h2; FeaturedGrid side-links use h4;
        // PublicationList items use span[class*="title"]
        const title = (
          $card.find('h2').first().text().trim() ||
          $card.find('h4').first().text().trim() ||
          $card.find('span[class*="title"]').first().text().trim()
        );
        if (!title) return;

        // Date: <time> element contains text like "Apr 2, 2026" (no datetime attribute)
        const published_at = parseDateText($card.find('time').first().text());

        // Description: FeaturedGrid cards have a <p class="body-3 serif ..."> with a teaser;
        // PublicationList items have no description paragraph
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
