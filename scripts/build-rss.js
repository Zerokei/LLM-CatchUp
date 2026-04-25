// scripts/build-rss.js
// CLI entry point: regenerates feed.xml from reports/{daily,weekly,monthly}/*.md.
// Used standalone (manual rebuild) and as a library call from build-report.js /
// fallback-report.js (which include feed.xml in their commits).

const path = require('node:path');
const { buildRSS } = require('./lib/build-rss');

const PROJECT_ROOT = path.resolve(__dirname, '..');

function main() {
  const { outPath, total, included } = buildRSS({ projectRoot: PROJECT_ROOT });
  console.error(`wrote ${path.relative(PROJECT_ROOT, outPath)} — ${included}/${total} items`);
}

if (require.main === module) {
  main();
}

module.exports = { buildRSS };
