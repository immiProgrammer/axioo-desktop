/* eslint-disable promise/always-return */
/**
 * Rasterise an SVG to a PNG with Chromium, so the icons match what Electron
 * draws on screen. The mark is drawn on a flat green field that
 * generate-icons.py keys out to recover transparency.
 *
 * The bitmap is produced on an offscreen canvas rather than by capturing the
 * window, so the pixel size is exact and never clamped to the display.
 *
 * Usage: npx electron .erb/scripts/render-mark.cjs <svg> <out.png> <size>
 */
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const KEY_COLOR = '#00ff00';

const [, , svgArg, outArg, sizeArg] = process.argv;
if (!svgArg || !outArg || !sizeArg) {
  console.error('Usage: render-mark.cjs <svg> <out.png> <size>');
  app.exit(1);
}

const size = Number(sizeArg);
const svg = fs.readFileSync(svgArg, 'utf8');
const html = `<!doctype html><meta charset="utf-8">
<style>html, body { margin: 0; background: ${KEY_COLOR}; }</style>
<canvas id="raster" width="${size}" height="${size}"></canvas>
<script>
  const svg = ${JSON.stringify(svg)};
  window.renderMark = () =>
    new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.getElementById('raster');
        const context = canvas.getContext('2d');
        context.fillStyle = '${KEY_COLOR}';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png'));
      };
      image.onerror = () => reject(new Error('the SVG could not be decoded'));
      image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
</script>`;

app
  .whenReady()
  .then(async () => {
    const window = new BrowserWindow({
      show: false,
      width: 400,
      height: 400,
      frame: false,
      backgroundColor: KEY_COLOR,
    });
    try {
      await window.loadURL(
        `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
      );
      const dataUrl = await window.webContents.executeJavaScript(
        'window.renderMark()',
      );
      const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
      fs.mkdirSync(path.dirname(outArg), { recursive: true });
      fs.writeFileSync(outArg, Buffer.from(base64, 'base64'));
    } catch (error) {
      console.error(error);
      app.exit(1);
    } finally {
      window.destroy();
    }
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
