const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extractHandleFromUrl } = require('./derive-refs');

test('extractHandleFromUrl: tweet URL returns handle', () => {
  assert.equal(extractHandleFromUrl('https://x.com/sama/status/123'), 'sama');
});

test('extractHandleFromUrl: case preserved', () => {
  assert.equal(extractHandleFromUrl('https://x.com/OpenAIDevs/status/456'), 'OpenAIDevs');
});

test('extractHandleFromUrl: non-tweet URL returns null', () => {
  assert.equal(extractHandleFromUrl('https://openai.com/blog/xyz'), null);
});

test('extractHandleFromUrl: malformed input returns null', () => {
  assert.equal(extractHandleFromUrl(''), null);
  assert.equal(extractHandleFromUrl(null), null);
});

const { computeThreadGroups } = require('./derive-refs');

const fxArticle = (over) => ({
  url: over.url,
  published_at: over.published_at,
  reply_to: over.reply_to || null,
});

test('computeThreadGroups: isolated tweet gets no group', () => {
  const articles = [
    fxArticle({ url: 'https://x.com/sama/status/1', published_at: '2026-04-24T10:00:00Z' }),
  ];
  assert.equal(computeThreadGroups(articles).size, 0);
});

test('computeThreadGroups: self-reply within 5min groups with parent', () => {
  const articles = [
    fxArticle({ url: 'https://x.com/sama/status/1', published_at: '2026-04-24T10:00:00Z' }),
    fxArticle({
      url: 'https://x.com/sama/status/2',
      published_at: '2026-04-24T10:03:00Z',
      reply_to: { screen_name: 'sama', status_id: '1' },
    }),
  ];
  const g = computeThreadGroups(articles);
  assert.equal(g.size, 2);
  const id = g.get('https://x.com/sama/status/1');
  assert.equal(id, 'thread-sama-20260424-1000');
  assert.equal(g.get('https://x.com/sama/status/2'), id);
});

test('computeThreadGroups: self-reply > 5min does NOT group', () => {
  const articles = [
    fxArticle({ url: 'https://x.com/sama/status/1', published_at: '2026-04-24T10:00:00Z' }),
    fxArticle({
      url: 'https://x.com/sama/status/2',
      published_at: '2026-04-24T10:06:00Z',
      reply_to: { screen_name: 'sama', status_id: '1' },
    }),
  ];
  assert.equal(computeThreadGroups(articles).size, 0);
});

test('computeThreadGroups: reply to ANOTHER account does NOT group', () => {
  const articles = [
    fxArticle({ url: 'https://x.com/sama/status/1', published_at: '2026-04-24T10:00:00Z' }),
    fxArticle({
      url: 'https://x.com/pg/status/99',
      published_at: '2026-04-24T10:03:00Z',
      reply_to: { screen_name: 'sama', status_id: '1' },
    }),
  ];
  assert.equal(computeThreadGroups(articles).size, 0);
});

test('computeThreadGroups: case-insensitive handle match', () => {
  const articles = [
    fxArticle({ url: 'https://x.com/OpenAIDevs/status/1', published_at: '2026-04-24T10:00:00Z' }),
    fxArticle({
      url: 'https://x.com/OpenAIDevs/status/2',
      published_at: '2026-04-24T10:02:00Z',
      reply_to: { screen_name: 'openaidevs', status_id: '1' },
    }),
  ];
  assert.equal(computeThreadGroups(articles).size, 2);
});

test('computeThreadGroups: 3-message chain all grouped if each link ≤5min', () => {
  const articles = [
    fxArticle({ url: 'https://x.com/sama/status/1', published_at: '2026-04-24T10:00:00Z' }),
    fxArticle({
      url: 'https://x.com/sama/status/2',
      published_at: '2026-04-24T10:03:00Z',
      reply_to: { screen_name: 'sama', status_id: '1' },
    }),
    fxArticle({
      url: 'https://x.com/sama/status/3',
      published_at: '2026-04-24T10:07:00Z',
      reply_to: { screen_name: 'sama', status_id: '2' },
    }),
  ];
  const g = computeThreadGroups(articles);
  assert.equal(g.size, 3);
  const id = g.get('https://x.com/sama/status/1');
  assert.equal(g.get('https://x.com/sama/status/2'), id);
  assert.equal(g.get('https://x.com/sama/status/3'), id);
});

test('computeThreadGroups: orphan reply (parent not in batch) is own root', () => {
  const articles = [
    fxArticle({
      url: 'https://x.com/sama/status/2',
      published_at: '2026-04-24T10:03:00Z',
      reply_to: { screen_name: 'sama', status_id: '999-not-in-batch' },
    }),
  ];
  assert.equal(computeThreadGroups(articles).size, 0);
});
