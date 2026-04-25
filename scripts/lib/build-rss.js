// scripts/lib/build-rss.js
// Generates feed.xml at project root from reports/{daily,weekly,monthly}/*.md.
// Pure file IO — no git operations. Callers (build-report.js, fallback-report.js,
// scripts/build-rss.js) are responsible for committing the result.

const fs = require('node:fs');
const path = require('node:path');
const { marked } = require('marked');

const REPO_URL = 'https://github.com/Zerokei/LLM-CatchUp';
const PAGES_BASE = 'https://zerokei.github.io/LLM-CatchUp';
const FEED_SELF_URL = `${PAGES_BASE}/feed.xml`;
const FEED_TITLE = 'CatchUp — AI 信息聚合';
const FEED_DESCRIPTION = '每日自动抓取的 AI / LLM 进展摘要（日报 / 周报 / 月报）。';
const MAX_ITEMS = 30;

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escapeCdata(s) {
  return String(s).replace(/\]\]>/g, ']]]]><![CDATA[>');
}

function isoWeekMonday(year, week) {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Dow = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - jan4Dow + 1);
  return new Date(week1Monday.getTime() + (week - 1) * 7 * 86400_000);
}

function parseReportPath(rel) {
  let m = rel.match(/^reports\/daily\/(\d{4})-(\d{2})-(\d{2})\.md$/);
  if (m) {
    return {
      kind: 'daily',
      label: `${m[1]}-${m[2]}-${m[3]}`,
      date: new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])),
      title: `CatchUp 日报 ${m[1]}-${m[2]}-${m[3]}`,
    };
  }
  m = rel.match(/^reports\/weekly\/(\d{4})-W(\d{2})\.md$/);
  if (m) {
    return {
      kind: 'weekly',
      label: `${m[1]}-W${m[2]}`,
      date: isoWeekMonday(+m[1], +m[2]),
      title: `CatchUp 周报 ${m[1]}-W${m[2]}`,
    };
  }
  m = rel.match(/^reports\/monthly\/(\d{4})-(\d{2})\.md$/);
  if (m) {
    return {
      kind: 'monthly',
      label: `${m[1]}-${m[2]}`,
      date: new Date(Date.UTC(+m[1], +m[2] - 1, 1)),
      title: `CatchUp 月报 ${m[1]}-${m[2]}`,
    };
  }
  return null;
}

function collectReports(projectRoot) {
  const out = [];
  for (const cadence of ['daily', 'weekly', 'monthly']) {
    const dir = path.join(projectRoot, 'reports', cadence);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.md')) continue;
      const rel = `reports/${cadence}/${name}`;
      const meta = parseReportPath(rel);
      if (!meta) continue;
      out.push({ rel, ...meta });
    }
  }
  out.sort((a, b) => b.date - a.date);
  return out;
}

function renderItem(report, projectRoot) {
  const md = fs.readFileSync(path.join(projectRoot, report.rel), 'utf8');
  const html = marked.parse(md);
  // Link points at the rendered HTML page on GitHub Pages so RSS readers and
  // click-throughs land on the styled report, not the raw markdown on github.com.
  const htmlPath = report.rel.replace(/\.md$/, '.html');
  const link = `${PAGES_BASE}/${htmlPath}`;
  // GUID stays anchored to the markdown URL on GitHub so existing subscribers
  // (Feedrabbit, etc.) treat the link change as a metadata update rather than
  // re-delivering every historical item as new.
  const guid = `${REPO_URL}/blob/main/${report.rel}`;
  return `    <item>
      <title>${escapeXml(report.title)}</title>
      <link>${escapeXml(link)}</link>
      <guid isPermaLink="false">${escapeXml(guid)}</guid>
      <pubDate>${escapeXml(report.date.toUTCString())}</pubDate>
      <category>${escapeXml(report.kind)}</category>
      <description><![CDATA[${escapeCdata(html)}]]></description>
    </item>`;
}

function renderFeed(reports, projectRoot) {
  const top = reports.slice(0, MAX_ITEMS);
  const lastBuildDate = (top[0]?.date || new Date()).toUTCString();
  const items = top.map((r) => renderItem(r, projectRoot)).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(FEED_TITLE)}</title>
    <link>${escapeXml(REPO_URL)}</link>
    <description>${escapeXml(FEED_DESCRIPTION)}</description>
    <language>zh-CN</language>
    <lastBuildDate>${escapeXml(lastBuildDate)}</lastBuildDate>
    <atom:link href="${escapeXml(FEED_SELF_URL)}" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>
`;
}

function buildRSS({ projectRoot }) {
  const reports = collectReports(projectRoot);
  const xml = renderFeed(reports, projectRoot);
  const outPath = path.join(projectRoot, 'feed.xml');
  fs.writeFileSync(outPath, xml);
  return { outPath, total: reports.length, included: Math.min(reports.length, MAX_ITEMS) };
}

module.exports = {
  buildRSS,
  collectReports,
  parseReportPath,
  renderFeed,
  isoWeekMonday,
  escapeXml,
  escapeCdata,
  MAX_ITEMS,
};
