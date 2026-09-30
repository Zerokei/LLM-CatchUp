const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveReportDates } = require('./report-build-dates');
const now = new Date('2026-09-28T15:45:00Z');

test('historical analysis push builds the changed date, not Pacific yesterday', () => {
  assert.deepEqual(resolveReportDates('push', '', ['data/analysis-cache/2026-08-27.json'], now), ['2026-08-27']);
});
test('push handles all changed dates once in chronological order, ignoring chunks', () => {
  assert.deepEqual(resolveReportDates('push', '', [
    'data/analysis-cache/2026-09-28.json', 'data/analysis-cache/2026-09-27.chunk-0.json',
    'data/analysis-cache/2026-09-27.json', 'data/analysis-cache/2026-09-28.json',
    'data/analysis-cache/2026-02-30.json', 'reports/daily/2026-09-26.md',
  ], now), ['2026-09-27', '2026-09-28']);
});
test('manual dispatch preserves explicit date and default Pacific date', () => {
  assert.deepEqual(resolveReportDates('workflow_dispatch', '2026-09-27', [], now), ['2026-09-27']);
  assert.deepEqual(resolveReportDates('workflow_dispatch', '', [], now), ['2026-09-27']);
  assert.throws(() => resolveReportDates('workflow_dispatch', '2026-02-30', [], now), /Invalid/);
});
test('push without final caches never falls back to yesterday', () => {
  assert.deepEqual(resolveReportDates('push', '', ['data/analysis-cache/2026-09-27.chunk-0.json'], now), []);
});
