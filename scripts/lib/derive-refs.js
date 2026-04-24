function extractHandleFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const m = url.match(/^https?:\/\/x\.com\/([^/]+)\/status\/\d+/);
  return m ? m[1] : null;
}

module.exports = { extractHandleFromUrl };
