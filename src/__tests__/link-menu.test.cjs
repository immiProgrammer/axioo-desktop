const assert = require('node:assert/strict');
const { test } = require('node:test');

process.env.APP_URL = 'https://axioo.store/';
const { buildLinkMenuTemplate } = require('../main/link-menu.ts');

const actions = () => {
  const calls = [];
  return {
    calls,
    openInNewTab: () => calls.push('openInNewTab'),
    openLink: () => calls.push('openLink'),
    copyLink: () => calls.push('copyLink'),
  };
};

const labels = (template) =>
  template.map((item) => (item.type === 'separator' ? '-' : item.label));

test('store links can open in a new tab, in the browser, or be copied', () => {
  const handlers = actions();
  const template = buildLinkMenuTemplate(
    'https://axioo.store/pricing',
    handlers,
  );
  assert.deepEqual(labels(template), [
    'Open in New Tab',
    'Open Link',
    '-',
    'Copy Link',
  ]);
  template[0].click();
  template[1].click();
  template[3].click();
  assert.deepEqual(handlers.calls, ['openInNewTab', 'openLink', 'copyLink']);
});

test('the app root counts as a store link', () => {
  const template = buildLinkMenuTemplate('https://axioo.store/', actions());
  assert.equal(labels(template)[0], 'Open in New Tab');
});

test('external links skip the new tab item but keep open and copy', () => {
  const template = buildLinkMenuTemplate('https://example.com/docs', actions());
  assert.deepEqual(labels(template), ['Open Link', '-', 'Copy Link']);
});

test('the surrounding whitespace is trimmed before the menu is built', () => {
  const template = buildLinkMenuTemplate('  https://axioo.store/  ', actions());
  assert.deepEqual(labels(template), [
    'Open in New Tab',
    'Open Link',
    '-',
    'Copy Link',
  ]);
});

test('a right click without a link shows no menu', () => {
  assert.deepEqual(buildLinkMenuTemplate('', actions()), []);
  assert.deepEqual(buildLinkMenuTemplate('   ', actions()), []);
});
