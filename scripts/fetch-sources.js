#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const routes = require('./routes');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(PROJECT_ROOT, 'config.yaml');
const CACHE_DIR = path.join(PROJECT_ROOT, 'data', 'fetch-cache');
const WINDOW_HOURS = 24;

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

async function main() {
  const configRaw = fs.readFileSync(CONFIG_PATH, 'utf8');
  const config = yaml.load(configRaw);
  const sourceNames = (config.sources || []).map((s) => s.name);

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
    output.sources[name] = {
      status: 'ok',
      error: null,
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
