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

const { PRIMARY_BLOG_URL_PATTERNS } = require('./enrich');

function makeTwitterSnapshot({ role, expandedUrls }) {
  return {
    sources: {
      'Claude (Twitter)': {
        status: 'ok',
        articles: [
          {
            title: 'announcement',
            url: 'https://x.com/claudeai/status/1',
            published_at: '2026-04-22',
            description: 'Read more: https://t.co/abc',
            expanded_urls: expandedUrls,
            quoted_tweet: null,
            reply_to: null,
          },
        ],
      },
    },
    _role: role,  // test-only convenience
  };
}

test('enrichSnapshot: primary Twitter + matching primary blog URL → linked_content fetched', async () => {
  const snapshot = makeTwitterSnapshot({
    role: 'primary',
    expandedUrls: [{ t_co: 'https://t.co/abc',
      expanded_url: 'https://www.anthropic.com/news/cowork-live-artifacts',
      display_url: 'anthropic.com/news/…' }],
  });
  const calls = [];
  const fetchImpl = async (u) => { calls.push(u); return 'BLOG BODY'; };
  await enrichSnapshot(snapshot,
    [{ name: 'Claude (Twitter)', role: 'primary' }],
    { fetchImpl });
  assert.equal(snapshot.sources['Claude (Twitter)'].articles[0].linked_content, 'BLOG BODY');
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes('www.anthropic.com/news/cowork-live-artifacts'));
});

test('enrichSnapshot: aggregator Twitter is never enriched', async () => {
  const snapshot = makeTwitterSnapshot({
    role: 'aggregator',
    expandedUrls: [{ t_co: 'https://t.co/abc',
      expanded_url: 'https://www.anthropic.com/news/foo',
      display_url: 'anthropic.com/news/…' }],
  });
  let called = false;
  const fetchImpl = async () => { called = true; return 'x'; };
  await enrichSnapshot(snapshot,
    [{ name: 'Claude (Twitter)', role: 'aggregator' }],
    { fetchImpl });
  assert.equal(called, false);
  assert.equal('linked_content' in snapshot.sources['Claude (Twitter)'].articles[0], false);
});

test('enrichSnapshot: primary Twitter with no matching URL → linked_content null', async () => {
  const snapshot = makeTwitterSnapshot({
    role: 'primary',
    expandedUrls: [{ t_co: 'https://t.co/abc',
      expanded_url: 'https://random-blog.example.com/foo',
      display_url: 'random-blog.example.com/foo' }],
  });
  let called = false;
  const fetchImpl = async () => { called = true; return 'x'; };
  await enrichSnapshot(snapshot,
    [{ name: 'Claude (Twitter)', role: 'primary' }],
    { fetchImpl });
  assert.equal(called, false);
  assert.equal(snapshot.sources['Claude (Twitter)'].articles[0].linked_content, null);
});

test('enrichSnapshot: stops at first matching URL (one jina call per tweet)', async () => {
  const snapshot = makeTwitterSnapshot({
    role: 'primary',
    expandedUrls: [
      { t_co: 'a', expanded_url: 'https://www.anthropic.com/news/one', display_url: '' },
      { t_co: 'b', expanded_url: 'https://openai.com/index/two', display_url: '' },
    ],
  });
  const calls = [];
  const fetchImpl = async (u) => { calls.push(u); return 'x'; };
  await enrichSnapshot(snapshot,
    [{ name: 'Claude (Twitter)', role: 'primary' }],
    { fetchImpl });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes('anthropic.com/news/one'));
});

test('PRIMARY_BLOG_URL_PATTERNS matches expected hosts', () => {
  const matchers = PRIMARY_BLOG_URL_PATTERNS;
  const match = (u) => matchers.some((re) => re.test(u));
  assert.ok(match('https://www.anthropic.com/news/foo'));
  assert.ok(match('https://www.anthropic.com/research/bar'));
  assert.ok(match('https://openai.com/index/x'));
  assert.ok(match('https://openai.com/research/y'));
  assert.ok(match('https://openai.com/blog/z'));
  assert.ok(match('https://blog.google/technology/ai/something/'));
  assert.ok(match('https://deepmind.google/discover/blog/foo/'));
  assert.ok(match('https://www.deeplearning.ai/the-batch/issue-350/'));
  assert.equal(match('https://random.example.com/foo'), false);
  assert.equal(match('https://twitter.com/AnthropicAI/status/123'), false);
});
