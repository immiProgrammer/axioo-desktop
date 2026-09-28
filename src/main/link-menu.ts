import type { MenuItemConstructorOptions } from 'electron';
import { getInternalUrl } from './navigation';

export type LinkMenuActions = {
  openInNewTab: () => void;
  openLink: () => void;
  copyLink: () => void;
};

/**
 * Context menu for a right click on a link.
 *
 * Store links (the app root and any axioo.store page) can also be opened as
 * their own tab; every link can be handed to the default browser or copied.
 * Returns an empty template when there is no link to act on, so the caller can
 * skip the popup entirely.
 */
export const buildLinkMenuTemplate = (
  linkURL: string,
  actions: LinkMenuActions,
): MenuItemConstructorOptions[] => {
  const link = linkURL.trim();
  if (!link) return [];

  const template: MenuItemConstructorOptions[] = [];
  if (getInternalUrl(link)) {
    template.push({
      label: 'Open in New Tab',
      click: actions.openInNewTab,
    });
  }
  template.push(
    { label: 'Open Link', click: actions.openLink },
    { type: 'separator' },
    { label: 'Copy Link', click: actions.copyLink },
  );
  return template;
};
