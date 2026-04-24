const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extractHandleFromUrl } = require('./derive-refs');

test('extractHandleFromUrl: tweet URL returns handle', () => {
  assert.equal(extractHandleFromUrl('https://x.com/sama/status/123'), 'sama');
});

test('extractHandleFromUrl: case preserved', () => {
  assert.equal(extractHandleFromUrl('https://x.com/OpenAIDevs/status/456'), 'OpenAIDevs');
});

test('extractHandleFromUrl: non-tweet URL returns null', () => {
  assert.equal(extractHandleFromUrl('https://openai.com/blog/xyz'), null);
});

test('extractHandleFromUrl: malformed input returns null', () => {
  assert.equal(extractHandleFromUrl(''), null);
  assert.equal(extractHandleFromUrl(null), null);
});
