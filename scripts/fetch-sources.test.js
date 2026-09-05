const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  latestSuccessfulCoverage, latestPublishedForSource, twitterStatus,
} = require('./fetch-sources');

test('latestSuccessfulCoverage bootstraps from the newest non-error snapshot', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catchup-twitter-'));
  try {
    fs.writeFileSync(path.join(dir, '2026-09-01.json'), JSON.stringify({
      window_end: '2026-09-02T07:00:00Z', sources: { X: { status: 'ok' } },
    }));
    fs.writeFileSync(path.join(dir, '2026-09-02.json'), JSON.stringify({
      window_end: '2026-09-03T07:00:00Z', sources: { X: { status: 'error' } },
    }));
    assert.equal(
      latestSuccessfulCoverage(dir, 'X', new Date('2026-09-05T07:00:00Z')),
      '2026-09-02T07:00:00.000Z',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('twitterStatus treats an empty incremental Search as healthy without a stale baseline', () => {
  assert.deepEqual(
    twitterStatus({ last_seen_published_at: null }, { max_silence_hours: 168 }, new Date()),
    { status: 'ok', error: null },
  );
});

test('latestPublishedForSource bootstraps freshness independently from the fetch watermark', () => {
  const history = { articles: {
    a: { source: 'X', published_at: '2026-09-01T00:00:00Z' },
    b: { source: 'X', published_at: '2026-09-03T00:00:00Z' },
    c: { source: 'Y', published_at: '2026-09-04T00:00:00Z' },
  } };
  assert.equal(latestPublishedForSource(history, 'X'), '2026-09-03T00:00:00.000Z');
});

test('twitterStatus uses persisted last-seen time', () => {
  const end = new Date('2026-09-05T00:00:00Z');
  assert.equal(twitterStatus({
    last_seen_published_at: '2026-08-01T00:00:00Z',
  }, { max_silence_hours: 168 }, end).status, 'degraded_stale');
});
