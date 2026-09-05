const { formatDateInZone } = require('./report-date');

const STATE_VERSION = 1;
const OVERLAP_HOURS = 48;
const PENDING_RETENTION_DAYS = 30;
const DAILY_BACKFILL_LIMIT = 10;

function emptyTwitterState() {
  return { version: STATE_VERSION, accounts: {}, pending: {} };
}

function normalizeTwitterState(value) {
  if (!value || value.version !== STATE_VERSION) return emptyTwitterState();
  return {
    version: STATE_VERSION,
    accounts: value.accounts && typeof value.accounts === 'object' ? value.accounts : {},
    pending: value.pending && typeof value.pending === 'object' ? value.pending : {},
  };
}

function tweetIdFromArticle(article) {
  if (article?.tweet_id != null) return String(article.tweet_id);
  const match = String(article?.url || '').match(/\/status\/(\d+)/);
  return match ? match[1] : null;
}

function consumedUrlsFromHistory(history) {
  const consumed = new Set();
  for (const entry of Object.values(history?.articles || {})) {
    if (!entry?.report_date) continue;
    if (entry?.url) consumed.add(entry.url);
    for (const url of entry?.extras?.thread_urls || []) {
      if (url) consumed.add(url);
    }
    for (const member of entry?.extras?.cluster_members || []) {
      if (member?.url) consumed.add(member.url);
    }
  }
  return consumed;
}

function ensureAccount(state, {
  name, handle, userId, bootstrapCoveredThrough = null, bootstrapLastSeen = null,
}) {
  const previous = state.accounts[name] || {};
  const account = {
    handle,
    user_id: String(userId),
    covered_through: previous.covered_through || bootstrapCoveredThrough,
    last_seen_published_at: previous.last_seen_published_at || bootstrapLastSeen,
  };
  state.accounts[name] = account;
  return account;
}

function incrementalWindow(account, fallbackStart, windowEnd, overlapHours = OVERLAP_HOURS) {
  const fallback = new Date(fallbackStart);
  const end = new Date(windowEnd);
  const covered = account?.covered_through ? new Date(account.covered_through) : null;
  if (!covered || Number.isNaN(covered.getTime())) {
    return {
      start: new Date(fallback.getTime() - overlapHours * 3600 * 1000),
      end,
      advancesWatermark: true,
    };
  }
  if (covered >= end) {
    return { start: fallback, end, advancesWatermark: false };
  }
  return {
    start: new Date(covered.getTime() - overlapHours * 3600 * 1000),
    end,
    advancesWatermark: true,
  };
}

function updateLastSeen(account, articles) {
  const timestamps = (articles || [])
    .map((article) => new Date(article.published_at))
    .filter((date) => !Number.isNaN(date.getTime()));
  if (account.last_seen_published_at) {
    const previous = new Date(account.last_seen_published_at);
    if (!Number.isNaN(previous.getTime())) timestamps.push(previous);
  }
  if (timestamps.length) {
    account.last_seen_published_at = new Date(Math.max(...timestamps.map((d) => d.getTime()))).toISOString();
  }
}

function mergeArticle(existing, incoming) {
  const merged = { ...(existing || {}) };
  for (const [key, value] of Object.entries(incoming || {})) {
    if (value == null) continue;
    const previous = merged[key];
    if (previous == null) {
      merged[key] = value;
    } else if (Array.isArray(value)) {
      if (!Array.isArray(previous) || value.length > previous.length) merged[key] = value;
    } else if (typeof value === 'string') {
      if (value.length > String(previous).length) merged[key] = value;
    } else if (typeof value === 'object' && !Array.isArray(value)
      && typeof previous === 'object' && !Array.isArray(previous)) {
      merged[key] = mergeArticle(previous, value);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

function upsertPending(state, {
  source, articles, firstSeenAt, discoveryMethod, consumedUrls = new Set(),
}) {
  let inserted = 0;
  let updated = 0;
  for (const article of articles || []) {
    const tweetId = tweetIdFromArticle(article);
    if (!tweetId || !article.url || consumedUrls.has(article.url)) continue;
    const previous = state.pending[tweetId];
    state.pending[tweetId] = {
      source,
      first_seen_at: previous?.first_seen_at || firstSeenAt,
      origin_report_date: previous?.origin_report_date
        || formatDateInZone(new Date(article.published_at)),
      discovery_method: previous?.discovery_method || discoveryMethod,
      article: mergeArticle(previous?.article, { ...article, tweet_id: tweetId }),
    };
    if (previous) updated += 1;
    else inserted += 1;
  }
  return { inserted, updated };
}

function prunePending(state, { consumedUrls = new Set(), now, retentionDays = PENDING_RETENTION_DAYS }) {
  const cutoff = new Date(now).getTime() - retentionDays * 24 * 3600 * 1000;
  let consumed = 0;
  let expired = 0;
  for (const [tweetId, entry] of Object.entries(state.pending)) {
    if (consumedUrls.has(entry?.article?.url)) {
      delete state.pending[tweetId];
      consumed += 1;
      continue;
    }
    const published = new Date(entry?.article?.published_at).getTime();
    if (Number.isFinite(published) && published < cutoff) {
      delete state.pending[tweetId];
      expired += 1;
    }
  }
  return { consumed, expired };
}

function selectPendingForReport(state, {
  targetDate, backfillLimit = DAILY_BACKFILL_LIMIT, eligibleSources = null,
}) {
  const entries = Object.entries(state.pending)
    .map(([tweetId, entry]) => ({ tweetId, ...entry }))
    .filter((entry) => !eligibleSources || eligibleSources.has(entry.source));
  const byOldest = (a, b) => String(a.article?.published_at).localeCompare(String(b.article?.published_at))
    || a.tweetId.localeCompare(b.tweetId);
  const current = entries.filter((entry) => entry.origin_report_date === targetDate).sort(byOldest);
  const backfill = entries
    .filter((entry) => entry.origin_report_date < targetDate)
    .sort(byOldest)
    .slice(0, backfillLimit);
  const decorate = (entry, deliveryClass) => ({
    ...entry.article,
    source: entry.source,
    origin_report_date: entry.origin_report_date,
    delivery_class: deliveryClass,
  });
  return {
    current: current.map((entry) => decorate(entry, 'current')),
    backfill: backfill.map((entry) => decorate(entry, 'backfill')),
  };
}

module.exports = {
  STATE_VERSION,
  OVERLAP_HOURS,
  PENDING_RETENTION_DAYS,
  DAILY_BACKFILL_LIMIT,
  emptyTwitterState,
  normalizeTwitterState,
  tweetIdFromArticle,
  consumedUrlsFromHistory,
  ensureAccount,
  incrementalWindow,
  updateLastSeen,
  upsertPending,
  prunePending,
  selectPendingForReport,
};
