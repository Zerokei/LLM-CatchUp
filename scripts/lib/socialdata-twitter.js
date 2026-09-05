const { fetchText } = require('./http');

const BASE = 'https://api.socialdata.tools';

function asValidDate(value, label) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`socialdata-twitter: invalid ${label}`);
  }
  return date;
}

function tweetDate(tweet) {
  if (!tweet?.tweet_created_at) return null;
  const date = new Date(tweet.tweet_created_at);
  return Number.isNaN(date.getTime()) ? null : date;
}

function tweetId(tweet) {
  const value = tweet?.id_str ?? tweet?.id;
  return value == null ? null : String(value);
}

function dedupeTweets(tweets) {
  const seen = new Set();
  const deduped = [];
  for (const tweet of tweets) {
    const id = tweetId(tweet);
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    deduped.push(tweet);
  }
  return deduped;
}

function parseTweetPage(body) {
  const data = JSON.parse(body);
  if (!Array.isArray(data.tweets)) {
    throw new Error('socialdata-twitter: response missing tweets[]');
  }
  return data;
}

function authHeaders(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
  };
}

function makeSearchUrl(handle, windowStart, windowEnd, cursor) {
  const startSeconds = Math.floor(windowStart.getTime() / 1000);
  const endSeconds = Math.floor(windowEnd.getTime() / 1000);
  const query = `from:${handle} -filter:replies since_time:${startSeconds} until_time:${endSeconds}`;
  const url = new URL(`${BASE}/twitter/search`);
  url.searchParams.set('query', query);
  url.searchParams.set('type', 'Latest');
  if (cursor) url.searchParams.set('cursor', cursor);
  return url.toString();
}

function makeTimelineUrl(userId, cursor) {
  const url = new URL(`${BASE}/twitter/user/${userId}/tweets`);
  if (cursor) url.searchParams.set('cursor', cursor);
  return url.toString();
}

async function fetchSearchWindow({ handle, apiKey, windowStart, windowEnd, fetchImpl }) {
  const tweets = [];
  const seenCursors = new Set();
  let cursor = null;
  let requests = 0;

  while (true) {
    let data;
    try {
      const body = await fetchImpl(makeSearchUrl(handle, windowStart, windowEnd, cursor), {
        headers: authHeaders(apiKey),
      });
      data = parseTweetPage(body);
    } catch (err) {
      err.completedPages = requests;
      err.attemptedRequests = requests + 1;
      err.returnedTweets = tweets.length;
      throw err;
    }

    requests += 1;
    tweets.push(...data.tweets);
    const nextCursor = data.next_cursor || null;
    if (!nextCursor) break;
    if (seenCursors.has(nextCursor)) {
      const err = new Error('socialdata-twitter: search returned a repeated cursor');
      err.completedPages = requests;
      err.attemptedRequests = requests;
      err.returnedTweets = tweets.length;
      throw err;
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  return { tweets: dedupeTweets(tweets), requests, returnedTweets: tweets.length };
}

async function fetchTimelineThroughWindow({ userId, apiKey, windowStart, fetchImpl }) {
  const tweets = [];
  const seenCursors = new Set();
  let cursor = null;
  let requests = 0;

  while (true) {
    let data;
    try {
      const body = await fetchImpl(makeTimelineUrl(userId, cursor), {
        headers: authHeaders(apiKey),
      });
      data = parseTweetPage(body);
    } catch (err) {
      err.completedPages = requests;
      err.attemptedRequests = requests + 1;
      err.returnedTweets = tweets.length;
      throw err;
    }

    requests += 1;
    tweets.push(...data.tweets);

    // Timeline pages are reverse chronological, but a pinned tweet can be much
    // older than its neighbours. Only stop after an entire page is older than
    // the target window; stopping at the first old tweet could miss newer items
    // on the same or following page.
    const dates = data.tweets.map(tweetDate).filter(Boolean);
    const pageIsEntirelyBeforeWindow = dates.length > 0
      && dates.length === data.tweets.length
      && dates.every((date) => date < windowStart);
    const nextCursor = data.next_cursor || null;
    if (pageIsEntirelyBeforeWindow || !nextCursor) break;
    if (seenCursors.has(nextCursor)) {
      const err = new Error('socialdata-twitter: timeline returned a repeated cursor');
      err.completedPages = requests;
      err.attemptedRequests = requests;
      err.returnedTweets = tweets.length;
      throw err;
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  return { tweets: dedupeTweets(tweets), requests, returnedTweets: tweets.length };
}

function mapTweetsToArticles(tweets, handleFallback) {
  return (tweets || []).map((t) => {
    const screen = t.user?.screen_name || handleFallback;
    const tweetId = String(t.id_str || t.id);
    const text = (t.full_text || t.text || '').trim();
    const expandedUrls = (t.entities?.urls || []).map((u) => ({
      t_co: u.url,
      expanded_url: u.expanded_url,
      display_url: u.display_url,
    }));
    const quotedTweet = (t.is_quote_status && t.quoted_status) ? {
      author: t.quoted_status.user?.screen_name || null,
      text: (t.quoted_status.full_text || t.quoted_status.text || '').trim(),
      url: t.quoted_status.user?.screen_name && t.quoted_status.id_str
        ? `https://x.com/${t.quoted_status.user.screen_name}/status/${t.quoted_status.id_str}`
        : null,
    } : null;
    const replyTo = t.in_reply_to_status_id_str ? {
      screen_name: t.in_reply_to_screen_name || null,
      status_id: t.in_reply_to_status_id_str,
    } : null;
    return {
      tweet_id: tweetId,
      title: text.slice(0, 200),
      url: `https://x.com/${screen}/status/${tweetId}`,
      published_at: t.tweet_created_at || null,
      description: text,
      expanded_urls: expandedUrls,
      quoted_tweet: quotedTweet,
      reply_to: replyTo,
    };
  });
}

// Low-signal tweets we drop at fetch time:
//   - Pure RTs (`RT @handle ...`): re-posts without commentary, rarely add signal beyond what the primary source already surfaces.
//   - Replies, including self-replies: conversational fragments and thread
//     continuations are intentionally excluded to keep the feed concise.
function isLowSignalTweet(article, handle) {
  if ((article.description || '').startsWith('RT @')) return true;
  if (article.reply_to?.status_id || article.reply_to?.screen_name) return true;
  return false;
}

function makeTwitterRoute({ name, handle, userId, fetchImpl = fetchText }) {
  if (!handle) throw new Error(`socialdata-twitter: missing handle for ${name}`);
  if (!userId) throw new Error(`socialdata-twitter: missing userId for ${name}`);
  return {
    name,
    handle,
    userId: String(userId),
    sourceType: 'socialdata',
    sourceUrl: `https://x.com/${handle}`,
    async fetch({ windowStart, windowEnd, mode = 'search', accountTimeoutMs = 60_000 } = {}) {
      return fetchRange({ windowStart, windowEnd, mode, accountTimeoutMs });
    },
  };

  async function fetchRange({ windowStart, windowEnd, mode, accountTimeoutMs }) {
      const startedAt = Date.now();
      const apiKey = process.env.SOCIALDATA_API_KEY;
      if (!apiKey) return { articles: [], error: 'SOCIALDATA_API_KEY not set' };

      let start;
      let end;
      try {
        start = asValidDate(windowStart, 'windowStart');
        end = asValidDate(windowEnd, 'windowEnd');
        if (start >= end) throw new Error('socialdata-twitter: windowStart must precede windowEnd');
      } catch (err) {
        return { articles: [], error: err.message };
      }

      const controller = new AbortController();
      const deadline = setTimeout(() => controller.abort(), Math.max(1, accountTimeoutMs));
      const boundedFetch = (url, options = {}) => fetchImpl(url, {
        ...options,
        timeoutMs: 15_000,
        maxAttempts: 1,
        signal: controller.signal,
      });
      let result;
      let method = mode === 'timeline' ? 'timeline_incremental' : 'search_incremental';
      try {
        if (mode === 'timeline') {
          result = await fetchTimelineThroughWindow({
            userId,
            apiKey,
            windowStart: start,
            fetchImpl: boundedFetch,
          });
        } else {
          result = await fetchSearchWindow({
            handle, apiKey, windowStart: start, windowEnd: end, fetchImpl: boundedFetch,
          });
        }
        const raw = mapTweetsToArticles(result.tweets, handle);
        const newestReturnedAt = result.tweets
          .map(tweetDate)
          .filter((date) => date && date < end)
          .sort((a, b) => b - a)[0] || null;
        const articles = raw.filter((article) => {
          const published = new Date(article.published_at);
          return !isLowSignalTweet(article, handle)
            && !Number.isNaN(published.getTime())
            && published >= start
            && published < end;
        });
        const dropped = raw.length - articles.length;
        if (dropped > 0) console.error(`[${name}] filtered ${dropped} out-of-range/low-signal tweets`);
        return {
          articles,
          error: null,
          usage: {
            provider: 'socialdata', method,
            requests: result.requests, returned_tweets: result.returnedTweets,
          },
          newest_returned_at: newestReturnedAt?.toISOString() || null,
          elapsed_ms: Date.now() - startedAt,
        };
      } catch (err) {
        const completedPages = err.completedPages || 0;
        const failureMethod = mode === 'timeline' ? 'timeline_incremental_failed'
          : completedPages > 0 ? 'search_incremental_incomplete' : 'search_incremental_failed';
        return {
          articles: [],
          error: `${method} failed: ${err.message}`,
          usage: {
            provider: 'socialdata', method: failureMethod,
            requests: err.attemptedRequests || 1,
            returned_tweets: err.returnedTweets || 0,
          },
          elapsed_ms: Date.now() - startedAt,
        };
      } finally {
        clearTimeout(deadline);
      }
    }
}

module.exports = {
  makeTwitterRoute,
  mapTweetsToArticles,
  isLowSignalTweet,
  fetchSearchWindow,
  fetchTimelineThroughWindow,
  makeSearchUrl,
};
