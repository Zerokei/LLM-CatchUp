// scripts/lib/build-pages.js
// Renders each report markdown into a standalone HTML page next to the .md
// (e.g. `reports/daily/2026-04-25.html`). Embeds CSS inline so each page is
// self-contained. Skips `*.ops.md` sidecars (handled by build-rss's collector).

const fs = require('node:fs');
const path = require('node:path');
const { marked } = require('marked');
const { collectReports } = require('./build-rss');

const REPO_URL = 'https://github.com/Zerokei/LLM-CatchUp';
const PAGES_BASE = 'https://zerokei.github.io/LLM-CatchUp';

const CADENCE_LABEL_EN = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };
const CADENCE_LABEL_CN = { daily: '日报', weekly: '周报', monthly: '月报' };

const ROMAN_TABLE = [
  ['M', 1000], ['CM', 900], ['D', 500], ['CD', 400], ['C', 100], ['XC', 90],
  ['L', 50], ['XL', 40], ['X', 10], ['IX', 9], ['V', 5], ['IV', 4], ['I', 1],
];
function toRoman(n) {
  let out = '';
  for (const [s, v] of ROMAN_TABLE) { while (n >= v) { out += s; n -= v; } }
  return out;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function weeklyRangeLabel(weekLabel) {
  const m = weekLabel.match(/^(\d{4})-W(\d{2})$/);
  if (!m) return '';
  const [year, week] = [+m[1], +m[2]];
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Dow = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - jan4Dow + 1);
  const start = new Date(week1Monday.getTime() + (week - 1) * 7 * 86400_000);
  const end = new Date(start.getTime() + 6 * 86400_000);
  const m1 = start.getUTCMonth() + 1, d1 = start.getUTCDate();
  const m2 = end.getUTCMonth() + 1, d2 = end.getUTCDate();
  return m1 === m2 ? `${m1}月${d1}日 – ${d2}日` : `${m1}月${d1}日 – ${m2}月${d2}日`;
}

const PAGE_CSS = `
:root {
  --paper: #f3eee4;
  --paper-deep: #ebe3d2;
  --ink: #1a1916;
  --ink-soft: #4a463e;
  --ink-mute: #837b6d;
  --rule: #cfc6b3;
  --rule-soft: #e0d8c6;
  --accent: #a3211a;
  --highlight: rgba(163, 33, 26, 0.08);
  --font-display: "Fraunces", "Noto Serif SC", "Songti SC", "STSong", serif;
  --font-body: "Spectral", "Noto Serif SC", "Songti SC", "STSong", serif;
  --font-mono: "JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace;
  --measure: 68ch;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; -webkit-text-size-adjust: 100%; }
body {
  margin: 0; background: var(--paper); color: var(--ink);
  font-family: var(--font-body); font-weight: 400; font-size: 17px; line-height: 1.7;
  font-feature-settings: "kern", "liga", "calt";
  -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale;
  position: relative; min-height: 100vh; overflow-x: hidden;
}
body::before {
  content: ""; position: fixed; inset: 0; pointer-events: none; z-index: 1;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.1 0 0 0 0 0.1 0 0 0 0 0.09 0 0 0 0.45 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)' opacity='0.55'/></svg>");
  mix-blend-mode: multiply; opacity: 0.18;
}
body::after {
  content: ""; position: fixed; inset: 0; pointer-events: none; z-index: 1;
  background: radial-gradient(ellipse at center, transparent 55%, rgba(50, 40, 25, 0.07) 100%);
}
.container {
  position: relative; z-index: 2;
  max-width: 1080px; margin: 0 auto;
  padding: clamp(1.25rem, 3vw, 2.5rem) clamp(1.25rem, 4vw, 3rem) 4rem;
}
.reading-layout { display: block; }
.reading-layout.has-toc {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 220px;
  gap: clamp(2rem, 4vw, 4rem);
  align-items: start;
}
.reading-layout > article { min-width: 0; max-width: 720px; }

/* Anchor offset for sticky/in-page jumps so the heading isn't flush with the top edge. */
.prose h2[id], .prose h3[id] { scroll-margin-top: 1.5rem; }
.topnav {
  display: flex; justify-content: space-between; align-items: baseline;
  padding-bottom: 1.5rem; border-bottom: 1px solid var(--rule-soft); margin-bottom: 3rem;
}
.topnav .back {
  font-family: var(--font-display); font-style: italic; font-weight: 500;
  font-variation-settings: "opsz" 24, "SOFT" 30, "WONK" 0;
  font-size: 1.5rem; color: var(--ink); text-decoration: none;
  transition: color 0.18s ease;
}
.topnav .back:hover { color: var(--accent); }
.topnav .back .dot { color: var(--accent); font-style: normal; }
.topnav .feed-link {
  font-family: var(--font-mono); font-size: 11px; font-weight: 500;
  letter-spacing: 0.22em; text-transform: uppercase;
  color: var(--ink-mute); text-decoration: none;
  transition: color 0.18s ease;
}
.topnav .feed-link:hover { color: var(--accent); }

article header { margin-bottom: 2.5rem; }
article header .meta {
  display: flex; gap: 0.75rem; align-items: baseline;
  font-family: var(--font-mono); font-size: 11px; font-weight: 500;
  letter-spacing: 0.22em; text-transform: uppercase;
  color: var(--ink-mute); margin-bottom: 1rem;
}
article header .meta .cadence-en { color: var(--accent); font-weight: 600; }
article header .meta .issue-no { font-variant-numeric: tabular-nums; margin-left: auto; }

.report-title {
  font-family: var(--font-display); font-size: clamp(2rem, 4vw, 3rem); font-weight: 500;
  font-variation-settings: "opsz" 96, "SOFT" 30, "WONK" 0;
  line-height: 1.05; letter-spacing: -0.015em; margin: 0 0 0.4rem; color: var(--ink);
  font-variant-numeric: tabular-nums;
}
.report-subtitle {
  font-family: var(--font-body); font-style: italic; font-size: 1rem;
  color: var(--ink-mute); margin: 0 0 1.5rem;
}
.primary-rule {
  border: none; height: 1px; background: var(--ink); opacity: 0.7; margin: 1.75rem 0 2.5rem;
}

/* ---------- PROSE ---------- */
.prose { font-size: 17px; line-height: 1.75; max-width: var(--measure); }
.prose h2 {
  font-family: var(--font-display); font-size: 1.55rem; font-weight: 600;
  font-variation-settings: "opsz" 96, "SOFT" 50, "WONK" 0;
  line-height: 1.25; letter-spacing: -0.01em;
  margin: 3rem 0 1rem; padding-bottom: 0.4rem;
  border-bottom: 1px solid var(--rule); color: var(--ink);
}
.prose h3 {
  font-family: var(--font-display); font-style: italic; font-size: 1.2rem; font-weight: 500;
  font-variation-settings: "opsz" 48, "SOFT" 80;
  margin: 2rem 0 0.75rem; color: var(--ink); letter-spacing: -0.005em;
}
.prose h4 {
  font-family: var(--font-mono); font-size: 0.78rem; font-weight: 600;
  letter-spacing: 0.22em; text-transform: uppercase; color: var(--accent);
  margin: 1.75rem 0 0.6rem;
}
.prose p { margin: 0 0 1.1rem; }
.prose strong { font-weight: 600; color: var(--ink); }
.prose em { font-style: italic; }
.prose a {
  color: var(--ink); text-decoration: none;
  background-image: linear-gradient(var(--accent), var(--accent));
  background-position: 0 100%; background-repeat: no-repeat; background-size: 100% 1px;
  padding-bottom: 1px; transition: background-size 0.2s ease, color 0.2s ease;
}
.prose a:hover { color: var(--accent); background-size: 100% 2px; }
.prose ul, .prose ol { margin: 0 0 1.1rem; padding-left: 1.5rem; }
.prose li { margin-bottom: 0.4rem; }
.prose ul li::marker { color: var(--accent); }
.prose code {
  font-family: var(--font-mono); font-size: 0.88em;
  background: var(--paper-deep); padding: 0.1em 0.35em; border-radius: 2px;
  color: var(--ink);
}
.prose pre {
  font-family: var(--font-mono); font-size: 0.85rem; line-height: 1.55;
  background: var(--paper-deep); border-left: 2px solid var(--accent);
  padding: 1rem 1.25rem; overflow-x: auto; margin: 1.25rem 0;
}
.prose pre code { background: none; padding: 0; }
/* Vintage callout box for "> 实践建议" blockquotes: double-rule frame
   with a paper-deep tint and an italic accent label at the top. */
.prose blockquote {
  margin: 2rem 0;
  padding: 1.1rem 1.4rem 0.95rem;
  background: var(--paper-deep);
  border: 1px solid var(--ink);
  box-shadow: 0 0 0 3px var(--paper), 0 0 0 4px var(--ink);
  font-style: normal;
  color: var(--ink);
}
.prose blockquote > p:first-child {
  margin: 0 0 0.6rem;
  padding-bottom: 0.45rem;
  border-bottom: 1px solid var(--rule);
}
.prose blockquote > p:first-child > strong {
  font-family: var(--font-display);
  font-style: italic;
  font-size: 0.98rem;
  font-weight: 600;
  font-variation-settings: "opsz" 24, "SOFT" 50, "WONK" 0;
  color: var(--accent);
  letter-spacing: 0.04em;
}
.prose blockquote ul, .prose blockquote ol { margin: 0; padding-left: 1.2rem; }
.prose blockquote li { margin-bottom: 0.3rem; color: var(--ink-soft); }
.prose blockquote li:last-child { margin-bottom: 0; }
.prose blockquote li::marker { color: var(--accent); }
.prose blockquote p { margin-bottom: 0.55rem; }
.prose blockquote p:last-child { margin-bottom: 0; }
.prose table {
  width: 100%; border-collapse: collapse; margin: 1.5rem 0;
  font-size: 0.92rem; font-variant-numeric: tabular-nums;
}
.prose th {
  text-align: left; font-family: var(--font-mono); font-size: 11px; font-weight: 600;
  letter-spacing: 0.18em; text-transform: uppercase; color: var(--ink-mute);
  padding: 0.6rem 0.75rem 0.5rem 0; border-bottom: 1px solid var(--ink);
}
.prose td {
  padding: 0.55rem 0.75rem 0.55rem 0; border-bottom: 1px solid var(--rule-soft);
  vertical-align: top;
}
.prose hr {
  border: none; text-align: center; margin: 2.5rem 0; height: 1rem; position: relative;
}
.prose hr::before {
  content: "§"; font-family: var(--font-display); font-size: 1.25rem; color: var(--accent);
  position: absolute; left: 50%; transform: translateX(-50%);
  background: var(--paper); padding: 0 0.75rem;
}
.prose hr::after {
  content: ""; position: absolute; top: 50%; left: 0; right: 0; height: 1px;
  background: var(--rule); z-index: -1;
}

/* ---------- TOC ---------- */
.toc {
  position: sticky;
  top: 1.5rem;
  align-self: start;
  max-height: calc(100vh - 3rem);
  overflow-y: auto;
  padding-left: 1rem;
  border-left: 1px solid var(--rule-soft);
}
.toc-label {
  font-family: var(--font-mono); font-size: 10.5px; font-weight: 600;
  letter-spacing: 0.22em; text-transform: uppercase; color: var(--accent);
  margin-bottom: 0.85rem; padding-bottom: 0.5rem;
  border-bottom: 1px solid var(--rule);
}
.toc ul { list-style: none; margin: 0; padding: 0; }
.toc li { margin: 0.1rem 0; }
.toc li.toc-h2 {
  font-family: var(--font-display); font-style: italic;
  font-variation-settings: "opsz" 24, "SOFT" 50, "WONK" 0;
  font-size: 0.95rem;
  margin-top: 0.85rem;
}
.toc li.toc-h2:first-child { margin-top: 0; }
.toc li.toc-h3 {
  font-family: var(--font-body); font-size: 0.78rem; line-height: 1.4;
  letter-spacing: 0;
}
.toc a {
  color: var(--ink-soft); text-decoration: none;
  display: block; padding: 0.2rem 0 0.2rem 0.55rem;
  border-left: 2px solid transparent;
  margin-left: -0.55rem;
  transition: color 0.15s ease, border-color 0.15s ease;
}
.toc a:hover { color: var(--accent); border-left-color: var(--accent); }
.toc::-webkit-scrollbar { width: 4px; }
.toc::-webkit-scrollbar-thumb { background: var(--rule); }

@media (max-width: 960px) {
  .reading-layout.has-toc { grid-template-columns: 1fr; }
  .toc { display: none; }
}

/* ---------- ENDNAV ---------- */
.endnav {
  display: grid; grid-template-columns: 1fr auto 1fr; align-items: baseline;
  gap: 1rem; padding-top: 2rem; margin-top: 4rem;
  border-top: 1px solid var(--rule-soft);
  font-family: var(--font-mono); font-size: 11px; font-weight: 500;
  letter-spacing: 0.22em; text-transform: uppercase;
}
.endnav a, .endnav .dim {
  color: var(--ink); text-decoration: none;
  transition: color 0.18s ease;
}
.endnav a:hover { color: var(--accent); }
.endnav .dim { color: var(--rule); }
.endnav .center { text-align: center; }
.endnav .right { text-align: right; }
.endnav .label { display: block; color: var(--ink-mute); font-size: 9.5px; margin-bottom: 0.4rem; }

footer.colophon {
  margin-top: 3rem; padding-top: 2rem;
  border-top: 1px solid var(--rule-soft);
  font-family: var(--font-mono); font-size: 10px; font-weight: 500;
  letter-spacing: 0.18em; text-transform: uppercase; color: var(--ink-mute);
  text-align: center;
}
footer.colophon a { color: var(--ink-mute); text-decoration: none; }
footer.colophon a:hover { color: var(--accent); }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important; transition-duration: 0.01ms !important;
  }
}
:focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; }
@media (max-width: 600px) {
  .endnav { grid-template-columns: 1fr; gap: 1.25rem; text-align: center; }
  .endnav .right { text-align: center; }
}
`;

function stripH1(md) {
  return md.replace(/^#\s+[^\n]*\n+/, '');
}

// Walk a token tree and concatenate its plain text content (skipping link
// chrome, formatting, etc.). Used to extract a clean ToC label from headings
// like `### 1. [Some Title](url)`.
function tokenText(tokens) {
  let out = '';
  for (const t of tokens || []) {
    if (t.type === 'text') out += t.text;
    else if (t.tokens) out += tokenText(t.tokens);
  }
  return out;
}

// Lex the markdown to find every h2/h3 heading in document order. Each gets a
// sequential `h-N` id. The same counter is replayed during HTML rendering (see
// `addHeadingIds`) so anchor links resolve correctly.
function collectHeadings(md) {
  const tokens = marked.lexer(md);
  const items = [];
  let counter = 0;
  for (const t of tokens) {
    if (t.type === 'heading' && (t.depth === 2 || t.depth === 3)) {
      counter++;
      items.push({ depth: t.depth, text: tokenText(t.tokens), id: `h-${counter}` });
    }
  }
  return items;
}

// Inject `id="h-N"` onto every <h2>/<h3> in the rendered HTML. Counter must
// match collectHeadings (same source-order walk).
function addHeadingIds(html) {
  let counter = 0;
  return html.replace(/<(h[23])>([\s\S]*?)<\/\1>/g, (_match, tag, content) => {
    counter++;
    return `<${tag} id="h-${counter}">${content}</${tag}>`;
  });
}

// Build the sidebar ToC. Drops the 文章详情 h2 since it's just a section header
// — the article h3s underneath are the substance and read better as a flat list
// alongside 今日趋势.
function renderToc(items) {
  const visible = items.filter((it) => !(it.depth === 2 && it.text.trim() === '文章详情'));
  if (visible.length < 3) return '';   // not worth a sidebar for short reports
  const li = visible.map((it) => {
    const cls = it.depth === 2 ? 'toc-h2' : 'toc-h3';
    return `      <li class="${cls}"><a href="#${it.id}">${escapeHtml(it.text)}</a></li>`;
  }).join('\n');
  return `  <aside class="toc" aria-label="On this page">
    <div class="toc-label">本期目录</div>
    <ul>
${li}
    </ul>
  </aside>`;
}

function navLink(neighbor, label) {
  if (!neighbor) return `<span class="dim">${label}</span>`;
  const href = `../${neighbor.kind === 'daily' ? 'daily' : neighbor.kind === 'weekly' ? 'weekly' : 'monthly'}/${neighbor.label}.html`;
  return `<a href="${escapeHtml(href)}">${label}</a>`;
}

function renderPage({ report, totalIssues, issueNo, newer, older, projectRoot }) {
  const md = fs.readFileSync(path.join(projectRoot, report.rel), 'utf8');
  const proseSource = stripH1(md);
  const headings = collectHeadings(proseSource);
  const htmlBody = addHeadingIds(marked.parse(proseSource));
  const tocHtml = renderToc(headings);
  const subtitle = report.kind === 'weekly' ? weeklyRangeLabel(report.label) : '';
  const cadenceEn = CADENCE_LABEL_EN[report.kind] || report.kind;
  const cadenceCn = CADENCE_LABEL_CN[report.kind] || '';

  const fontHref = 'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght,SOFT,WONK@0,9..144,300..900,0..100,0..1;1,9..144,300..900,0..100,0..1&family=Spectral:ital,wght@0,400;0,500;0,600;1,400&family=JetBrains+Mono:wght@400;500;600&family=Noto+Serif+SC:wght@400;500;600&display=swap';

  return `<!doctype html>
<html lang="zh-Hans">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>${escapeHtml(report.title)} · CatchUp</title>
  <meta name="description" content="CatchUp ${cadenceCn} — ${escapeHtml(report.label)}" />
  <link rel="alternate" type="application/rss+xml" title="CatchUp RSS" href="../../feed.xml" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="${fontHref}" rel="stylesheet" />
  <style>${PAGE_CSS}</style>
</head>
<body>
  <div class="container">
    <header class="topnav">
      <a href="../../" class="back">← <em>CatchUp</em><span class="dot">.</span></a>
      <a href="../../feed.xml" class="feed-link">RSS</a>
    </header>

    <div class="reading-layout${tocHtml ? ' has-toc' : ''}">
      <article>
        <header>
          <div class="meta">
            <span class="cadence-en">${escapeHtml(cadenceEn)}</span>
            <span>·</span>
            <span>${escapeHtml(cadenceCn)}</span>
            <span class="issue-no">Nº ${toRoman(issueNo)}</span>
          </div>
          <h1 class="report-title">${escapeHtml(report.label)}</h1>
          ${subtitle ? `<p class="report-subtitle">${escapeHtml(subtitle)}</p>` : ''}
          <hr class="primary-rule" />
        </header>

        <div class="prose">${htmlBody}</div>
      </article>
${tocHtml}
    </div>

    <nav class="endnav" aria-label="Issue navigation">
      <span class="left">
        <span class="label">← Older ${escapeHtml(cadenceEn.toLowerCase())}</span>
        ${navLink(older, older ? escapeHtml(older.label) : 'None')}
      </span>
      <span class="center">
        <span class="label">Index</span>
        <a href="../../">All issues</a>
      </span>
      <span class="right">
        <span class="label">Newer ${escapeHtml(cadenceEn.toLowerCase())} →</span>
        ${navLink(newer, newer ? escapeHtml(newer.label) : 'None')}
      </span>
    </nav>

    <footer class="colophon">
      <a href="${REPO_URL}/blob/main/${escapeHtml(report.rel)}" target="_blank" rel="noopener">View source on GitHub</a>
    </footer>
  </div>
</body>
</html>
`;
}

function buildPages({ projectRoot }) {
  const reports = collectReports(projectRoot);
  const totalIssues = reports.length;

  // Group by cadence so prev/next stay within cadence
  const byCadence = { daily: [], weekly: [], monthly: [] };
  for (const r of reports) {
    if (byCadence[r.kind]) byCadence[r.kind].push(r);
  }

  let written = 0;
  for (const r of reports) {
    const cohort = byCadence[r.kind] || [];
    const idx = cohort.findIndex((x) => x.rel === r.rel);
    const newer = cohort[idx - 1] || null;  // index 0 is newest
    const older = cohort[idx + 1] || null;
    const issueNo = totalIssues - r.i;

    const html = renderPage({
      report: r, totalIssues, issueNo, newer, older, projectRoot,
    });
    const outPath = path.join(projectRoot, r.rel.replace(/\.md$/, '.html'));
    fs.writeFileSync(outPath, html);
    written++;
  }
  return { written, total: totalIssues };
}

module.exports = { buildPages, PAGES_BASE, PAGE_CSS };
