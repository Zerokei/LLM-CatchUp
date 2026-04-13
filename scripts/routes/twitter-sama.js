const { makeRssRoute } = require('../lib/rss-route');

module.exports = makeRssRoute({
  name: 'Sam Altman (Twitter)',
  sourceUrl: 'https://api.xgo.ing/rss/user/e30d4cd223f44bed9d404807105c8927',
});
