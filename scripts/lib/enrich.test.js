const { test } = require('node:test');
const assert = require('node:assert/strict');
const { jinaFetch } = require('./enrich');

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
