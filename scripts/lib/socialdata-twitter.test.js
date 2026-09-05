const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  makeTwitterRoute,
  mapTweetsToArticles,
  isLowSignalTweet,
  makeSearchUrl,
} = require('./socialdata-twitter');

// One raw socialdata tweet covering the "announcement + linked blog" pattern.
const TWEET_WITH_URL_AND_QUOTE = {
  id_str: '2046227759475921291',
  full_text: '🚀 Introducing Qwen3.6-Max-Preview\nBlog: https://t.co/6hDQJhmkjM',
  tweet_created_at: '2026-04-20T14:01:29.000Z',
  user: { screen_name: 'Alibaba_Qwen' },
  entities: {
    urls: [
      { url: 'https://t.co/6hDQJhmkjM',
        expanded_url: 'https://qwenlm.github.io/blog/qwen3.6-max/',
        display_url: 'qwenlm.github.io/blog/qwen3.6-m…' },
    ],
    user_mentions: [], hashtags: [], symbols: [],
  },
  is_quote_status: true,
  quoted_status: {
    id_str: '123456',
    full_text: 'Scale matters.',
    user: { screen_name: 'someoneelse' },
  },
  in_reply_to_status_id_str: null,
  in_reply_to_screen_name: null,
};

const TWEET_PLAIN = {
  id_str: '111',
  full_text: 'just a tweet',
  tweet_created_at: '2026-04-20T12:00:00.000Z',
  user: { screen_name: 'sama' },
  entities: { urls: [], user_mentions: [], hashtags: [], symbols: [] },
  is_quote_status: false,
  quoted_status: null,
  in_reply_to_status_id_str: null,
  in_reply_to_screen_name: null,
};

const TWEET_REPLY = {
  id_str: '222',
  full_text: 'yes exactly',
  tweet_created_at: '2026-04-20T13:00:00.000Z',
  user: { screen_name: 'sama' },
  entities: { urls: [], user_mentions: [], hashtags: [], symbols: [] },
  is_quote_status: false,
  quoted_status: null,
  in_reply_to_status_id_str: '2046000000000000000',
  in_reply_to_screen_name: 'pg',
};

test('mapTweetsToArticles: preserves expanded_urls', () => {
  const [a] = mapTweetsToArticles([TWEET_WITH_URL_AND_QUOTE], 'Alibaba_Qwen');
  assert.deepEqual(a.expanded_urls, [
    { t_co: 'https://t.co/6hDQJhmkjM',
      expanded_url: 'https://qwenlm.github.io/blog/qwen3.6-max/',
      display_url: 'qwenlm.github.io/blog/qwen3.6-m…' },
  ]);
});

test('mapTweetsToArticles: preserves quoted_tweet when is_quote_status', () => {
  const [a] = mapTweetsToArticles([TWEET_WITH_URL_AND_QUOTE], 'Alibaba_Qwen');
  assert.deepEqual(a.quoted_tweet, {
    author: 'someoneelse',
    text: 'Scale matters.',
    url: 'https://x.com/someoneelse/status/123456',
  });
});

test('mapTweetsToArticles: quoted_tweet is null when not a quote-tweet', () => {
  const [a] = mapTweetsToArticles([TWEET_PLAIN], 'sama');
  assert.equal(a.quoted_tweet, null);
});

test('mapTweetsToArticles: reply_to set when in_reply_to_status_id_str present', () => {
  const [a] = mapTweetsToArticles([TWEET_REPLY], 'sama');
  assert.deepEqual(a.reply_to, { screen_name: 'pg', status_id: '2046000000000000000' });
});

test('mapTweetsToArticles: reply_to is null for non-reply tweets', () => {
  const [a] = mapTweetsToArticles([TWEET_PLAIN], 'sama');
  assert.equal(a.reply_to, null);
});

test('mapTweetsToArticles: existing fields (title, url, description, published_at) unchanged', () => {
  const [a] = mapTweetsToArticles([TWEET_PLAIN], 'sama');
  assert.equal(a.title, 'just a tweet');
  assert.equal(a.url, 'https://x.com/sama/status/111');
  assert.equal(a.description, 'just a tweet');
  assert.equal(a.published_at, '2026-04-20T12:00:00.000Z');
});

test('isLowSignalTweet: drops pure RT', () => {
  const a = { description: 'RT @someone: cool thing', reply_to: null };
  assert.equal(isLowSignalTweet(a, 'sama'), true);
});

test('isLowSignalTweet: keeps originals', () => {
  const a = { description: 'hello world', reply_to: null };
  assert.equal(isLowSignalTweet(a, 'sama'), false);
});

test('isLowSignalTweet: drops replies to OTHER accounts', () => {
  const a = { description: 'yes', reply_to: { screen_name: 'pg', status_id: '1' } };
  assert.equal(isLowSignalTweet(a, 'sama'), true);
});

test('isLowSignalTweet: drops self-replies too', () => {
  const a = { description: 'and another thing', reply_to: { screen_name: 'sama', status_id: '1' } };
  assert.equal(isLowSignalTweet(a, 'sama'), true);
});

test('isLowSignalTweet: drops self-replies regardless of handle casing', () => {
  const a = { description: 'continued', reply_to: { screen_name: 'OpenAIDevs', status_id: '1' } };
  assert.equal(isLowSignalTweet(a, 'openaidevs'), true);
});

function tweet(id, createdAt, overrides = {}) {
  return {
    id_str: String(id),
    full_text: `tweet ${id}`,
    tweet_created_at: createdAt,
    user: { screen_name: 'example' },
    entities: { urls: [] },
    is_quote_status: false,
    quoted_status: null,
    in_reply_to_status_id_str: null,
    in_reply_to_screen_name: null,
    ...overrides,
  };
}

function withApiKey(fn) {
  const previous = process.env.SOCIALDATA_API_KEY;
  process.env.SOCIALDATA_API_KEY = 'test-key';
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (previous == null) delete process.env.SOCIALDATA_API_KEY;
      else process.env.SOCIALDATA_API_KEY = previous;
    });
}

const WINDOW_START = new Date('2026-08-12T07:00:00.000Z');
const WINDOW_END = new Date('2026-08-13T07:00:00.000Z');

test('makeSearchUrl: constrains the query to the requested incremental range', () => {
  const url = new URL(makeSearchUrl('OpenAI', WINDOW_START, WINDOW_END, 'cursor value'));
  assert.equal(url.pathname, '/twitter/search');
  assert.equal(url.searchParams.get('query'),
    'from:OpenAI -filter:replies since_time:1786518000 until_time:1786604400');
  assert.equal(url.searchParams.get('type'), 'Latest');
  assert.equal(url.searchParams.get('cursor'), 'cursor value');
});

test('makeTwitterRoute: paginates the complete search window and deduplicates tweets', () => withApiKey(async () => {
  const calls = [];
  const first = tweet('1', '2026-08-12T08:00:00.000Z');
  const selfReply = tweet('2', '2026-08-12T08:02:00.000Z', {
    in_reply_to_status_id_str: '1', in_reply_to_screen_name: 'example',
  });
  const fetchImpl = async (url, options) => {
    calls.push(url);
    assert.equal(options.timeoutMs, 15_000);
    assert.equal(options.maxAttempts, 1);
    assert.ok(options.signal instanceof AbortSignal);
    const cursor = new URL(url).searchParams.get('cursor');
    if (!cursor) return JSON.stringify({ tweets: [first, selfReply], next_cursor: 'next page' });
    assert.equal(cursor, 'next page');
    return JSON.stringify({
      tweets: [selfReply, tweet('3', '2026-08-12T09:00:00.000Z')],
      next_cursor: null,
    });
  };
  const route = makeTwitterRoute({
    name: 'Example (Twitter)', handle: 'example', userId: '123', fetchImpl,
  });
  const result = await route.fetch({ windowStart: WINDOW_START, windowEnd: WINDOW_END });

  assert.equal(result.error, null);
  assert.equal(result.usage.method, 'search_incremental');
  assert.equal(result.usage.requests, 2);
  assert.equal(result.usage.returned_tweets, 4, 'billing count includes duplicates returned by API');
  assert.deepEqual(result.articles.map((article) => article.url), [
    'https://x.com/example/status/1',
    'https://x.com/example/status/3',
  ]);
  assert.equal(calls.length, 2);
}));

test('makeTwitterRoute: accepts an empty Search result without calling timeline', () => withApiKey(async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return JSON.stringify({ tweets: [], next_cursor: null });
  };
  const route = makeTwitterRoute({
    name: 'Example (Twitter)', handle: 'example', userId: '123', fetchImpl,
  });
  const result = await route.fetch({ windowStart: WINDOW_START, windowEnd: WINDOW_END });

  assert.equal(result.error, null);
  assert.equal(result.usage.method, 'search_incremental');
  assert.equal(result.usage.requests, 1);
  assert.equal(result.usage.returned_tweets, 0);
  assert.deepEqual(result.articles, []);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]).pathname, '/twitter/search');
}));

test('makeTwitterRoute: does not silently fall back after partial search pagination', () => withApiKey(async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const cursor = new URL(url).searchParams.get('cursor');
    if (!cursor) {
      return JSON.stringify({
        tweets: [tweet('1', '2026-08-12T08:00:00.000Z')],
        next_cursor: 'page-2',
      });
    }
    throw new Error('temporary failure');
  };
  const route = makeTwitterRoute({
    name: 'Example (Twitter)', handle: 'example', userId: '123', fetchImpl,
  });
  const result = await route.fetch({ windowStart: WINDOW_START, windowEnd: WINDOW_END });

  assert.match(result.error, /search_incremental failed/);
  assert.equal(result.usage.method, 'search_incremental_incomplete');
  assert.equal(result.usage.requests, 2);
  assert.equal(result.usage.returned_tweets, 1);
  assert.equal(calls.some((url) => new URL(url).pathname.includes('/twitter/user/')), false);
}));

test('makeTwitterRoute: repeated Search cursor is an incomplete fetch', () => withApiKey(async () => {
  const fetchImpl = async () => JSON.stringify({
    tweets: [tweet('1', '2026-08-12T08:00:00.000Z')],
    next_cursor: 'same-cursor',
  });
  const route = makeTwitterRoute({
    name: 'Example (Twitter)', handle: 'example', userId: '123', fetchImpl,
  });
  const result = await route.fetch({ windowStart: WINDOW_START, windowEnd: WINDOW_END });
  assert.match(result.error, /repeated cursor/);
  assert.equal(result.usage.method, 'search_incremental_incomplete');
}));

test('makeTwitterRoute: request timeout fails without an inline retry', () => withApiKey(async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    const error = new Error('timeout after 15s');
    error.name = 'TimeoutError';
    throw error;
  };
  const route = makeTwitterRoute({
    name: 'Example (Twitter)', handle: 'example', userId: '123', fetchImpl,
  });
  const result = await route.fetch({ windowStart: WINDOW_START, windowEnd: WINDOW_END });
  assert.match(result.error, /timeout after 15s/);
  assert.equal(result.usage.method, 'search_incremental_failed');
  assert.equal(calls, 1);
}));

test('makeTwitterRoute: uses timeline only when explicitly requested', () => withApiKey(async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const parsed = new URL(url);
    assert.match(parsed.pathname, /\/twitter\/user\/123\/tweets/);
    return JSON.stringify({
      tweets: [tweet('1', '2026-08-12T08:00:00.000Z')],
      next_cursor: null,
    });
  };
  const route = makeTwitterRoute({
    name: 'Example (Twitter)', handle: 'example', userId: '123', fetchImpl,
  });
  const result = await route.fetch({
    windowStart: WINDOW_START, windowEnd: WINDOW_END, mode: 'timeline',
  });

  assert.equal(result.error, null);
  assert.equal(result.usage.method, 'timeline_incremental');
  assert.equal(result.usage.requests, 1);
  assert.equal(calls.length, 1);
}));

test('makeTwitterRoute: explicit timeline mode filters returned tweets to the requested range', () => withApiKey(async () => {
  const fetchImpl = async () => JSON.stringify({
    tweets: [
      tweet('old', '2026-08-11T06:00:00.000Z'),
      tweet('target', '2026-08-12T08:00:00.000Z'),
      tweet('future', '2026-08-13T08:00:00.000Z'),
    ],
    next_cursor: null,
  });
  const route = makeTwitterRoute({
    name: 'Example (Twitter)', handle: 'example', userId: '123', fetchImpl,
  });
  const result = await route.fetch({
    windowStart: WINDOW_START, windowEnd: WINDOW_END, mode: 'timeline',
  });
  assert.equal(result.error, null);
  assert.equal(result.usage.method, 'timeline_incremental');
  assert.deepEqual(result.articles.map((article) => article.tweet_id), ['target']);
  assert.equal(result.newest_returned_at, '2026-08-12T08:00:00.000Z');
}));
