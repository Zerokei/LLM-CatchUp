const { fetchText } = require('./http');

const BASE = 'https://api.socialdata.tools';

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

function makeTwitterRoute({ name, handle, userId }) {
  if (!handle) throw new Error(`socialdata-twitter: missing handle for ${name}`);
  if (!userId) throw new Error(`socialdata-twitter: missing userId for ${name}`);
  return {
    name,
    sourceType: 'socialdata',
    sourceUrl: `https://x.com/${handle}`,
    async fetch() {
      const apiKey = process.env.SOCIALDATA_API_KEY;
      if (!apiKey) return { articles: [], error: 'SOCIALDATA_API_KEY not set' };
      try {
        const body = await fetchText(`${BASE}/twitter/user/${userId}/tweets`, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: 'application/json',
          },
        });
        const data = JSON.parse(body);
        const articles = mapTweetsToArticles(data.tweets, handle);
        return { articles, error: null };
      } catch (err) {
        return { articles: [], error: err.message };
      }
    },
  };
}

module.exports = { makeTwitterRoute, mapTweetsToArticles };
