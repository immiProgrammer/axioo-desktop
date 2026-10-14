const assert = require('node:assert/strict');
const { test } = require('node:test');

const { buildTabContextMenuTemplate } = require('../main/tab-menu.ts');

const actions = () => {
  const calls = [];
  return {
    calls,
    editUrl: () => calls.push('editUrl'),
    setAsBaseUrl: () => calls.push('setAsBaseUrl'),
    closeTab: () => calls.push('closeTab'),
  };
};

const labels = (template) =>
  template.map((item) => (item.type === 'separator' ? '-' : item.label));

test('tab context menu template includes edit url, set as base url, and close tab', () => {
  const handlers = actions();
  const template = buildTabContextMenuTemplate(handlers);

  assert.deepEqual(labels(template), [
    'Edit URL',
    'Set as Base URL',
    '-',
    'Close Tab',
  ]);

  template[0].click();
  template[1].click();
  template[3].click();

  assert.deepEqual(handlers.calls, ['editUrl', 'setAsBaseUrl', 'closeTab']);
});
