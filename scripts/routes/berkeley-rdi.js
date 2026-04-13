const { makeRssRoute } = require('../lib/rss-route');

module.exports = makeRssRoute({
  name: 'Berkeley RDI',
  sourceUrl: 'https://berkeleyrdi.substack.com/feed',
});
