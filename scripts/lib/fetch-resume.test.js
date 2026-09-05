const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  envFlag,
  sourceNamesNeedingFetch,
  configuredExistingSources,
  mergeApiUsage,
} = require('./fetch-resume');

test('envFlag: accepts GitHub expression booleans', () => {
  assert.equal(envFlag('true'), true);
  assert.equal(envFlag('1'), true);
  assert.equal(envFlag('false'), false);
  assert.equal(envFlag(undefined), false);
});

test('sourceNamesNeedingFetch: a normal run fetches every configured source', () => {
  const names = ['A', 'B'];
  const snapshot = { sources: { A: { status: 'ok' }, B: { status: 'error' } } };
  assert.deepEqual(sourceNamesNeedingFetch(names, snapshot, false), names);
});

test('sourceNamesNeedingFetch: resume fetches only missing and error sources', () => {
  const names = ['healthy', 'stale', 'failed', 'missing'];
  const snapshot = {
    sources: {
      healthy: { status: 'ok' },
      stale: { status: 'degraded_stale' },
      failed: { status: 'error' },
    },
  };
  assert.deepEqual(sourceNamesNeedingFetch(names, snapshot, true), ['failed', 'missing']);
});

test('configuredExistingSources: drops removed sources and preserves configured entries', () => {
  const snapshot = {
    sources: {
      keep: { status: 'ok', articles: [{ url: '1' }] },
      removed: { status: 'ok', articles: [] },
    },
  };
  assert.deepEqual(configuredExistingSources(['keep', 'new'], snapshot), {
    keep: snapshot.sources.keep,
  });
});

test('mergeApiUsage: retry snapshots retain cumulative billable volume', () => {
  assert.deepEqual(
    mergeApiUsage(
      { provider: 'socialdata', method: 'search_incremental_incomplete', requests: 2, returned_tweets: 20 },
      { provider: 'socialdata', method: 'search_incremental', requests: 2, returned_tweets: 25 },
    ),
    {
      provider: 'socialdata', method: 'search_incremental', attempts: 2,
      requests: 4, returned_tweets: 45,
    },
  );
});
