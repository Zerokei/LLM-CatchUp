const UA = 'Mozilla/5.0 (compatible; CatchUp/1.0; +https://github.com/Zerokei/LLM-CatchUp)';
const TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 3_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// HTTP status errors we construct here carry no `.code` property, so
// isRetryable(err) returns false for them in the catch block below.
// Keep this property — don't attach a `.code` to status errors.
function isRetryable(err, response) {
  if (response) return response.status >= 500 && response.status < 600;
  const code = err?.cause?.code || err?.code;
  return ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT'].includes(code);
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
      // Issue B: only treat TimeoutError (from AbortSignal.timeout) as a
      // retriable/relabelable timeout. A real external AbortError means the
      // caller cancelled — propagate it immediately without retry or relabel.
      if (err.name === 'AbortError') {
        throw err;
      }

      lastErr = err;
      const label = attempt === 1 ? '1 attempt' : `${attempt} attempts`;

      if (err.name === 'TimeoutError') {
        lastErr = new Error(`timeout after ${TIMEOUT_MS / 1000}s (${label})`);
        if (attempt < MAX_ATTEMPTS) {
          await sleep(RETRY_DELAY_MS);
          continue;
        }
        throw lastErr;
      }

      // HTTP status error from the try block above — format with attempt count.
      // (isRetryable returns false for these since they carry no .code, so they
      // always land here rather than the retry branch below.)
      if (err.status != null) {
        throw new Error(`HTTP ${err.status} after ${label}`);
      }

      if (attempt < MAX_ATTEMPTS && isRetryable(err)) {
        await sleep(RETRY_DELAY_MS);
        continue;
      }

      // Network error — include error code when available.
      const code = err?.cause?.code || err?.code;
      throw new Error(code ? `network error: ${code}` : `network error: ${err.message}`);
    }
  }
  throw lastErr;
}

module.exports = { fetchText, UA };
