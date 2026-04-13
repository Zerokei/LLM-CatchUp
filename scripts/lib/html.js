const cheerio = require('cheerio');
const { fetchText } = require('./http');

async function fetchHtml(url) {
  const html = await fetchText(url);
  return cheerio.load(html);
}

function absoluteUrl(href, base) {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

module.exports = { fetchHtml, absoluteUrl };
