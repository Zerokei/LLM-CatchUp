function updateSourceHealth(prior, fetchCacheEntry, now, failureThreshold) {
  const prev = prior || { status: 'healthy', last_success: null, consecutive_failures: 0, last_error: null };
  const s = fetchCacheEntry.status;
  if (s === 'ok') {
    return {
      status: 'healthy',
      last_success: now,
      consecutive_failures: 0,
      last_error: null,
    };
  }
  // s === 'error' | 'degraded_stale' → accumulate failures
  const failures = (prev.consecutive_failures || 0) + 1;
  const status = failures >= failureThreshold ? 'alert' : 'degraded';
  return {
    status,
    last_success: prev.last_success,
    consecutive_failures: failures,
    last_error: fetchCacheEntry.error || null,
  };
}

module.exports = { updateSourceHealth };
