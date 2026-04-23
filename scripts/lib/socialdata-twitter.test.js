const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mapTweetsToArticles } = require('./socialdata-twitter');

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
