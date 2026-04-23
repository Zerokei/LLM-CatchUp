const crypto = require('node:crypto');
const { execSync } = require('node:child_process');

function urlHash(url) {
  return crypto.createHash('sha256').update(url).digest('hex');
}

function filterAlreadyReported(articles, history) {
  const known = new Set(Object.keys(history.articles || {}));
  return articles.filter((a) => !known.has(urlHash(a.url)));
}

function mergeThreads(articles) {
  const byId = new Map();
  const standalone = [];
  for (const a of articles) {
    if (!a.thread_group_id) { standalone.push(a); continue; }
    const group = byId.get(a.thread_group_id) || [];
    group.push(a);
    byId.set(a.thread_group_id, group);
  }
  const merged = [];
  for (const group of byId.values()) {
    group.sort((x, y) => String(x.published_at).localeCompare(String(y.published_at)));
    const [canonical, ...rest] = group;
    const summary = [canonical.summary, ...rest.map((r) => r.summary).filter(Boolean)].filter(Boolean).join(' ');
    merged.push({ ...canonical, summary, extras: { ...(canonical.extras || {}), thread_urls: group.map((g) => g.url) } });
  }
  return [...merged, ...standalone];
}

function applyDuplicateOf(articles) {
  const byUrl = new Map(articles.map((a) => [a.url, a]));
  const surviving = [];
  for (const a of articles) {
    if (!a.duplicate_of) { surviving.push(a); continue; }
    const canonical = byUrl.get(a.duplicate_of);
    if (!canonical) { surviving.push(a); continue; }  // canonical missing: keep the duplicate
    canonical.also_covered_by = [...(canonical.also_covered_by || []), a.source];
  }
  return surviving.filter((a) => !a.duplicate_of || !byUrl.get(a.duplicate_of));
}

function filterByImportance(articles, minImportance) {
  return articles.filter((a) => (a.importance || 0) >= minImportance);
}

function appendToHistory(history, articles, fetchedAtISO) {
  for (const a of articles) {
    const extras = { tags: a.tags || [] };
    if (a.practice_suggestions?.length) extras.practice_suggestions = a.practice_suggestions;
    if (a.also_covered_by?.length) extras.also_covered_by = a.also_covered_by;
    if (a.extras?.thread_urls) extras.thread_urls = a.extras.thread_urls;
    history.articles[urlHash(a.url)] = {
      title: a.title,
      url: a.url,
      source: a.source,
      published_at: a.published_at,
      fetched_at: fetchedAtISO,
      summary: a.summary,
      category: a.category,
      importance: a.importance,
      extras,
    };
  }
  history.last_fetch = fetchedAtISO;
}

function applyRetention(history, now, retentionDays) {
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 3600 * 1000);
  let removed = 0;
  for (const [k, v] of Object.entries(history.articles)) {
    if (v.fetched_at && new Date(v.fetched_at) < cutoff) {
      delete history.articles[k];
      removed++;
    }
  }
  return removed;
}

function defaultShell(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

async function manageAlerts(health, prevHealth, { shell } = {}) {
  const run = shell || defaultShell;
  for (const [name, h] of Object.entries(health)) {
    const prev = prevHealth[name] || { status: 'healthy' };
    if (h.status === 'alert' && prev.status !== 'alert') {
      const raw = await run(`gh issue list --label source-alert --state open --json number,title`);
      const issues = JSON.parse(raw || '[]');
      const hasOpen = issues.some((i) => i.title.includes(name));
      if (!hasOpen) {
        const title = `CatchUp: ${name} 连续抓取失败`;
        const body = `Source: ${name}\nConsecutive failures: ${h.consecutive_failures}\nLast error: ${h.last_error}`;
        await run(`gh issue create --title ${JSON.stringify(title)} --label source-alert --body ${JSON.stringify(body)}`);
      }
    }
    if (prev.status === 'alert' && h.status === 'healthy') {
      const raw = await run(`gh issue list --label source-alert --state open --json number,title`);
      const issues = JSON.parse(raw || '[]');
      const match = issues.find((i) => i.title.includes(name));
      if (match) {
        await run(`gh issue close ${match.number} --comment "Source recovered and is now healthy."`);
      }
    }
  }
}

module.exports = {
  urlHash,
  filterAlreadyReported, mergeThreads, applyDuplicateOf, filterByImportance,
  appendToHistory, applyRetention,
  manageAlerts,
};

const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const { renderReport } = require('./lib/render-report');
const { updateSourceHealth } = require('./lib/health');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const FETCH_CACHE_DIR = path.join(PROJECT_ROOT, 'data/fetch-cache');
const ANALYSIS_CACHE_DIR = path.join(PROJECT_ROOT, 'data/analysis-cache');
const HISTORY_PATH = path.join(PROJECT_ROOT, 'data/history.json');
const HEALTH_PATH = path.join(PROJECT_ROOT, 'data/health.json');
const CONFIG_PATH = path.join(PROJECT_ROOT, 'config.yaml');
const REPORTS_DIR = path.join(PROJECT_ROOT, 'reports/daily');

function shanghaiDate() {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

async function main() {
  const date = process.env.REPORT_DATE || shanghaiDate();
  const fetchCachePath = path.join(FETCH_CACHE_DIR, `${date}.json`);
  const analysisCachePath = path.join(ANALYSIS_CACHE_DIR, `${date}.json`);

  if (!fs.existsSync(fetchCachePath)) {
    console.error(`fetch-cache missing: ${fetchCachePath}`);
    process.exit(1);
  }
  if (!fs.existsSync(analysisCachePath)) {
    console.error(`analysis-cache missing: ${analysisCachePath} — routine did not produce one; fallback-report.yml is expected to handle this`);
    process.exit(0);  // not an error condition for this workflow; the fallback path is what handles it
  }

  const fetchCache = JSON.parse(fs.readFileSync(fetchCachePath, 'utf8'));
  const analysisCache = JSON.parse(fs.readFileSync(analysisCachePath, 'utf8'));
  const history = fs.existsSync(HISTORY_PATH)
    ? JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8')) : { articles: {}, last_fetch: null };
  const healthBefore = fs.existsSync(HEALTH_PATH)
    ? JSON.parse(fs.readFileSync(HEALTH_PATH, 'utf8')) : {};
  const config = yaml.load(fs.readFileSync(CONFIG_PATH, 'utf8'));

  const minImportance = config.filtering?.min_importance ?? 2;
  const retentionDays = config.retention_days || 90;
  const failureThreshold = config.alerting?.consecutive_failure_threshold || 3;

  // Step 1 — filter out articles already reported (URL-hash dedup)
  const fresh = filterAlreadyReported(analysisCache.articles, history);

  // Step 2 — thread merge (by thread_group_id)
  const afterThreads = mergeThreads(fresh);

  // Step 3 — duplicate_of → also_covered_by
  const canonical = applyDuplicateOf(afterThreads);

  // Step 4 — sort by importance desc, then published_at desc
  canonical.sort((a, b) =>
    (b.importance - a.importance) || String(b.published_at).localeCompare(String(a.published_at)));

  // Step 5 — importance filter for the report body
  const articlesInReport = filterByImportance(canonical, minImportance);

  // Step 6 — render markdown
  const rawFetched = Object.values(fetchCache.sources).reduce((n, s) => n + (s.articles?.length || 0), 0);
  const sourcesWithContent = Object.values(fetchCache.sources).filter((s) => (s.articles?.length || 0) > 0).length;
  const sourceStatuses = Object.entries(fetchCache.sources).map(([name, s]) => ({
    name,
    status_note: s.status === 'ok'
      ? `✅ 正常（窗口内 ${s.articles.length} 文）`
      : s.status === 'degraded_stale'
        ? `⚠️ 过期（${s.error}）`
        : `❌ 错误（${s.error}）`,
  }));
  const md = renderReport({
    date,
    articlesInReport,
    rawFetched,
    mergedCount: canonical.length,
    sourcesWithContent,
    filteredLowImportance: canonical.length - articlesInReport.length,
    trendParagraph: analysisCache.trend_paragraph || '（无趋势段）',
    sourceStatuses,
  });
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(REPORTS_DIR, `${date}.md`), md);

  // Step 7 — append to history
  appendToHistory(history, canonical, analysisCache.analyzed_at || fetchCache.fetched_at);
  const removed = applyRetention(history, new Date(), retentionDays);
  console.error(`retention cleanup: removed ${removed} entries`);
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2) + '\n');

  // Step 8 — update health
  const healthAfter = {};
  for (const [name, entry] of Object.entries(fetchCache.sources)) {
    healthAfter[name] = updateSourceHealth(healthBefore[name], entry, fetchCache.fetched_at, failureThreshold);
  }
  // carry forward any entries in healthBefore that aren't in today's fetch-cache
  for (const [name, h] of Object.entries(healthBefore)) {
    if (!(name in healthAfter)) healthAfter[name] = h;
  }
  fs.writeFileSync(HEALTH_PATH, JSON.stringify(healthAfter, null, 2) + '\n');

  // Step 9 — issues
  await manageAlerts(healthAfter, healthBefore);

  // Step 10 — git add / commit / push
  const run = (c) => execSync(c, { stdio: 'inherit' });
  run(`git add data/history.json data/health.json reports/daily/${date}.md`);
  // If the working tree has no changes (idempotent re-run), skip commit
  try {
    execSync('git diff --cached --quiet', { stdio: 'ignore' });
    console.error('no changes to commit');
  } catch {
    run(`git commit -m "chore(catchup): daily report ${date}"`);
    run('git push');
  }
}

if (require.main === module) {
  main().catch((err) => { console.error('fatal:', err); process.exit(2); });
}
