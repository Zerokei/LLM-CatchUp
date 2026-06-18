const PACIFIC_TZ = 'America/Los_Angeles';

function formatDateInZone(date, timeZone = PACIFIC_TZ) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function addDays(dateStr, days) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0));
  return date.toISOString().slice(0, 10);
}

function previousPacificDate(now = new Date()) {
  return addDays(formatDateInZone(now, PACIFIC_TZ), -1);
}

function zonedDateTimeToUtc(dateStr, timeZone = PACIFIC_TZ, hour = 0, minute = 0, second = 0) {
  const [year, month, day] = dateStr.split('-').map(Number);
  let utc = new Date(Date.UTC(year, month - 1, day, hour, minute, second));

  for (let i = 0; i < 4; i += 1) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(utc).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));

    const observedAsUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    const wantedAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
    const delta = wantedAsUtc - observedAsUtc;
    if (delta === 0) break;
    utc = new Date(utc.getTime() + delta);
  }

  return utc;
}

function pacificDayBoundsUtc(dateStr) {
  return {
    start: zonedDateTimeToUtc(dateStr, PACIFIC_TZ, 0, 0, 0),
    end: zonedDateTimeToUtc(addDays(dateStr, 1), PACIFIC_TZ, 0, 0, 0),
  };
}

function isoInZone(date = new Date(), timeZone = PACIFIC_TZ) {
  const fmt = new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'longOffset',
  });
  const formatted = fmt.format(date).replace(' ', 'T');
  return formatted.replace(' GMT', '');
}

module.exports = {
  PACIFIC_TZ,
  addDays,
  formatDateInZone,
  isoInZone,
  pacificDayBoundsUtc,
  previousPacificDate,
};
