const UA = 'Mozilla/5.0 (compatible; CatchUp/1.0; +https://github.com/Zerokei/LLM-CatchUp)';
const TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 3_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isRetryable(err, response) {
  if (response) return response.status >= 500 && response.status < 600;
  const code = err?.cause?.code || err?.code;
  return ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT'].includes(code);
}

async function fetchText(url, { headers = {} } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, ...headers },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status}`);
        err.status = res.status;
        if (isRetryable(null, res) && attempt < MAX_ATTEMPTS) {
          lastErr = err;
          await sleep(RETRY_DELAY_MS);
          continue;
        }
        throw err;
      }
      return await res.text();
    } catch (err) {
      lastErr = err;
      if (err.name === 'TimeoutError' || err.name === 'AbortError') {
        lastErr = new Error(`timeout after ${TIMEOUT_MS / 1000}s`);
      }
      if (attempt < MAX_ATTEMPTS && (isRetryable(err) || err.name === 'TimeoutError' || err.name === 'AbortError')) {
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      throw lastErr;
    }
  }
  throw lastErr;
}

module.exports = { fetchText, UA };
