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

module.exports = { renderArticleBlock, CATEGORIES };
