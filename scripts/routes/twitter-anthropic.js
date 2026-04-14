const { makeRssRoute } = require('../lib/rss-route');

module.exports = makeRssRoute({
  name: 'Anthropic (Twitter)',
  sourceUrl: 'https://api.xgo.ing/rss/user/fc28a211471b496682feff329ec616e5',
});
