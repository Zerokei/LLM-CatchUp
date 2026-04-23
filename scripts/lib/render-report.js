const CATEGORIES = ['模型发布', '研究', '产品与功能', '商业动态', '政策与安全', '教程与观点'];

function stars(n) { return '⭐'.repeat(Math.max(1, Math.min(5, n))); }

function renderArticleBlock(a, idx) {
  const sourceLine = a.also_covered_by?.length
    ? `- **来源**: ${a.source} | 📡 也被 ${a.also_covered_by.join(', ')} 报道\n`
    : `- **来源**: ${a.source}\n`;
  const tags = (a.tags || []).map((t) => '`' + t + '`').join(' ');
  let md = '';
  md += `### ${idx}. [${a.title}](${a.url})\n\n`;
  md += sourceLine;
  md += `- **分类**: ${a.category}\n`;
  md += `- **重要性**: ${stars(a.importance)} (${a.importance}/5)\n`;
  md += `- **标签**: ${tags}\n\n`;
  md += `**摘要**: ${a.summary}\n\n`;
  if (a.practice_suggestions && a.practice_suggestions.length) {
    md += '> **实践建议**\n';
    for (const s of a.practice_suggestions) md += `> - ${s}\n`;
    md += '\n';
  }
  md += '---\n\n';
  return md;
}

function renderReport({
  date,
  articlesInReport,
  rawFetched,
  mergedCount,
  sourcesWithContent,
  filteredLowImportance,
  trendParagraph,
  sourceStatuses,
}) {
  const catCounts = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
  for (const a of articlesInReport) {
    if (catCounts[a.category] !== undefined) catCounts[a.category]++;
  }

  let md = '';
  md += `# CatchUp 日报 — ${date}\n\n## 今日概览\n\n`;
  if (mergedCount === rawFetched) {
    md += `共抓取 **${rawFetched}** 篇文章，来自 **${sourcesWithContent}** 个数据源（过滤后在报告中展示 **${articlesInReport.length}** 篇）。\n\n`;
  } else {
    md += `共抓取 **${rawFetched}** 篇文章（合并多推文线程后为 ${mergedCount} 条独立条目），来自 **${sourcesWithContent}** 个数据源（过滤后在报告中展示 **${articlesInReport.length}** 篇）。\n\n`;
  }
  md += '| 分类 | 数量 |\n|------|------|\n';
  for (const c of CATEGORIES) md += `| ${c} | ${catCounts[c]} |\n`;
  md += '\n---\n\n## 文章详情\n\n';

  if (articlesInReport.length === 0) {
    md += `今日 30h 抓取窗口内全部 ${sourceStatuses.length} 个数据源均未产出新内容，无条目可展示。\n\n---\n\n`;
  } else {
    articlesInReport.forEach((a, i) => { md += renderArticleBlock(a, i + 1); });
  }

  md += '## 今日趋势\n\n';
  md += trendParagraph.trim() + '\n\n';
  md += '---\n\n## 数据源状态\n\n| 数据源 | 状态 |\n|--------|------|\n';
  for (const s of sourceStatuses) md += `| ${s.name} | ${s.status_note} |\n`;
  md += `\n注：共过滤 ${filteredLowImportance} 篇低重要度条目（importance < 2）——这些条目仍记入 history.json。\n`;
  return md;
}

module.exports = { renderArticleBlock, renderReport, CATEGORIES };
