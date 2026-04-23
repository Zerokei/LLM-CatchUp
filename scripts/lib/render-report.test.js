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
