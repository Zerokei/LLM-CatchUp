const CATEGORIES = ['模型发布', '研究', '产品与功能', '商业动态', '政策与安全', '教程与观点'];

function stars(n) { return '⭐'.repeat(Math.max(1, Math.min(5, n))); }

function renderArticleBlock(a, idx) {
  const tags = (a.tags || []).map((t) => '`' + t + '`').join(' ');
  let md = '';
  md += `### ${idx}. [${a.title}](${a.url})\n\n`;
  md += `- **来源**: ${a.source}\n`;
  md += `- **分类**: ${a.category}\n`;
  md += `- **重要性**: ${stars(a.importance)} (${a.importance}/5)\n`;
  md += `- **标签**: ${tags}\n\n`;
  md += `**摘要**: ${a.summary}\n\n`;
  if (a.cluster_members && a.cluster_members.length) {
    md += '📎 **多角度报道**:\n';
    for (const m of a.cluster_members) {
      const angle = m.angle ? ` · ${m.angle}` : '';
      md += `- [${m.title}](${m.url}) · ${m.source}${angle}\n`;
    }
    md += '\n';
  }
  if (a.practice_suggestions && a.practice_suggestions.length) {
    md += '> **实践建议**\n';
    for (const s of a.practice_suggestions) md += `> - ${s}\n`;
    md += '\n';
  }
  md += '---\n\n';
  return md;
}

// Compact one-liner for low-importance (★★) articles. Bundled together at the
// bottom under "## 速览" so they don't clutter the editorial flow but readers
// can still scan them.
function renderBriefBlock(a) {
  const tags = (a.tags || []).map((t) => '`' + t + '`').join(' ');
  const oneLine = (a.summary || '').replace(/\s*\n+\s*/g, ' ').trim();
  return `- **${a.category}** | ${tags} — ${oneLine} · [${a.source}](${a.url})\n`;
}

// Editorial: what subscribers / website / RSS see.
// Articles split by importance: ≥3 render as full blocks; ==2 collapse into a
// trailing "## 速览" list. Singletons of either tier still go through history.
function renderEditorial({ date, articlesInReport, briefArticles = [], trendParagraph }) {
  let md = '';
  md += `# CatchUp 日报 — ${date}\n\n`;
  md += '## 今日趋势\n\n';
  md += (trendParagraph || '').trim() + '\n\n';
  md += '---\n\n## 文章详情\n\n';
  if (articlesInReport.length === 0 && briefArticles.length === 0) {
    md += '今日窗口内无新内容。\n';
    return md;
  }
  articlesInReport.forEach((a, i) => { md += renderArticleBlock(a, i + 1); });
  if (briefArticles.length) {
    md += '## 速览\n\n';
    md += '以下为重要度 ★★ 的简讯，仅列分类、标签与一句话摘要。\n\n';
    for (const a of briefArticles) md += renderBriefBlock(a);
    md += '\n';
  }
  return md;
}

// Ops: counts, category histogram, per-source health. Not surfaced on feed/site.
function renderOps({
  date,
  articlesInReport,
  rawFetched,
  mergedCount,
  sourcesWithContent,
  filteredLowImportance,
  sourceStatuses,
}) {
  const catCounts = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
  for (const a of articlesInReport) {
    if (catCounts[a.category] !== undefined) catCounts[a.category]++;
  }

  let md = '';
  md += `# CatchUp 日报 · 运维数据 — ${date}\n\n`;
  md += '## 今日概览\n\n';
  if (mergedCount === rawFetched) {
    md += `共抓取 **${rawFetched}** 篇文章，来自 **${sourcesWithContent}** 个数据源（过滤后在报告中展示 **${articlesInReport.length}** 篇）。\n\n`;
  } else {
    md += `共抓取 **${rawFetched}** 篇文章（合并多推文线程后为 ${mergedCount} 条独立条目），来自 **${sourcesWithContent}** 个数据源（过滤后在报告中展示 **${articlesInReport.length}** 篇）。\n\n`;
  }
  md += '| 分类 | 数量 |\n|------|------|\n';
  for (const c of CATEGORIES) md += `| ${c} | ${catCounts[c]} |\n`;
  md += '\n---\n\n## 数据源状态\n\n| 数据源 | 状态 |\n|--------|------|\n';
  for (const s of sourceStatuses) md += `| ${s.name} | ${s.status_note} |\n`;
  md += `\n注：共过滤 ${filteredLowImportance} 篇低重要度条目（importance < 2）——这些条目仍记入 history.json。\n`;
  return md;
}

module.exports = { renderArticleBlock, renderBriefBlock, renderEditorial, renderOps, CATEGORIES };
