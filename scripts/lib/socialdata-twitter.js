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

function dedupeTweets(tweets) {
  const seen = new Set();
  const deduped = [];
  for (const tweet of tweets) {
    const id = tweet?.id_str || (tweet?.id != null ? String(tweet.id) : null);
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
  const query = `from:${handle} since_time:${startSeconds} until_time:${endSeconds}`;
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
      title: text.slice(0, 200),
      url: `https://x.com/${screen}/status/${t.id_str}`,
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
//   - Replies to OTHER accounts: conversational fragments, usually context-free in isolation.
// Self-replies are kept — they are how long-form content is threaded on Twitter, and `thread_group_id` merges them at report time.
function isLowSignalTweet(article, handle) {
  if ((article.description || '').startsWith('RT @')) return true;
  if (article.reply_to?.screen_name) {
    const target = article.reply_to.screen_name.toLowerCase();
    const self = (handle || '').toLowerCase();
    if (target !== self) return true;
  }
  return false;
}

function makeTwitterRoute({ name, handle, userId, fetchImpl = fetchText }) {
  if (!handle) throw new Error(`socialdata-twitter: missing handle for ${name}`);
  if (!userId) throw new Error(`socialdata-twitter: missing userId for ${name}`);
  return {
    name,
    sourceType: 'socialdata',
    sourceUrl: `https://x.com/${handle}`,
    async fetch({ windowStart, windowEnd } = {}) {
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

      let result;
      let method = 'search_window';
      let warning = null;
      let totalRequests = 0;
      let totalReturnedTweets = 0;

      let search;
      try {
        search = await fetchSearchWindow({
          handle, apiKey, windowStart: start, windowEnd: end, fetchImpl,
        });
        totalRequests += search.requests;
        totalReturnedTweets += search.returnedTweets;
      } catch (searchErr) {
        totalRequests += searchErr.attemptedRequests || 1;
        totalReturnedTweets += searchErr.returnedTweets || 0;

        // A failure after one or more successful search pages must not be
        // hidden by a first-page timeline fallback: doing so could silently
        // truncate a busy account. Mark it failed so the retry run fetches the
        // complete source again.
        if ((searchErr.completedPages || 0) > 0) {
          return {
            articles: [],
            error: `incomplete paginated search: ${searchErr.message}`,
            usage: {
              provider: 'socialdata', method: 'search_window_incomplete',
              requests: totalRequests, returned_tweets: totalReturnedTweets,
            },
          };
        }

        try {
          const timeline = await fetchTimelineThroughWindow({
            userId, apiKey, windowStart: start, fetchImpl,
          });
          totalRequests += timeline.requests;
          totalReturnedTweets += timeline.returnedTweets;
          result = timeline;
          method = 'timeline_search_fallback';
          warning = `search unavailable; used user timeline: ${searchErr.message}`;
        } catch (timelineErr) {
          totalRequests += timelineErr.attemptedRequests || 1;
          totalReturnedTweets += timelineErr.returnedTweets || 0;
          return {
            articles: [],
            error: `search failed (${searchErr.message}); timeline failed (${timelineErr.message})`,
            usage: {
              provider: 'socialdata', method: 'search_and_timeline_failed',
              requests: totalRequests, returned_tweets: totalReturnedTweets,
            },
          };
        }
      }

      if (search && !result) {
        const hasTweetInWindow = search.tweets.some((tweet) => {
          const date = tweetDate(tweet);
          return date && date >= start && date < end;
        });

        if (hasTweetInWindow) {
          result = search;
        } else {
          // Search can legitimately be empty, but SocialData documents that
          // shadow-banned profiles may also return no search results. Verify an
          // empty/out-of-window response through the stable user-ID timeline so
          // optimisation never turns provider ambiguity into silent omission.
          try {
            const timeline = await fetchTimelineThroughWindow({
              userId, apiKey, windowStart: start, fetchImpl,
            });
            totalRequests += timeline.requests;
            totalReturnedTweets += timeline.returnedTweets;
            result = timeline;
            method = 'timeline_empty_search_verification';
            warning = 'search returned no in-window tweets; verified via user timeline';
          } catch (timelineErr) {
            totalRequests += timelineErr.attemptedRequests || 1;
            totalReturnedTweets += timelineErr.returnedTweets || 0;
            return {
              articles: [],
              error: `empty search could not be verified via timeline: ${timelineErr.message}`,
              usage: {
                provider: 'socialdata', method: 'empty_search_verification_failed',
                requests: totalRequests, returned_tweets: totalReturnedTweets,
              },
            };
          }
        }
      }

      try {
        const raw = mapTweetsToArticles(result.tweets, handle);
        const articles = raw.filter((a) => !isLowSignalTweet(a, handle));
        const dropped = raw.length - articles.length;
        if (dropped > 0) console.error(`[${name}] filtered ${dropped} low-signal tweets (RT / reply-to-others)`);
        if (warning) console.error(`[${name}] ${warning}`);
        return {
          articles,
          error: null,
          warning,
          usage: {
            provider: 'socialdata', method,
            requests: totalRequests, returned_tweets: totalReturnedTweets,
          },
        };
      } catch (err) {
        return {
          articles: [], error: err.message,
          usage: {
            provider: 'socialdata', method,
            requests: totalRequests, returned_tweets: totalReturnedTweets,
          },
        };
      }
    },
  };
}

module.exports = {
  makeTwitterRoute,
  mapTweetsToArticles,
  isLowSignalTweet,
  fetchSearchWindow,
  fetchTimelineThroughWindow,
  makeSearchUrl,
};
