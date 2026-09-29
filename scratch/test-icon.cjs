const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    show: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, '../release/app/dist/preload/preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    }
  });

  await win.loadFile(path.join(__dirname, '../release/app/dist/renderer/index.html'));
  await new Promise(r => setTimeout(r, 1000));

  const info = await win.webContents.executeJavaScript(`(() => {
    const icon = document.querySelector('.axioo-menu-icon');
    const btn = document.querySelector('.axioo-menu-button');
    const matched = [];
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          if (rule.selectorText && icon.matches(rule.selectorText)) {
            matched.push({ selector: rule.selectorText, cssText: rule.cssText });
          }
        }
      } catch (e) {}
    }
    return {
      matched,
      computedWidth: getComputedStyle(icon).width,
      computedHeight: getComputedStyle(icon).height,
      iconInlineStyle: icon.style.cssText,
      parentFlex: getComputedStyle(btn).display,
      parentWidth: getComputedStyle(btn).width
    };
  })()`);

  console.log('TEST_INFO:', JSON.stringify(info, null, 2));

  const image = await win.webContents.capturePage({ x: 0, y: 0, width: 200, height: 40 });
  fs.writeFileSync(path.join(__dirname, 'titlebar-capture.png'), image.toPNG());
  console.log('WROTE titlebar-capture.png');

  app.quit();
});
