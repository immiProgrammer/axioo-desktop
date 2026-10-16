import type { MenuItemConstructorOptions } from 'electron';

export type TabMenuActions = {
  editUrl: () => void;
  setAsBaseUrl: () => void;
  closeTab: () => void;
};

/**
 * Context menu for right-clicking on a tab in the tab strip.
 */
export const buildTabContextMenuTemplate = (
  actions: TabMenuActions,
): MenuItemConstructorOptions[] => [
  {
    label: 'Edit URL',
    click: actions.editUrl,
  },
  {
    label: 'Set as Base URL',
    click: actions.setAsBaseUrl,
  },
  { type: 'separator' },
  {
    label: 'Close Tab',
    click: actions.closeTab,
  },
];
