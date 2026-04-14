#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const routes = require('./routes');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(PROJECT_ROOT, 'config.yaml');
const CACHE_DIR = path.join(PROJECT_ROOT, 'data', 'fetch-cache');
// 30h > 24h on purpose: daily runs don't fire at exactly the same wall-clock
// time (GH Actions queue drift, manual triggers). A ≥24h window with 6h of
// overlap guarantees adjacent runs cover any gap. Dedup-by-URL-hash in
// history.json absorbs the double-fetching of overlap articles.
const WINDOW_HOURS = 30;

function toShanghaiISO(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  return fmt.format(date).replace(' ', 'T') + '+08:00';
}

function shanghaiDateStr(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return fmt.format(date);
}

function withinWindow(article, windowStart, windowEnd) {
  if (!article.published_at) return false;
  const pub = new Date(article.published_at);
  if (Number.isNaN(pub.getTime())) return false;
  return pub >= windowStart && pub <= windowEnd;
}

function newestPublishedAt(articles) {
  let newest = null;
  for (const a of articles) {
    if (!a.published_at) continue;
    const d = new Date(a.published_at);
    if (Number.isNaN(d.getTime())) continue;
    if (!newest || d > newest) newest = d;
  }
  return newest;
}

async function main() {
  const configRaw = fs.readFileSync(CONFIG_PATH, 'utf8');
  const config = yaml.load(configRaw);
  const sourceConfigs = config.sources || [];
  const sourceNames = sourceConfigs.map((s) => s.name);
  const configByName = Object.fromEntries(sourceConfigs.map((s) => [s.name, s]));

  const routeByName = Object.fromEntries(routes.map((r) => [r.name, r]));

  const fetchedAt = new Date();
  const windowEnd = fetchedAt;
  const windowStart = new Date(fetchedAt.getTime() - WINDOW_HOURS * 3600 * 1000);

  const output = {
    fetched_at: toShanghaiISO(fetchedAt),
    window_start: toShanghaiISO(windowStart),
    window_hours: WINDOW_HOURS,
    sources: {},
  };

  let anySuccess = false;

  for (const name of sourceNames) {
    const route = routeByName[name];
    if (!route) {
      console.error(`[${name}] no route module found — skipping`);
      output.sources[name] = {
        status: 'error',
        error: 'no route module found',
        fetched_count: 0,
        filtered_count: 0,
        articles: [],
      };
      continue;
    }

    console.error(`[${name}] fetching...`);
    const result = await route.fetch();
    if (result.error) {
      console.error(`[${name}] ERROR: ${result.error}`);
      output.sources[name] = {
        status: 'error',
        error: result.error,
        fetched_count: 0,
        filtered_count: 0,
        articles: [],
      };
      continue;
    }

    const fetchedCount = result.articles.length;
    const filtered = result.articles.filter((a) => withinWindow(a, windowStart, windowEnd));
    console.error(`[${name}] ok: ${filtered.length} of ${fetchedCount} within ${WINDOW_HOURS}h window`);

    // Staleness check: if the source declares max_silence_hours in config,
    // and the newest item (pre-window-filter) is older than that, flag the
    // source as degraded_stale. Signals an upstream freeze (e.g., a
    // Twitter-to-RSS mirror stuck) that wouldn't surface as an HTTP error.
    const maxSilenceHours = configByName[name]?.max_silence_hours;
    let status = 'ok';
    let error = null;
    if (maxSilenceHours && fetchedCount > 0) {
      const newest = newestPublishedAt(result.articles);
      if (newest) {
        const ageHours = (fetchedAt.getTime() - newest.getTime()) / 3600000;
        if (ageHours > maxSilenceHours) {
          status = 'degraded_stale';
          error = `newest item is ${ageHours.toFixed(1)}h old, exceeds ${maxSilenceHours}h threshold`;
          console.error(`[${name}] STALE: ${error}`);
        }
      }
    }

    output.sources[name] = {
      status,
      error,
      fetched_count: fetchedCount,
      filtered_count: filtered.length,
      articles: filtered,
    };
    anySuccess = true;
  }

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const outPath = path.join(CACHE_DIR, `${shanghaiDateStr(fetchedAt)}.json`);
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n');
  console.error(`wrote ${outPath}`);

  process.exit(anySuccess ? 0 : 1);
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(2);
});
