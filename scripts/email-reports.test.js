const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  subjectFromPath,
  representativeDate,
  filterBackfill,
} = require('./email-reports');

test('subjectFromPath: daily', () => {
  assert.equal(subjectFromPath('reports/daily/2026-04-14.md'), 'CatchUp 日报 2026-04-14');
});

test('subjectFromPath: weekly', () => {
  assert.equal(subjectFromPath('reports/weekly/2026-W15.md'), 'CatchUp 周报 2026-W15');
});

test('subjectFromPath: monthly', () => {
  assert.equal(subjectFromPath('reports/monthly/2026-04.md'), 'CatchUp 月报 2026-04');
});

test('subjectFromPath: unrecognized throws', () => {
  assert.throws(() => subjectFromPath('reports/yearly/2026.md'), /unrecognized/);
});

test('representativeDate: daily → that date at UTC midnight', () => {
  const d = representativeDate('reports/daily/2026-04-14.md');
  assert.equal(d.toISOString(), '2026-04-14T00:00:00.000Z');
});

test('representativeDate: monthly → first of month at UTC midnight', () => {
  const d = representativeDate('reports/monthly/2026-04.md');
  assert.equal(d.toISOString(), '2026-04-01T00:00:00.000Z');
});

test('representativeDate: weekly 2026-W15 → Monday 2026-04-06', () => {
  const d = representativeDate('reports/weekly/2026-W15.md');
  assert.equal(d.toISOString(), '2026-04-06T00:00:00.000Z');
});

test('representativeDate: unknown path → null', () => {
  assert.equal(representativeDate('reports/yearly/2026.md'), null);
});

test('filterBackfill: includes daily within window', () => {
  const today = new Date('2026-04-14T00:00:00.000Z');
  const paths = [
    'reports/daily/2026-04-14.md',
    'reports/daily/2026-04-10.md',
    'reports/daily/2026-04-06.md',
  ];
  const filtered = filterBackfill(paths, today, 7);
  assert.deepEqual(filtered.sort(), [
    'reports/daily/2026-04-10.md',
    'reports/daily/2026-04-14.md',
  ].sort());
});

test('filterBackfill: window includes today exactly', () => {
  const today = new Date('2026-04-14T00:00:00.000Z');
  const filtered = filterBackfill(['reports/daily/2026-04-14.md'], today, 0);
  assert.deepEqual(filtered, ['reports/daily/2026-04-14.md']);
});

test('filterBackfill: mixed cadences', () => {
  const today = new Date('2026-04-14T00:00:00.000Z');
  const paths = [
    'reports/daily/2026-04-14.md',
    'reports/weekly/2026-W15.md',
    'reports/weekly/2026-W13.md',
    'reports/monthly/2026-04.md',
  ];
  const filtered = filterBackfill(paths, today, 14);
  assert.deepEqual(filtered.sort(), [
    'reports/daily/2026-04-14.md',
    'reports/monthly/2026-04.md',
    'reports/weekly/2026-W15.md',
  ].sort());
});

test('filterBackfill: unrecognized paths are dropped silently', () => {
  const today = new Date('2026-04-14T00:00:00.000Z');
  const filtered = filterBackfill(['reports/yearly/2026.md', 'reports/daily/2026-04-14.md'], today, 7);
  assert.deepEqual(filtered, ['reports/daily/2026-04-14.md']);
});
