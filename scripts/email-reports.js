// scripts/email-reports.js
// CLI that takes a report markdown path, renders to HTML, and sends via Resend.
// Also computes targets for GH Actions push and workflow_dispatch triggers.

const { marked } = require('marked');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

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

const EMAIL_CSS = `
  body { font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif; max-width: 720px; margin: 0 auto; padding: 24px; line-height: 1.6; color: #111; background: #fff; }
  h1 { font-size: 28px; margin-top: 0; }
  h2 { font-size: 22px; border-bottom: 1px solid #eaecef; padding-bottom: 6px; margin-top: 32px; }
  h3 { font-size: 18px; }
  h4 { font-size: 16px; }
  code { font-family: SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px; background: #f6f8fa; padding: 2px 4px; border-radius: 3px; }
  pre { background: #f6f8fa; padding: 12px; border-radius: 6px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0; }
  th, td { border: 1px solid #dfe2e5; padding: 6px 12px; text-align: left; }
  th { background: #f6f8fa; }
  blockquote { border-left: 4px solid #dfe2e5; padding-left: 12px; color: #666; margin-left: 0; }
  a { color: #0366d6; }
  img { max-width: 100%; }
`;

function renderMarkdown(md) {
  const body = marked.parse(md);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><style>${EMAIL_CSS}</style>${body}</body></html>`;
}

function computePushTargets(repoRoot) {
  // Runs in GH Actions where HEAD~1 exists (checkout with fetch-depth: 2).
  const out = execSync("git diff --name-only HEAD~1 HEAD -- 'reports/**/*.md'", {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const rel = out.split('\n').map((s) => s.trim()).filter(Boolean);
  return rel
    .map((r) => path.join(repoRoot, r))
    .filter((abs) => representativeDate(path.relative(repoRoot, abs)) !== null);
}

function computeBackfillTargets(repoRoot, today, lastDays) {
  const out = [];
  for (const cadence of ['daily', 'weekly', 'monthly']) {
    const dir = path.join(repoRoot, 'reports', cadence);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.md')) continue;
      out.push(path.join(dir, name));
    }
  }
  return filterBackfill(
    out.map((abs) => path.relative(repoRoot, abs)),
    today,
    lastDays,
  ).map((rel) => path.join(repoRoot, rel));
}

module.exports = {
  subjectFromPath,
  representativeDate,
  filterBackfill,
  isoWeekMonday,
  renderMarkdown,
  computePushTargets,
  computeBackfillTargets,
};
