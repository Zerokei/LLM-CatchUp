const { test } = require('node:test');
const assert = require('node:assert/strict');
const { updateSourceHealth } = require('./health');

const NOW = '2026-04-22T00:09:08Z';
const THRESHOLD = 3;

test('ok status → healthy, consecutive_failures reset', () => {
  const prior = { status: 'degraded', last_success: '2026-04-18T00:00:00Z', consecutive_failures: 2, last_error: 'old error' };
  const fc = { status: 'ok', error: null };
  const next = updateSourceHealth(prior, fc, NOW, THRESHOLD);
  assert.deepEqual(next, {
    status: 'healthy', last_success: NOW, consecutive_failures: 0, last_error: null,
  });
});

test('error status → degraded when below threshold, increments failures, copies error', () => {
  const prior = { status: 'healthy', last_success: '2026-04-20T00:00:00Z', consecutive_failures: 0, last_error: null };
  const fc = { status: 'error', error: 'HTTP 500' };
  const next = updateSourceHealth(prior, fc, NOW, THRESHOLD);
  assert.deepEqual(next, {
    status: 'degraded', last_success: '2026-04-20T00:00:00Z', consecutive_failures: 1, last_error: 'HTTP 500',
  });
});

test('error status → alert when failures reach threshold', () => {
  const prior = { status: 'degraded', last_success: '2026-04-19T00:00:00Z', consecutive_failures: 2, last_error: 'HTTP 500' };
  const fc = { status: 'error', error: 'HTTP 500' };
  const next = updateSourceHealth(prior, fc, NOW, THRESHOLD);
  assert.equal(next.status, 'alert');
  assert.equal(next.consecutive_failures, 3);
});

test('degraded_stale status is treated like error (increments + eventually alerts)', () => {
  const prior = { status: 'healthy', last_success: '2026-04-20T00:00:00Z', consecutive_failures: 0, last_error: null };
  const fc = { status: 'degraded_stale', error: 'newest item is 823h old' };
  const next = updateSourceHealth(prior, fc, NOW, THRESHOLD);
  assert.equal(next.status, 'degraded');
  assert.equal(next.consecutive_failures, 1);
  assert.equal(next.last_error, 'newest item is 823h old');
});

test('missing prior entry (new source) is treated as healthy baseline', () => {
  const fc = { status: 'ok', error: null };
  const next = updateSourceHealth(undefined, fc, NOW, THRESHOLD);
  assert.deepEqual(next, {
    status: 'healthy', last_success: NOW, consecutive_failures: 0, last_error: null,
  });
});
