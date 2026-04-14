// scripts/email-reports.js
// CLI that takes a report markdown path, renders to HTML, and sends via Resend.
// Also computes targets for GH Actions push and workflow_dispatch triggers.

function subjectFromPath(path) {
  let m = path.match(/reports\/daily\/(\d{4}-\d{2}-\d{2})\.md$/);
  if (m) return `CatchUp 日报 ${m[1]}`;
  m = path.match(/reports\/weekly\/(\d{4}-W\d{2})\.md$/);
  if (m) return `CatchUp 周报 ${m[1]}`;
  m = path.match(/reports\/monthly\/(\d{4}-\d{2})\.md$/);
  if (m) return `CatchUp 月报 ${m[1]}`;
  throw new Error(`unrecognized report path: ${path}`);
}

function isoWeekMonday(year, week) {
  // ISO 8601: week 1 is the week containing the year's first Thursday;
  // equivalently, the week containing Jan 4. Compute the Monday of that week,
  // then offset by (week - 1) full weeks.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Dow = jan4.getUTCDay() || 7;  // Sun = 0 → 7 so Mon = 1
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - jan4Dow + 1);
  return new Date(week1Monday.getTime() + (week - 1) * 7 * 86400_000);
}

function representativeDate(path) {
  let m = path.match(/reports\/daily\/(\d{4})-(\d{2})-(\d{2})\.md$/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  m = path.match(/reports\/weekly\/(\d{4})-W(\d{2})\.md$/);
  if (m) return isoWeekMonday(+m[1], +m[2]);
  m = path.match(/reports\/monthly\/(\d{4})-(\d{2})\.md$/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, 1));
  return null;
}

function filterBackfill(paths, today, lastDays) {
  const cutoff = new Date(today.getTime() - lastDays * 86400_000);
  return paths.filter((p) => {
    const d = representativeDate(p);
    if (!d) return false;
    return d >= cutoff && d <= today;
  });
}

module.exports = { subjectFromPath, representativeDate, filterBackfill, isoWeekMonday };
