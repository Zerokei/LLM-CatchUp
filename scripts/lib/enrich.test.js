const { test } = require('node:test');
const assert = require('node:assert/strict');
const { jinaFetch } = require('./enrich');
const { enrichSnapshot, BLOG_ENRICH_SOURCES } = require('./enrich');

function makeSnapshot(extra = {}) {
  return {
    sources: {
      'OpenAI Blog': {
        status: 'ok',
        articles: [
          { title: 'hello', url: 'https://openai.com/index/hello',
            published_at: '2026-04-22', description: 'short' },
        ],
      },
      'Sam Altman (Twitter)': {
        status: 'ok',
        articles: [
          { title: 'tweet', url: 'https://x.com/sama/status/1',
            published_at: '2026-04-22', description: 'tweet text' },
        ],
      },
      ...extra,
    },
  };
}

// The default fetch function goes through the real Jina URL via the project's
// fetchText helper. For unit tests we inject a stub via the second arg.

test('jinaFetch: returns text on success, truncated to MAX_CHARS', async () => {
  const big = 'x'.repeat(30_000);
  const fetchStub = async (url) => {
    assert.ok(url.startsWith('https://r.jina.ai/'), 'uses jina base');
    return big;
  };
  const out = await jinaFetch('https://openai.com/index/foo', { fetchImpl: fetchStub });
  assert.equal(out.length, 20_000);
});

test('jinaFetch: returns null on fetch error (does not throw)', async () => {
  const fetchStub = async () => { throw new Error('HTTP 403'); };
  const out = await jinaFetch('https://openai.com/index/foo', { fetchImpl: fetchStub });
  assert.equal(out, null);
});

test('jinaFetch: returns null on timeout', async () => {
  const fetchStub = async () => { throw new Error('timeout after 20s'); };
  const out = await jinaFetch('https://openai.com/index/foo', { fetchImpl: fetchStub });
  assert.equal(out, null);
});

test('enrichSnapshot: blog source gets full_text, Twitter source untouched', async () => {
  const snapshot = makeSnapshot();
  const calls = [];
  const fetchImpl = async (u) => { calls.push(u); return 'ENRICHED BODY'; };
  await enrichSnapshot(snapshot, /* sourceConfigs */ [
    { name: 'OpenAI Blog', role: 'primary' },
    { name: 'Sam Altman (Twitter)', role: 'aggregator' },
  ], { fetchImpl });
  assert.equal(snapshot.sources['OpenAI Blog'].articles[0].full_text, 'ENRICHED BODY');
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes('/openai.com/index/hello'));
  assert.equal('full_text' in snapshot.sources['Sam Altman (Twitter)'].articles[0], false);
});

test('enrichSnapshot: blog fetch failure → full_text null (no throw)', async () => {
  const snapshot = makeSnapshot();
  const fetchImpl = async () => { throw new Error('HTTP 403'); };
  await enrichSnapshot(snapshot, [{ name: 'OpenAI Blog', role: 'primary' }], { fetchImpl });
  assert.equal(snapshot.sources['OpenAI Blog'].articles[0].full_text, null);
});

test('enrichSnapshot: source with status error is skipped (no fetch, no full_text)', async () => {
  const snapshot = {
    sources: {
      'OpenAI Blog': {
        status: 'error', error: 'HTTP 500',
        articles: [],  // real shape has empty articles on error
      },
    },
  };
  let called = false;
  const fetchImpl = async () => { called = true; return 'x'; };
  await enrichSnapshot(snapshot, [{ name: 'OpenAI Blog', role: 'primary' }], { fetchImpl });
  assert.equal(called, false);
});

test('BLOG_ENRICH_SOURCES: exactly the five blog sources in the spec', () => {
  assert.deepEqual([...BLOG_ENRICH_SOURCES].sort(), [
    'Anthropic Blog', 'Anthropic Research', 'Google AI Blog', 'OpenAI Blog', 'The Batch',
  ]);
});
