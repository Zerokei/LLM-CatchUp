const Parser = require('rss-parser');

const parser = new Parser({
  timeout: 30_000,
  headers: {},
});

async function parseRss(xmlString) {
  return await parser.parseString(xmlString);
}

module.exports = { parseRss };
