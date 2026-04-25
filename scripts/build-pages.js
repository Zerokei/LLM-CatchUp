// scripts/build-pages.js
// CLI wrapper. Renders every report markdown into a sibling .html file.
// Used standalone (manual rebuild) and from build-report.js / fallback-report.js
// (which include the resulting HTML files in their commits).

const path = require('node:path');
const { buildPages } = require('./lib/build-pages');

const PROJECT_ROOT = path.resolve(__dirname, '..');

function main() {
  const { written, total } = buildPages({ projectRoot: PROJECT_ROOT });
  console.error(`wrote ${written}/${total} report HTML pages`);
}

if (require.main === module) {
  main();
}

module.exports = { buildPages };
