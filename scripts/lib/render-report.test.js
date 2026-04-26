const { test } = require('node:test');
const assert = require('node:assert/strict');
const { renderArticleBlock, renderEditorial, renderOps, CATEGORIES } = require('./render-report');

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

test('renderArticleBlock: appends 多角度报道 list when cluster_members present', () => {
  const a = {
    ...SAMPLE_ARTICLE,
    cluster_members: [
      { url: 'https://x.com/AnthropicAI/status/1', title: 'Anthropic 官推', source: 'Anthropic (Twitter)', angle: '官方推文' },
      { url: 'https://deeplearning.ai/the-batch/issue-350', title: 'The Batch 报道', source: 'The Batch', angle: '' },
    ],
  };
  const md = renderArticleBlock(a, 1);
  assert.match(md, /📎 \*\*多角度报道\*\*:/);
  assert.match(md, /- \[Anthropic 官推\]\(https:\/\/x\.com\/AnthropicAI\/status\/1\) · Anthropic \(Twitter\) · 官方推文/);
  assert.match(md, /- \[The Batch 报道\]\(https:\/\/deeplearning\.ai\/the-batch\/issue-350\) · The Batch\n/);
});

test('renderArticleBlock: omits 多角度报道 section when cluster_members absent', () => {
  const md = renderArticleBlock(SAMPLE_ARTICLE, 1);
  assert.doesNotMatch(md, /多角度报道/);
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

// ---- renderEditorial ----

test('renderEditorial: title + trend-first + articles, no ops blocks', () => {
  const md = renderEditorial({
    date: '2026-04-22',
    articlesInReport: [makeArticle(1), makeArticle(2)],
    trendParagraph: '今日主题是模型更新。',
  });
  assert.match(md, /^# CatchUp 日报 — 2026-04-22/);
  // trend appears before articles
  const trendIdx = md.indexOf('## 今日趋势');
  const articlesIdx = md.indexOf('## 文章详情');
  assert.ok(trendIdx > 0 && articlesIdx > trendIdx, 'trend section must precede articles');
  assert.match(md, /今日主题是模型更新。/);
  assert.match(md, /### 1\. \[文章 1\]/);
  assert.match(md, /### 2\. \[文章 2\]/);
  // no ops content leaked in
  assert.doesNotMatch(md, /今日概览/);
  assert.doesNotMatch(md, /数据源状态/);
  assert.doesNotMatch(md, /共抓取/);
});

test('renderEditorial: empty day renders concise placeholder, not ops counts', () => {
  const md = renderEditorial({
    date: '2026-04-22',
    articlesInReport: [],
    trendParagraph: '今日所有数据源窗口内均无新内容。',
  });
  assert.match(md, /今日窗口内无新内容。/);
  assert.doesNotMatch(md, /共抓取/);
});

test('renderEditorial: tolerates empty/whitespace trend paragraph', () => {
  const md = renderEditorial({
    date: '2026-04-22',
    articlesInReport: [makeArticle(1)],
    trendParagraph: '   ',
  });
  // section header still present even when body is empty — caller's contract is to provide the trend
  assert.match(md, /## 今日趋势/);
});

test('renderEditorial: briefArticles render as a 速览 list at the bottom', () => {
  const md = renderEditorial({
    date: '2026-04-22',
    articlesInReport: [makeArticle(1, { importance: 4 })],
    briefArticles: [
      makeArticle(10, { importance: 2, category: '商业动态', tags: ['投融资'], summary: '某公司完成 B 轮融资。' }),
      makeArticle(11, { importance: 2, category: '教程与观点', tags: ['观点'], summary: 'X 谈论 Y。' }),
    ],
    trendParagraph: 'trend',
  });
  // Hi-importance article gets a full block
  assert.match(md, /### 1\. \[文章 1\]/);
  // 速览 section header appears once
  assert.match(md, /## 速览/);
  // Brief items render as compact one-liners with category, tags, summary, source link
  assert.match(md, /- \*\*商业动态\*\* \| `投融资` — 某公司完成 B 轮融资。 · \[OpenAI Blog\]\(https:\/\/example\.com\/10\)/);
  assert.match(md, /- \*\*教程与观点\*\* \| `观点` — X 谈论 Y。 · \[OpenAI Blog\]\(https:\/\/example\.com\/11\)/);
  // Brief items don't get ### headers
  assert.doesNotMatch(md, /### \d+\. \[文章 10\]/);
});

test('renderEditorial: 速览 section omitted when no briefArticles', () => {
  const md = renderEditorial({
    date: '2026-04-22',
    articlesInReport: [makeArticle(1)],
    trendParagraph: 'trend',
  });
  assert.doesNotMatch(md, /## 速览/);
});

// ---- renderOps ----

test('renderOps: ops doc has counts, category table, source health table — no article bodies', () => {
  const md = renderOps({
    date: '2026-04-22',
    articlesInReport: [makeArticle(1), makeArticle(2, { category: '研究' })],
    rawFetched: 10,
    mergedCount: 7,
    sourcesWithContent: 3,
    filteredLowImportance: 2,
    sourceStatuses: [
      { name: 'OpenAI Blog', status_note: '✅ 正常（窗口内 2 文）' },
      { name: 'Google AI Blog', status_note: '✅ 正常（窗口内 0 文）' },
    ],
  });
  assert.match(md, /^# CatchUp 日报 · 运维数据 — 2026-04-22/);
  assert.match(md, /共抓取 \*\*10\*\* 篇文章/);
  assert.match(md, /合并多推文线程后为 7 条/);
  assert.match(md, /来自 \*\*3\*\* 个数据源/);
  assert.match(md, /\| 模型发布 \| 1 \|/);
  assert.match(md, /\| 研究 \| 1 \|/);
  assert.match(md, /\| 产品与功能 \| 0 \|/);
  assert.match(md, /## 数据源状态[\s\S]*?\| OpenAI Blog \| ✅ 正常/);
  assert.match(md, /共过滤 2 篇低重要度条目/);
  // no article-level prose leaked
  assert.doesNotMatch(md, /### 1\./);
  assert.doesNotMatch(md, /\*\*摘要\*\*/);
});

test('renderOps: drops "合并多推文线程" subclause when merge count equals raw fetch', () => {
  const md = renderOps({
    date: '2026-04-22',
    articlesInReport: [makeArticle(1)],
    rawFetched: 5, mergedCount: 5, sourcesWithContent: 2,
    filteredLowImportance: 0,
    sourceStatuses: [],
  });
  assert.doesNotMatch(md, /合并多推文线程/);
  assert.match(md, /共抓取 \*\*5\*\* 篇文章，来自 \*\*2\*\* 个数据源/);
});
