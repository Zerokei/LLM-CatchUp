const { makeRssRoute } = require('../lib/rss-route');

module.exports = makeRssRoute({
  name: 'Claude Code Releases',
  sourceUrl: 'https://github.com/anthropics/claude-code/releases.atom',
});
