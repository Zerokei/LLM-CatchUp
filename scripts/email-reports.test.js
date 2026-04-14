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

const { renderMarkdown } = require('./email-reports');

test('renderMarkdown: wraps body in html/head/style/body', () => {
  const html = renderMarkdown('# Hello\n\nworld.');
  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /<style>[\s\S]*font-family[\s\S]*<\/style>/);
  assert.match(html, /<h1[^>]*>Hello<\/h1>/);
  assert.match(html, /<p>world\.<\/p>/);
});

test('renderMarkdown: tables render as <table>', () => {
  const md = '| a | b |\n|---|---|\n| 1 | 2 |';
  const html = renderMarkdown(md);
  assert.match(html, /<table>/);
  assert.match(html, /<th>a<\/th>/);
  assert.match(html, /<td>1<\/td>/);
});

test('renderMarkdown: code blocks preserve content', () => {
  const html = renderMarkdown('```\nfoo = 1\n```');
  assert.match(html, /<pre><code[^>]*>foo = 1\n<\/code><\/pre>/);
});

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { computeBackfillTargets, isoWeekMonday, buildEmailPayload } = require('./email-reports');

test('isoWeekMonday: week 1 of 2021 is Mon 2021-01-04 (Jan 1 was Friday)', () => {
  assert.equal(isoWeekMonday(2021, 1).toISOString(), '2021-01-04T00:00:00.000Z');
});

test('isoWeekMonday: week 1 of 2024 is Mon 2024-01-01 (Jan 1 was Monday — exact match)', () => {
  assert.equal(isoWeekMonday(2024, 1).toISOString(), '2024-01-01T00:00:00.000Z');
});

test('isoWeekMonday: week 1 of 2020 is Mon 2019-12-30 (ISO week 1 crosses year boundary)', () => {
  assert.equal(isoWeekMonday(2020, 1).toISOString(), '2019-12-30T00:00:00.000Z');
});

test('isoWeekMonday: week 53 of 2020 is Mon 2020-12-28 (2020 has 53 ISO weeks)', () => {
  assert.equal(isoWeekMonday(2020, 53).toISOString(), '2020-12-28T00:00:00.000Z');
});

test('isoWeekMonday: week 9 of 2024 is Mon 2024-02-26 (leap-year mid-year sanity)', () => {
  assert.equal(isoWeekMonday(2024, 9).toISOString(), '2024-02-26T00:00:00.000Z');
});

test('computeBackfillTargets: finds files in fixture reports dir', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'catchup-email-'));
  try {
    fs.mkdirSync(path.join(tmp, 'reports/daily'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'reports/monthly'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'reports/daily/2026-04-14.md'), 'x');
    fs.writeFileSync(path.join(tmp, 'reports/daily/2026-04-10.md'), 'x');
    fs.writeFileSync(path.join(tmp, 'reports/daily/2026-04-05.md'), 'x');
    fs.writeFileSync(path.join(tmp, 'reports/monthly/2026-04.md'), 'x');
    fs.writeFileSync(path.join(tmp, 'reports/daily/junk.txt'), 'x'); // should be ignored (not .md pattern match)

    const today = new Date('2026-04-14T00:00:00.000Z');

    // 7-day window: cutoff = 2026-04-07 00:00 UTC.
    // Includes: daily/2026-04-10, daily/2026-04-14.
    // Excludes: daily/2026-04-05 (out), monthly/2026-04 (anchor 2026-04-01 is out), junk.txt (not a recognized path).
    const paths7 = computeBackfillTargets(tmp, today, 7);
    const rel7 = paths7.map((p) => path.relative(tmp, p)).sort();
    assert.deepEqual(rel7, [
      'reports/daily/2026-04-10.md',
      'reports/daily/2026-04-14.md',
    ]);

    // 14-day window: cutoff = 2026-03-31 00:00 UTC. Now all three daily + monthly qualify.
    const paths14 = computeBackfillTargets(tmp, today, 14);
    const rel14 = paths14.map((p) => path.relative(tmp, p)).sort();
    assert.deepEqual(rel14, [
      'reports/daily/2026-04-05.md',
      'reports/daily/2026-04-10.md',
      'reports/daily/2026-04-14.md',
      'reports/monthly/2026-04.md',
    ]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('buildEmailPayload: reads file, derives subject, renders HTML', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'catchup-email-payload-'));
  try {
    fs.mkdirSync(path.join(tmp, 'reports/daily'), { recursive: true });
    const reportPath = path.join(tmp, 'reports/daily/2026-04-14.md');
    fs.writeFileSync(reportPath, '# Hello\n\nworld.');

    const { subject, html } = buildEmailPayload(reportPath, tmp);

    assert.equal(subject, 'CatchUp 日报 2026-04-14');
    assert.match(html, /^<!DOCTYPE html>/);
    assert.match(html, /<h1[^>]*>Hello<\/h1>/);
    assert.match(html, /<p>world\.<\/p>/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('buildEmailPayload: throws clear error when file missing', () => {
  assert.throws(
    () => buildEmailPayload('/nonexistent/path/reports/daily/2099-01-01.md', '/nonexistent/path'),
    /report not found/,
  );
});
