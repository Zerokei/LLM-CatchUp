const { makeRssRoute } = require('../lib/rss-route');

module.exports = makeRssRoute({
  name: 'OpenAI Blog',
  sourceUrl: 'https://openai.com/blog/rss.xml',
});
