const { makeRssRoute } = require('../lib/rss-route');

module.exports = makeRssRoute({
  name: 'Claude (Twitter)',
  sourceUrl: 'https://api.xgo.ing/rss/user/01f60d63a61b44d692cc35c7feb0b4a4',
});
