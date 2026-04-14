// scripts/email-reports.js
// CLI that takes a report markdown path, renders to HTML, and sends via Resend.
// Also computes targets for GH Actions push and workflow_dispatch triggers.

const { marked } = require('marked');
const { Resend } = require('resend');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

function subjectFromPath(reportPath) {
  let m = reportPath.match(/reports\/daily\/(\d{4}-\d{2}-\d{2})\.md$/);
  if (m) return `CatchUp 日报 ${m[1]}`;
  m = reportPath.match(/reports\/weekly\/(\d{4}-W\d{2})\.md$/);
  if (m) return `CatchUp 周报 ${m[1]}`;
  m = reportPath.match(/reports\/monthly\/(\d{4}-\d{2})\.md$/);
  if (m) return `CatchUp 月报 ${m[1]}`;
  throw new Error(`unrecognized report path: ${reportPath}`);
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

function representativeDate(reportPath) {
  let m = reportPath.match(/reports\/daily\/(\d{4})-(\d{2})-(\d{2})\.md$/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  m = reportPath.match(/reports\/weekly\/(\d{4})-W(\d{2})\.md$/);
  if (m) return isoWeekMonday(+m[1], +m[2]);
  m = reportPath.match(/reports\/monthly\/(\d{4})-(\d{2})\.md$/);
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

function buildEmailPayload(reportPath, cwd = process.cwd()) {
  if (!fs.existsSync(reportPath)) {
    throw new Error(`report not found: ${reportPath}`);
  }
  const md = fs.readFileSync(reportPath, 'utf8');
  const subject = subjectFromPath(path.relative(cwd, reportPath));
  const html = renderMarkdown(md);
  return { subject, html };
}

async function sendOne(reportPath, { apiKey, to, from }) {
  const { subject, html } = buildEmailPayload(reportPath);
  const resend = new Resend(apiKey);
  const { data, error } = await resend.emails.send({ from, to, subject, html });
  if (error) {
    throw new Error(`Resend error for ${subject}: ${error.message || JSON.stringify(error)}`);
  }
  return { subject, id: data?.id };
}

module.exports = {
  subjectFromPath,
  representativeDate,
  filterBackfill,
  isoWeekMonday,
  renderMarkdown,
  computePushTargets,
  computeBackfillTargets,
  sendOne,
  buildEmailPayload,
};

async function main() {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.RESEND_TO;
  const from = process.env.RESEND_FROM || 'onboarding@resend.dev';
  if (!apiKey) throw new Error('missing env RESEND_API_KEY');
  if (!to) throw new Error('missing env RESEND_TO');

  const repoRoot = process.cwd();
  let targets = [];

  const cliArg = process.argv[2];
  if (cliArg) {
    targets = [path.isAbsolute(cliArg) ? cliArg : path.join(repoRoot, cliArg)];
  } else {
    const eventName = process.env.EVENT_NAME;
    if (eventName === 'push') {
      targets = computePushTargets(repoRoot);
    } else if (eventName === 'workflow_dispatch') {
      const reportPath = (process.env.REPORT_PATH || '').trim();
      const backfillDays = parseInt(process.env.BACKFILL_DAYS || '0', 10);
      if (reportPath) {
        targets = [path.isAbsolute(reportPath) ? reportPath : path.join(repoRoot, reportPath)];
      } else if (backfillDays > 0) {
        // Resolve "today" on the Shanghai calendar robustly — avoid
        // locale-parsing surprises from toLocaleString()+new Date(string).
        // Matches the pattern in scripts/fetch-sources.js.
        const fmt = new Intl.DateTimeFormat('sv-SE', {
          timeZone: 'Asia/Shanghai',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        });
        const [y, m, d] = fmt.format(new Date()).split('-').map(Number);
        const today = new Date(Date.UTC(y, m - 1, d));
        targets = computeBackfillTargets(repoRoot, today, backfillDays);
      } else {
        throw new Error('workflow_dispatch requires either report_path or backfill_days > 0');
      }
    } else {
      throw new Error('usage: node scripts/email-reports.js <report-path>   (or set EVENT_NAME=push / workflow_dispatch)');
    }
  }

  if (targets.length === 0) {
    console.log('no targets to send');
    return;
  }

  console.log(`sending ${targets.length} email(s)`);
  for (const t of targets) {
    const { subject, id } = await sendOne(t, { apiKey, to, from });
    console.log(`  ✓ ${subject}  (id=${id || 'unknown'})`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
