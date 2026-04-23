const { makeRssRoute } = require('../lib/rss-route');

module.exports = makeRssRoute({
  name: '宝玉的分享',
  sourceUrl: 'https://baoyu.io/feed.xml',
  preserveContent: true,
});
