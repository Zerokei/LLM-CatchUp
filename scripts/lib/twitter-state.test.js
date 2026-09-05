const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  emptyTwitterState,
  consumedUrlsFromHistory,
  incrementalWindow,
  upsertPending,
  prunePending,
  selectPendingForReport,
} = require('./twitter-state');

function article(id, publishedAt, extra = {}) {
  return {
    tweet_id: id,
    url: `https://x.com/example/status/${id}`,
    published_at: publishedAt,
    title: `tweet ${id}`,
    ...extra,
  };
}

test('incrementalWindow overlaps a valid watermark by 48 hours', () => {
  const account = { covered_through: '2026-09-03T07:00:00.000Z' };
  const result = incrementalWindow(
    account,
    new Date('2026-09-04T07:00:00.000Z'),
    new Date('2026-09-05T07:00:00.000Z'),
  );
  assert.equal(result.start.toISOString(), '2026-09-01T07:00:00.000Z');
  assert.equal(result.end.toISOString(), '2026-09-05T07:00:00.000Z');
  assert.equal(result.advancesWatermark, true);
});

test('incrementalWindow starts 48 hours before the target window without history', () => {
  const result = incrementalWindow(
    { covered_through: null },
    new Date('2026-09-04T07:00:00.000Z'),
    new Date('2026-09-05T07:00:00.000Z'),
  );
  assert.equal(result.start.toISOString(), '2026-09-02T07:00:00.000Z');
  assert.equal(result.advancesWatermark, true);
});

test('incrementalWindow uses exact fallback for historical replay without moving a newer watermark', () => {
  const account = { covered_through: '2026-09-05T07:00:00.000Z' };
  const result = incrementalWindow(
    account,
    new Date('2026-09-01T07:00:00.000Z'),
    new Date('2026-09-02T07:00:00.000Z'),
  );
  assert.equal(result.start.toISOString(), '2026-09-01T07:00:00.000Z');
  assert.equal(result.advancesWatermark, false);
});

test('consumedUrlsFromHistory includes canonical, thread, and cluster member URLs', () => {
  const result = consumedUrlsFromHistory({ articles: { h: {
    url: 'canonical',
    report_date: '2026-09-04',
    extras: { thread_urls: ['thread'], cluster_members: [{ url: 'cluster' }] },
  }, fallback: { url: 'not-formally-consumed' } } });
  assert.deepEqual([...result].sort(), ['canonical', 'cluster', 'thread']);
});

test('upsertPending deduplicates tweet IDs and preserves richer existing fields', () => {
  const state = emptyTwitterState();
  upsertPending(state, {
    source: 'Example (Twitter)',
    articles: [article('1', '2026-09-04T10:00:00Z', { linked_content: 'rich' })],
    firstSeenAt: '2026-09-05T08:00:00Z',
    discoveryMethod: 'incremental_search',
  });
  upsertPending(state, {
    source: 'Example (Twitter)',
    articles: [article('1', '2026-09-04T10:00:00Z', { linked_content: null, title: 'short' })],
    firstSeenAt: '2026-09-06T08:00:00Z',
    discoveryMethod: 'timeline_incremental',
  });
  assert.equal(Object.keys(state.pending).length, 1);
  assert.equal(state.pending['1'].first_seen_at, '2026-09-05T08:00:00Z');
  assert.equal(state.pending['1'].discovery_method, 'incremental_search');
  assert.equal(state.pending['1'].article.linked_content, 'rich');
  assert.equal(state.pending['1'].article.title, 'tweet 1');
});

test('upsertPending keeps distinct tweets published in the same second', () => {
  const state = emptyTwitterState();
  upsertPending(state, {
    source: 'Example (Twitter)',
    articles: [
      article('1', '2026-09-04T10:00:00Z'),
      article('2', '2026-09-04T10:00:00Z'),
    ],
    firstSeenAt: '2026-09-05T08:00:00Z',
    discoveryMethod: 'incremental_search',
  });
  assert.deepEqual(Object.keys(state.pending).sort(), ['1', '2']);
});

test('prunePending removes formally consumed and more-than-30-day-old items', () => {
  const state = emptyTwitterState();
  state.pending = {
    used: { article: article('1', '2026-09-01T00:00:00Z') },
    old: { article: article('2', '2026-07-01T00:00:00Z') },
    keep: { article: article('3', '2026-09-02T00:00:00Z') },
  };
  const result = prunePending(state, {
    consumedUrls: new Set([state.pending.used.article.url]),
    now: new Date('2026-09-05T00:00:00Z'),
  });
  assert.deepEqual(result, { consumed: 1, expired: 1 });
  assert.deepEqual(Object.keys(state.pending), ['keep']);
});

test('selectPendingForReport keeps all current items and only ten oldest backfills', () => {
  const state = emptyTwitterState();
  for (let i = 1; i <= 12; i += 1) {
    const id = String(i);
    state.pending[id] = {
      source: 'Example (Twitter)',
      origin_report_date: '2026-09-03',
      article: article(id, `2026-09-03T${String(i).padStart(2, '0')}:00:00Z`),
    };
  }
  state.pending.current = {
    source: 'Example (Twitter)',
    origin_report_date: '2026-09-04',
    article: article('99', '2026-09-04T01:00:00Z'),
  };
  const result = selectPendingForReport(state, { targetDate: '2026-09-04' });
  assert.equal(result.current.length, 1);
  assert.equal(result.backfill.length, 10);
  assert.equal(result.backfill[0].tweet_id, '1');
  assert.equal(result.backfill[9].tweet_id, '10');
  assert.ok(result.backfill.every((a) => a.delivery_class === 'backfill'));
});

test('selectPendingForReport excludes failed sources before applying the backfill quota', () => {
  const state = emptyTwitterState();
  state.pending.failed = {
    source: 'failed', origin_report_date: '2026-09-01', article: article('1', '2026-09-01T00:00:00Z'),
  };
  state.pending.healthy = {
    source: 'healthy', origin_report_date: '2026-09-02', article: article('2', '2026-09-02T00:00:00Z'),
  };
  const result = selectPendingForReport(state, {
    targetDate: '2026-09-05', eligibleSources: new Set(['healthy']),
  });
  assert.deepEqual(result.backfill.map((entry) => entry.source), ['healthy']);
});
