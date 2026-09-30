const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { previousPacificDate } = require('./lib/report-date');

function validDate(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date)
    && !Number.isNaN(Date.parse(`${date}T00:00:00Z`))
    && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
}

function resolveReportDates(eventName, explicitDate, changedPaths, now = new Date()) {
  if (eventName === 'workflow_dispatch') {
    const date = explicitDate || previousPacificDate(now);
    if (!validDate(date)) throw new Error(`Invalid report_date: ${date}`);
    return [date];
  }
  if (eventName !== 'push') throw new Error(`Unsupported event: ${eventName}`);
  return [...new Set(changedPaths.map((p) =>
    /^data\/analysis-cache\/(\d{4}-\d{2}-\d{2})\.json$/.exec(p)?.[1]
  ).filter((date) => date && validDate(date)))].sort();
}

if (require.main === module) {
  const eventName = process.env.GITHUB_EVENT_NAME;
  const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  let paths = [];
  if (eventName === 'push') {
    if (!/^[a-f0-9]{40}$/.test(event.before || '') || /^0+$/.test(event.before)
      || !/^[a-f0-9]{40}$/.test(event.after || '')) {
      throw new Error('Push event requires an existing before/after commit range');
    }
    paths = execFileSync('git', ['diff', '--name-only', '--diff-filter=AM', event.before, event.after, '--', 'data/analysis-cache/'], { encoding: 'utf8' }).trim().split('\n');
  }
  const dates = resolveReportDates(eventName, event.inputs?.report_date || '', paths);
  process.stdout.write(dates.length ? `${dates.join('\n')}\n` : '');
}

module.exports = { resolveReportDates };
