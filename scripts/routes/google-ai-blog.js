const { makeRssRoute } = require('../lib/rss-route');

module.exports = makeRssRoute({
  name: 'Google AI Blog',
  sourceUrl: 'https://blog.google/technology/ai/rss/',
});
