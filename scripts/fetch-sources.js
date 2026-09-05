#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const routes = require('./routes');
const { enrichSnapshot } = require('./lib/enrich');
const { computeThreadGroups, computeDuplicates } = require('./lib/derive-refs');
const {
  envFlag, sourceNamesNeedingFetch, configuredExistingSources, mergeApiUsage,
} = require('./lib/fetch-resume');
const { isoInZone, pacificDayBoundsUtc, previousPacificDate } = require('./lib/report-date');
const {
  normalizeTwitterState, consumedUrlsFromHistory, ensureAccount, incrementalWindow,
  updateLastSeen, upsertPending, prunePending, selectPendingForReport,
} = require('./lib/twitter-state');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(PROJECT_ROOT, 'config.yaml');
const CACHE_DIR = path.join(PROJECT_ROOT, 'data', 'fetch-cache');
const HISTORY_PATH = path.join(PROJECT_ROOT, 'data', 'history.json');
const TWITTER_STATE_PATH = path.join(PROJECT_ROOT, 'data', 'twitter-state.json');
function withinWindow(article, windowStart, windowEnd) {
  if (!article.published_at) return false;
  const pub = new Date(article.published_at);
  if (Number.isNaN(pub.getTime())) return false;
  return pub >= windowStart && pub < windowEnd;
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

function readJsonIfPresent(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function latestSuccessfulCoverage(cacheDir, sourceName, notAfter) {
  if (!fs.existsSync(cacheDir)) return null;
  const limit = new Date(notAfter).getTime();
  const files = fs.readdirSync(cacheDir).filter((file) => /^\d{4}-\d{2}-\d{2}\.json$/.test(file)).sort().reverse();
  for (const file of files) {
    try {
      const snapshot = JSON.parse(fs.readFileSync(path.join(cacheDir, file), 'utf8'));
      const covered = new Date(snapshot.window_end).getTime();
      const entry = snapshot.sources?.[sourceName];
      if (Number.isFinite(covered) && covered <= limit && entry && entry.status !== 'error') {
        return new Date(covered).toISOString();
      }
    } catch {
      // Ignore malformed historical snapshots and keep looking backwards.
    }
  }
  return null;
}

function latestPublishedForSource(history, sourceName) {
  const dates = Object.values(history?.articles || {})
    .filter((entry) => entry?.source === sourceName && entry.published_at)
    .map((entry) => new Date(entry.published_at))
    .filter((date) => !Number.isNaN(date.getTime()));
  return dates.length
    ? new Date(Math.max(...dates.map((date) => date.getTime()))).toISOString()
    : null;
}

function twitterStatus(account, sourceConfig, windowEnd) {
  const maxSilenceHours = sourceConfig.max_silence_hours;
  const lastSeen = account.last_seen_published_at ? new Date(account.last_seen_published_at) : null;
  if (maxSilenceHours && lastSeen && !Number.isNaN(lastSeen.getTime())) {
    const ageHours = (windowEnd.getTime() - lastSeen.getTime()) / 3600000;
    if (ageHours > maxSilenceHours) {
      return {
        status: 'degraded_stale',
        error: `newest known item is ${ageHours.toFixed(1)}h old, exceeds ${maxSilenceHours}h threshold`,
      };
    }
  }
  return { status: 'ok', error: null };
}

async function main() {
  const configRaw = fs.readFileSync(CONFIG_PATH, 'utf8');
  const config = yaml.load(configRaw);
  const sourceConfigs = config.sources || [];
  const sourceNames = sourceConfigs.map((s) => s.name);
  const configByName = Object.fromEntries(sourceConfigs.map((s) => [s.name, s]));

  const routeByName = Object.fromEntries(routes.map((r) => [r.name, r]));

  const fetchedAt = new Date();
  const targetDate = process.env.REPORT_DATE || previousPacificDate(fetchedAt);
  const { start: windowStart, end: windowEnd } = pacificDayBoundsUtc(targetDate);
  const outPath = path.join(CACHE_DIR, `${targetDate}.json`);
  const resumeExisting = envFlag(process.env.RESUME_EXISTING);
  const history = readJsonIfPresent(HISTORY_PATH, { articles: {} });
  const consumedUrls = consumedUrlsFromHistory(history);
  const twitterState = normalizeTwitterState(readJsonIfPresent(TWITTER_STATE_PATH, null));
  const pruneStats = prunePending(twitterState, { consumedUrls, now: windowEnd });
  console.error(`twitter queue: pruned ${pruneStats.consumed} consumed, ${pruneStats.expired} expired`);

  let existingSnapshot = null;
  if (resumeExisting && fs.existsSync(outPath)) {
    try {
      existingSnapshot = JSON.parse(fs.readFileSync(outPath, 'utf8'));
      if (existingSnapshot.date !== targetDate) {
        console.error(`resume cache date mismatch (${existingSnapshot.date} != ${targetDate}); running full fetch`);
        existingSnapshot = null;
      }
    } catch (err) {
      console.error(`resume cache unreadable (${err.message}); running full fetch`);
      existingSnapshot = null;
    }
  }

  const namesToFetch = sourceNamesNeedingFetch(sourceNames, existingSnapshot, resumeExisting);
  const namesToFetchSet = new Set(namesToFetch);
  if (resumeExisting && existingSnapshot && namesToFetch.length === 0) {
    console.error(`resume: ${outPath} is complete; no sources need refetching`);
    return;
  }

  const output = {
    date: targetDate,
    report_timezone: 'America/Los_Angeles',
    fetched_at: isoInZone(fetchedAt),
    window_start: isoInZone(windowStart),
    window_end: isoInZone(windowEnd),
    sources: configuredExistingSources(sourceNames, existingSnapshot),
  };

  let anySuccess = Object.values(output.sources).some((entry) => entry.status !== 'error');
  const twitterRuns = new Map();

  for (const name of sourceNames) {
    if (!namesToFetchSet.has(name)) continue;
    const route = routeByName[name];
    const cadence = configByName[name]?.cadence || 'daily';
    if (!route) {
      console.error(`[${name}] no route module found — skipping`);
      output.sources[name] = {
        status: 'error',
        error: 'no route module found',
        fetched_count: 0,
        filtered_count: 0,
        cadence,
        articles: [],
      };
      continue;
    }

    console.error(`[${name}] fetching...`);
    const previousApiUsage = output.sources[name]?.api_usage;
    const isTwitter = route.sourceType === 'socialdata';
    let fetchWindowStart = windowStart;
    let advancesWatermark = false;
    let account = null;
    const fetchMode = configByName[name]?.twitter_fetch_mode === 'timeline' ? 'timeline' : 'search';
    if (isTwitter) {
      const bootstrap = latestSuccessfulCoverage(CACHE_DIR, name, windowEnd);
      account = ensureAccount(twitterState, {
        name,
        handle: route.handle,
        userId: route.userId,
        bootstrapCoveredThrough: bootstrap,
        bootstrapLastSeen: latestPublishedForSource(history, name),
      });
      const syncWindow = incrementalWindow(account, windowStart, windowEnd);
      fetchWindowStart = syncWindow.start;
      advancesWatermark = syncWindow.advancesWatermark;
      console.error(`[${name}] ${fetchMode} range ${fetchWindowStart.toISOString()}..${windowEnd.toISOString()}`);
    }
    const result = await route.fetch({
      windowStart: fetchWindowStart, windowEnd, targetDate, mode: fetchMode,
    });
    if (isTwitter) twitterRuns.set(name, { result, previousApiUsage, account, fetchMode });
    const apiUsage = mergeApiUsage(previousApiUsage, result.usage);
    if (result.error) {
      console.error(`[${name}] ERROR: ${result.error}`);
      output.sources[name] = {
        status: 'error',
        error: result.error,
        fetched_count: 0,
        filtered_count: 0,
        cadence,
        articles: [],
        ...(result.warning ? { fetch_warning: result.warning } : {}),
        ...(apiUsage ? { api_usage: apiUsage } : {}),
      };
      continue;
    }

    if (isTwitter) {
      upsertPending(twitterState, {
        source: name,
        articles: result.articles,
        firstSeenAt: fetchedAt.toISOString(),
        discoveryMethod: fetchMode === 'timeline' ? 'timeline_incremental' : 'incremental_search',
        consumedUrls,
      });
      updateLastSeen(account, [
        ...result.articles,
        ...(result.newest_returned_at ? [{ published_at: result.newest_returned_at }] : []),
      ]);
      if (advancesWatermark) account.covered_through = windowEnd.toISOString();
      anySuccess = true;
      continue;
    }

    const fetchedCount = result.articles.length;
    const filtered = result.articles.filter((a) => withinWindow(a, windowStart, windowEnd));
    console.error(`[${name}] ok: ${filtered.length} of ${fetchedCount} within Pacific day ${targetDate}`);

    // Staleness check: if the source declares max_silence_hours in config,
    // flag the source as degraded_stale when either (a) fetch returned zero
    // items at all — the mirror may be silently returning an empty feed —
    // or (b) the newest item (pre-window-filter) is older than the threshold.
    // Both cases indicate upstream trouble that wouldn't surface as an HTTP
    // error. The pre-window-filter check matters because a stale-but-present
    // article can still pass `withinWindow` and land in articles[]; we want
    // to flag the source even when window-filtered output is non-empty.
    const maxSilenceHours = configByName[name]?.max_silence_hours;
    let status = 'ok';
    let error = null;
    if (maxSilenceHours) {
      if (fetchedCount === 0) {
        status = 'degraded_stale';
        error = 'no items returned; cannot assess freshness';
        console.error(`[${name}] STALE: ${error}`);
      } else {
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
    }

    output.sources[name] = {
      status,
      error,
      fetched_count: fetchedCount,
      filtered_count: filtered.length,
      cadence,
      articles: filtered,
      ...(result.warning ? { fetch_warning: result.warning } : {}),
      ...(apiUsage ? { api_usage: apiUsage } : {}),
    };
    anySuccess = true;
  }

  // A long outage can discover items that are already
  // outside the retention window. Do not spend today's backfill quota on them.
  const postFetchPrune = prunePending(twitterState, { consumedUrls, now: windowEnd });
  if (postFetchPrune.consumed || postFetchPrune.expired) {
    console.error(`twitter queue after fetch: pruned ${postFetchPrune.consumed} consumed, ${postFetchPrune.expired} expired`);
  }

  // Rebuild every Twitter entry from the persistent queue. This makes a
  // same-date resume deterministic even when a recovered source adds backlog.
  const eligibleTwitterSources = new Set(sourceNames.filter((name) => {
    if (routeByName[name]?.sourceType !== 'socialdata') return false;
    const run = twitterRuns.get(name);
    return run ? !run.result.error : output.sources[name]?.status !== 'error';
  }));
  const selected = selectPendingForReport(twitterState, {
    targetDate, eligibleSources: eligibleTwitterSources,
  });
  const selectedBySource = new Map();
  for (const article of [...selected.current, ...selected.backfill]) {
    const list = selectedBySource.get(article.source) || [];
    list.push(article);
    selectedBySource.set(article.source, list);
  }

  for (const name of sourceNames) {
    const route = routeByName[name];
    if (route?.sourceType !== 'socialdata') continue;
    const chosen = selectedBySource.get(name) || [];
    const run = twitterRuns.get(name);
    const existing = output.sources[name] || {};
    if (!run) {
      output.sources[name] = {
        ...existing,
        articles: chosen,
        filtered_count: chosen.length,
        current_count: chosen.filter((a) => a.delivery_class === 'current').length,
        backfill_count: chosen.filter((a) => a.delivery_class === 'backfill').length,
        pending_count: Object.values(twitterState.pending).filter((entry) => entry.source === name).length,
      };
      continue;
    }
    if (run.result.error) continue;
    const freshness = twitterStatus(run.account, configByName[name], windowEnd);
    const apiUsage = mergeApiUsage(run.previousApiUsage, run.result.usage);
    output.sources[name] = {
      status: freshness.status,
      error: freshness.error,
      fetched_count: run.result.articles.length,
      filtered_count: chosen.length,
      current_count: chosen.filter((a) => a.delivery_class === 'current').length,
      backfill_count: chosen.filter((a) => a.delivery_class === 'backfill').length,
      pending_count: Object.values(twitterState.pending).filter((entry) => entry.source === name).length,
      cadence: configByName[name]?.cadence || 'daily',
      articles: chosen,
      ...(apiUsage ? { api_usage: apiUsage } : {}),
    };
  }

  console.error('enriching articles via Jina Reader...');
  const enrichTarget = { sources: {} };
  for (const [name, entry] of Object.entries(output.sources)) {
    const isTwitterPrimary = routeByName[name]?.sourceType === 'socialdata'
      && configByName[name]?.role === 'primary';
    const articles = isTwitterPrimary
      ? (entry.articles || []).filter((article) => article.linked_content === undefined)
      : namesToFetchSet.has(name) ? (entry.articles || []) : [];
    if (articles.length || (namesToFetchSet.has(name) && routeByName[name]?.sourceType !== 'socialdata')) {
      enrichTarget.sources[name] = { ...entry, articles };
    }
  }
  await enrichSnapshot(enrichTarget, sourceConfigs);
  console.error('enrichment done');

  // Preserve enrichment in pending so retries and later backfill delivery do
  // not repeat Jina calls.
  for (const [name, entry] of Object.entries(output.sources)) {
    if (routeByName[name]?.sourceType !== 'socialdata') continue;
    for (const article of entry.articles || []) {
      const pending = twitterState.pending[String(article.tweet_id)];
      if (!pending) continue;
      if ('linked_content' in article) pending.article.linked_content = article.linked_content;
    }
  }

  // Deterministic preprocessing of cross-article references so the LLM
  // routine only does per-article work. See docs/prompts/daily-trigger.md
  // Step 3 — these fields are authoritative from fetch-time.
  const articlesBySource = {};
  const sourceRoles = {};
  const allArticles = [];
  for (const [name, entry] of Object.entries(output.sources)) {
    articlesBySource[name] = entry.articles || [];
    sourceRoles[name] = configByName[name]?.role || null;
    allArticles.push(...(entry.articles || []));
  }
  const threadGroups = computeThreadGroups(allArticles);
  const duplicates = computeDuplicates(articlesBySource, sourceRoles);
  for (const entry of Object.values(output.sources)) {
    for (const a of entry.articles || []) {
      a.thread_group_id = threadGroups.get(a.url) || null;
      a.duplicate_of = duplicates.get(a.url) || null;
    }
  }
  console.error(`derive-refs: ${threadGroups.size} thread members, ${duplicates.size} duplicates`);

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n');
  fs.writeFileSync(TWITTER_STATE_PATH, JSON.stringify(twitterState, null, 2) + '\n');
  console.error(`wrote ${outPath}`);
  console.error(`wrote ${TWITTER_STATE_PATH}`);

  process.exit(anySuccess ? 0 : 1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('fatal:', err);
    process.exit(2);
  });
}

module.exports = {
  latestSuccessfulCoverage, latestPublishedForSource, twitterStatus,
};
