const fs = require('node:fs');
const path = require('node:path');
const { buildRSS } = require('./lib/build-rss');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const FETCH_CACHE_DIR = path.join(PROJECT_ROOT, 'data/fetch-cache');
const REPORTS_DIR = path.join(PROJECT_ROOT, 'reports/daily');

function shanghaiDate() {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function renderFallbackReport(date, fetchCache) {
  let md = `# CatchUp 日报 — ${date}（fallback，自动回退版）\n\n`;
  md += '> Claude 分析环节未在预期窗口内产出；以下为仅标题+链接的兜底版本。\n\n---\n\n';
  const populated = Object.entries(fetchCache.sources).filter(([, s]) => (s.articles?.length || 0) > 0);
  if (populated.length === 0) {
    md += '今日抓取窗口内全部数据源均无新内容。\n';
    return md;
  }
  for (const [name, entry] of populated) {
    md += `## ${name}\n\n`;
    for (const a of entry.articles) {
      md += `- [${a.title}](${a.url})\n`;
    }
    md += '\n';
  }
  return md;
}

async function main() {
  const date = process.env.REPORT_DATE || shanghaiDate();
  const reportPath = path.join(REPORTS_DIR, `${date}.md`);
  if (fs.existsSync(reportPath)) {
    console.error(`report already exists at ${reportPath} — fallback not needed`);
    process.exit(0);
  }
  const fetchCachePath = path.join(FETCH_CACHE_DIR, `${date}.json`);
  if (!fs.existsSync(fetchCachePath)) {
    console.error(`fetch-cache missing for ${date}; nothing to fall back on`);
    process.exit(1);
  }
  const fetchCache = JSON.parse(fs.readFileSync(fetchCachePath, 'utf8'));
  const md = renderFallbackReport(date, fetchCache);
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  fs.writeFileSync(reportPath, md);

  const rss = buildRSS({ projectRoot: PROJECT_ROOT });
  console.error(`rss: wrote ${path.relative(PROJECT_ROOT, rss.outPath)} — ${rss.included}/${rss.total} items`);

  const { execSync } = require('node:child_process');
  execSync(`git add ${reportPath} feed.xml`, { stdio: 'inherit' });
  try {
    execSync('git diff --cached --quiet', { stdio: 'ignore' });
    console.error('no changes to commit');
  } catch {
    execSync(`git commit -m "chore(catchup): fallback daily report ${date}"`, { stdio: 'inherit' });
    execSync('git push', { stdio: 'inherit' });
  }
}

if (require.main === module) {
  main().catch((err) => { console.error('fatal:', err); process.exit(2); });
}

module.exports = { renderFallbackReport };
