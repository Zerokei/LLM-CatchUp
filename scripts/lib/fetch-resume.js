function envFlag(value) {
  return ['1', 'true', 'yes'].includes(String(value || '').toLowerCase());
}

function sourceNamesNeedingFetch(sourceNames, existingSnapshot, resumeExisting) {
  if (!resumeExisting || !existingSnapshot) return [...sourceNames];
  const existingSources = existingSnapshot.sources || {};
  return sourceNames.filter((name) => {
    const entry = existingSources[name];
    return !entry || entry.status === 'error';
  });
}

function configuredExistingSources(sourceNames, existingSnapshot) {
  const existingSources = existingSnapshot?.sources || {};
  return Object.fromEntries(
    sourceNames
      .filter((name) => existingSources[name])
      .map((name) => [name, existingSources[name]]),
  );
}

function mergeApiUsage(previous, current) {
  if (!previous && !current) return null;
  if (!previous) return { ...current, attempts: current.attempts || 1 };
  if (!current) return { ...previous };
  return {
    ...current,
    attempts: (previous.attempts || 1) + (current.attempts || 1),
    requests: (previous.requests || 0) + (current.requests || 0),
    returned_tweets: (previous.returned_tweets || 0) + (current.returned_tweets || 0),
  };
}

module.exports = {
  envFlag,
  sourceNamesNeedingFetch,
  configuredExistingSources,
  mergeApiUsage,
};
