const { test } = require('node:test');
const assert = require('node:assert/strict');
const { renderArticleBlock, renderReport, CATEGORIES } = require('./render-report');

const SAMPLE_ARTICLE = {
  title: 'Introducing Claude Opus 4.7',
  url: 'https://www.anthropic.com/news/claude-opus-4-7',
  source: 'Anthropic Blog',
  category: '模型发布',
  importance: 5,
  tags: ['Claude', 'Opus', '模型发布'],
  summary: 'Anthropic 发布 Claude Opus 4.7，在 reasoning 与工具使用上较 4.6 显著提升。',
  practice_suggestions: ['在 Claude.ai 切换到 Opus 4.7 运行一组你已有的编码基准', '对比 Sonnet 4.6 的成本差'],
};

test('renderArticleBlock: includes title as link, source, category, stars, tags', () => {
  const md = renderArticleBlock(SAMPLE_ARTICLE, 1);
  assert.match(md, /### 1\. \[Introducing Claude Opus 4\.7\]\(https:\/\/www\.anthropic\.com\/news\/claude-opus-4-7\)/);
  assert.match(md, /- \*\*来源\*\*: Anthropic Blog/);
  assert.match(md, /- \*\*分类\*\*: 模型发布/);
  assert.match(md, /- \*\*重要性\*\*: ⭐⭐⭐⭐⭐ \(5\/5\)/);
  assert.match(md, /- \*\*标签\*\*: `Claude` `Opus` `模型发布`/);
  assert.match(md, /\*\*摘要\*\*: Anthropic 发布 Claude Opus 4\.7/);
});

test('renderArticleBlock: emits practice_suggestions as blockquote when present', () => {
  const md = renderArticleBlock(SAMPLE_ARTICLE, 1);
  assert.match(md, /> \*\*实践建议\*\*/);
  assert.match(md, /> - 在 Claude\.ai 切换到 Opus 4\.7/);
  assert.match(md, /> - 对比 Sonnet 4\.6 的成本差/);
});

test('renderArticleBlock: omits practice_suggestions block when absent', () => {
  const a = { ...SAMPLE_ARTICLE, practice_suggestions: null };
  const md = renderArticleBlock(a, 1);
  assert.doesNotMatch(md, /实践建议/);
});

test('renderArticleBlock: adds "也被 X, Y 报道" when also_covered_by present', () => {
  const a = { ...SAMPLE_ARTICLE, also_covered_by: ['Berkeley RDI', 'The Batch'] };
  const md = renderArticleBlock(a, 1);
  assert.match(md, /\| 📡 也被 Berkeley RDI, The Batch 报道/);
});

test('CATEGORIES: matches config category order', () => {
  assert.deepEqual(CATEGORIES, ['模型发布', '研究', '产品与功能', '商业动态', '政策与安全', '教程与观点']);
});

function makeArticle(n, overrides = {}) {
  return {
    title: `文章 ${n}`,
    url: `https://example.com/${n}`,
    source: 'OpenAI Blog',
    category: '模型发布',
    importance: 3,
    tags: ['t1'],
    summary: `摘要 ${n}`,
    ...overrides,
  };
}

test('renderReport: header with date + totals + category table', () => {
  const md = renderReport({
    date: '2026-04-22',
    articlesInReport: [makeArticle(1), makeArticle(2, { category: '研究' })],
    rawFetched: 10,
    mergedCount: 7,
    sourcesWithContent: 3,
    filteredLowImportance: 2,
    trendParagraph: '今日主题是模型更新。',
    sourceStatuses: [
      { name: 'OpenAI Blog', status_note: '✅ 正常（窗口内 2 文）' },
      { name: 'Google AI Blog', status_note: '✅ 正常（窗口内 0 文）' },
    ],
  });
  assert.match(md, /^# CatchUp 日报 — 2026-04-22/);
  assert.match(md, /共抓取 \*\*10\*\* 篇文章/);
  assert.match(md, /合并多推文线程后为 7 条/);
  assert.match(md, /来自 \*\*3\*\* 个数据源/);
  assert.match(md, /过滤后在报告中展示 \*\*2\*\* 篇/);
  assert.match(md, /\| 模型发布 \| 1 \|/);
  assert.match(md, /\| 研究 \| 1 \|/);
  assert.match(md, /\| 产品与功能 \| 0 \|/);
});

test('renderReport: includes each article in body, trend, source status table', () => {
  const md = renderReport({
    date: '2026-04-22',
    articlesInReport: [makeArticle(1)],
    rawFetched: 1, mergedCount: 1, sourcesWithContent: 1,
    filteredLowImportance: 0,
    trendParagraph: '今日 trend.',
    sourceStatuses: [{ name: 'OpenAI Blog', status_note: '✅ 正常（窗口内 1 文）' }],
  });
  assert.match(md, /### 1\. \[文章 1\]/);
  assert.match(md, /## 今日趋势[\s\S]*?今日 trend\./);
  assert.match(md, /## 数据源状态[\s\S]*?\| OpenAI Blog \| ✅ 正常/);
  assert.match(md, /共过滤 0 篇低重要度条目/);
});

test('renderReport: zero-article day renders placeholder section', () => {
  const md = renderReport({
    date: '2026-04-22',
    articlesInReport: [],
    rawFetched: 0, mergedCount: 0, sourcesWithContent: 0,
    filteredLowImportance: 0,
    trendParagraph: '今日所有数据源窗口内均无新内容。',
    sourceStatuses: [{ name: 'OpenAI Blog', status_note: '✅ 正常（窗口内 0 文）' }],
  });
  assert.match(md, /今日 30h 抓取窗口内全部 \d+ 个数据源均未产出新内容/);
});
