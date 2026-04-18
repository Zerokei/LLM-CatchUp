const { fetchText } = require('./http');

const BASE = 'https://api.socialdata.tools';

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
        const articles = (data.tweets || []).map((t) => {
          const screen = t.user?.screen_name || handle;
          const text = (t.full_text || t.text || '').trim();
          return {
            title: text.slice(0, 200),
            url: `https://x.com/${screen}/status/${t.id_str}`,
            published_at: t.tweet_created_at || null,
            description: text,
          };
        });
        return { articles, error: null };
      } catch (err) {
        return { articles: [], error: err.message };
      }
    },
  };
}

module.exports = { makeTwitterRoute };
