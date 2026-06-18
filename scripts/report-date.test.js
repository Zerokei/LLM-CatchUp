const test = require('node:test');
const assert = require('node:assert/strict');
const { pacificDayBoundsUtc, previousPacificDate } = require('./lib/report-date');

test('previousPacificDate: resolves to prior Pacific calendar day in standard time', () => {
  const target = previousPacificDate(new Date('2026-01-15T10:37:00Z'));
  const bounds = pacificDayBoundsUtc(target);

  assert.equal(target, '2026-01-14');
  assert.equal(bounds.start.toISOString(), '2026-01-14T08:00:00.000Z');
  assert.equal(bounds.end.toISOString(), '2026-01-15T08:00:00.000Z');
});

test('previousPacificDate: resolves to prior Pacific calendar day in daylight time', () => {
  const target = previousPacificDate(new Date('2026-06-15T09:37:00Z'));
  const bounds = pacificDayBoundsUtc(target);

  assert.equal(target, '2026-06-14');
  assert.equal(bounds.start.toISOString(), '2026-06-14T07:00:00.000Z');
  assert.equal(bounds.end.toISOString(), '2026-06-15T07:00:00.000Z');
});
