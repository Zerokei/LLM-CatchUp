const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  filterAlreadyReported,
  mergeThreads,
  applyDuplicateOf,
  filterByImportance,
  urlHash,
  appendToHistory,
  applyRetention,
} = require('./build-report');

test('urlHash: sha256 hex of URL — 64-char, deterministic, differs per URL', () => {
  assert.match(urlHash('https://example.com/a'), /^[0-9a-f]{64}$/);
  assert.equal(urlHash('https://example.com/a'), urlHash('https://example.com/a'));
  assert.notEqual(urlHash('https://example.com/a'), urlHash('https://example.com/b'));
});

test('filterAlreadyReported: drops articles whose url-hash is in history', () => {
  const history = { articles: { [urlHash('https://example.com/old')]: { title: 'old' } } };
  const input = [
    { url: 'https://example.com/old' },
    { url: 'https://example.com/new' },
  ];
  assert.deepEqual(filterAlreadyReported(input, history).map((a) => a.url),
    ['https://example.com/new']);
});

test('mergeThreads: groups articles with same thread_group_id under the earliest', () => {
  const input = [
    { url: 'https://x.com/a/1', thread_group_id: 't1', published_at: '2026-04-22T10:02Z', summary: 'B', title: 'second' },
    { url: 'https://x.com/a/0', thread_group_id: 't1', published_at: '2026-04-22T10:00Z', summary: 'A', title: 'first' },
    { url: 'https://x.com/a/2', thread_group_id: 't1', published_at: '2026-04-22T10:04Z', summary: 'C', title: 'third' },
    { url: 'https://x.com/b/0', thread_group_id: null, summary: 'D', title: 'standalone' },
  ];
  const out = mergeThreads(input);
  assert.equal(out.length, 2, 'one thread merged + one standalone');
  const thread = out.find((a) => a.url === 'https://x.com/a/0');
  assert.ok(thread, 'canonical is earliest-published article in the thread');
  assert.match(thread.summary, /A[\s\S]*B[\s\S]*C/, 'summaries concatenated in time order');
});

test('applyDuplicateOf: canonical gets also_covered_by entries; duplicates dropped', () => {
  const input = [
    { url: 'https://anthropic.com/news/x', source: 'Anthropic Blog', duplicate_of: null },
    { url: 'https://x.com/AnthropicAI/status/1', source: 'Anthropic (Twitter)', duplicate_of: 'https://anthropic.com/news/x' },
    { url: 'https://deeplearning.ai/the-batch/issue-350', source: 'The Batch', duplicate_of: 'https://anthropic.com/news/x' },
  ];
  const out = applyDuplicateOf(input);
  assert.equal(out.length, 1);
  assert.equal(out[0].url, 'https://anthropic.com/news/x');
  assert.deepEqual(out[0].also_covered_by, ['Anthropic (Twitter)', 'The Batch']);
});

test('filterByImportance: removes articles below threshold', () => {
  const input = [
    { url: '1', importance: 5 },
    { url: '2', importance: 2 },
    { url: '3', importance: 1 },
  ];
  assert.deepEqual(filterByImportance(input, 2).map((a) => a.url), ['1', '2']);
});

test('appendToHistory: adds entries keyed by url-hash, preserves existing', () => {
  const history = { articles: { 'existing-hash': { title: 'old' } } };
  const articles = [
    { url: 'https://example.com/a', title: 'A', source: 'X', published_at: '2026-04-22', summary: 'sA', category: '研究', importance: 3, tags: ['t'] },
    { url: 'https://example.com/b', title: 'B', source: 'X', published_at: '2026-04-22', summary: 'sB', category: '研究', importance: 2, tags: [] },
  ];
  const fetchedAtISO = '2026-04-22T00:09:08Z';
  appendToHistory(history, articles, fetchedAtISO);
  const keys = Object.keys(history.articles);
  assert.equal(keys.length, 3);
  const hashA = urlHash('https://example.com/a');
  assert.equal(history.articles[hashA].title, 'A');
  assert.equal(history.articles[hashA].fetched_at, fetchedAtISO);
  assert.equal(history.articles[hashA].extras.tags.length, 1);
});

test('appendToHistory: stores extras.practice_suggestions when present', () => {
  const history = { articles: {} };
  const articles = [
    { url: '1', title: 't', source: 's', published_at: 'p', summary: 'sx', category: '模型发布', importance: 5, tags: ['a'], practice_suggestions: ['step 1'] },
  ];
  appendToHistory(history, articles, '2026-04-22T00:00:00Z');
  const entry = Object.values(history.articles)[0];
  assert.deepEqual(entry.extras.practice_suggestions, ['step 1']);
});

test('applyRetention: removes entries older than cutoff', () => {
  const history = {
    articles: {
      h1: { fetched_at: '2026-01-01T00:00:00Z' },
      h2: { fetched_at: '2026-04-20T00:00:00Z' },
      h3: { fetched_at: '2026-04-21T00:00:00Z' },
    },
  };
  const now = new Date('2026-04-22T00:00:00Z');
  const removed = applyRetention(history, now, 90);
  assert.equal(removed, 1);
  assert.deepEqual(Object.keys(history.articles).sort(), ['h2', 'h3']);
});
