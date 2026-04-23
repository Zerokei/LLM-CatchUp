const { test } = require('node:test');
const assert = require('node:assert/strict');
const { renderFallbackReport } = require('./fallback-report');

test('renderFallbackReport: explicit fallback header and per-source article list', () => {
  const fetchCache = {
    sources: {
      'OpenAI Blog': {
        status: 'ok', articles: [
          { title: 'Hello', url: 'https://openai.com/index/hello', published_at: '2026-04-22' },
        ],
      },
      'Sam Altman (Twitter)': {
        status: 'ok', articles: [
          { title: 'tweet', url: 'https://x.com/sama/status/1', published_at: '2026-04-22' },
        ],
      },
      'Berkeley RDI': { status: 'ok', articles: [] },
    },
  };
  const md = renderFallbackReport('2026-04-22', fetchCache);
  assert.match(md, /^# CatchUp 日报 — 2026-04-22（fallback/m);
  assert.match(md, /Claude 分析环节未在预期窗口内产出/);
  assert.match(md, /## OpenAI Blog/);
  assert.match(md, /- \[Hello\]\(https:\/\/openai\.com\/index\/hello\)/);
  assert.match(md, /## Sam Altman \(Twitter\)/);
  assert.match(md, /- \[tweet\]\(https:\/\/x\.com\/sama\/status\/1\)/);
  assert.doesNotMatch(md, /## Berkeley RDI/, 'sources with zero articles are omitted');
});

test('renderFallbackReport: zero-article day still renders with placeholder', () => {
  const fetchCache = { sources: { 'OpenAI Blog': { status: 'ok', articles: [] } } };
  const md = renderFallbackReport('2026-04-22', fetchCache);
  assert.match(md, /今日抓取窗口内全部数据源均无新内容/);
});
