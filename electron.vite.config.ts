import path from 'node:path';
import { defineConfig } from 'electron-vite';
import { dependencies as nativeDependencies } from './release/app/package.json';

const root = __dirname;
const nativeModules = Object.keys(nativeDependencies || {});
// Use an array so electron-vite can merge these with its builtin externals.
const external = nativeModules.flatMap((name) => [
  name,
  new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`),
]);

export default defineConfig({
  main: {
    build: {
      outDir: 'release/app/dist/main',
      sourcemap: true,
      externalizeDeps: false,
      rollupOptions: {
        input: path.join(root, 'src/main/main.ts'),
        external,
        output: { entryFileNames: 'main.js' },
      },
    },
  },
  preload: {
    build: {
      outDir: 'release/app/dist/preload',
      sourcemap: true,
      externalizeDeps: false,
      rollupOptions: {
        input: {
          preload: path.join(root, 'src/main/preload.ts'),
          'site-preload': path.join(root, 'src/main/site-preload.ts'),
        },
        external,
        output: { entryFileNames: '[name].js' },
      },
    },
  },
  renderer: {
    root: path.join(root, 'src/renderer'),
    base: './',
    server: {
      host: 'localhost',
      port: Number(process.env.PORT || 1212),
      strictPort: true,
    },
    build: {
      outDir: path.join(root, 'release/app/dist/renderer'),
      emptyOutDir: true,
      minify: 'esbuild',
      sourcemap: true,
      rollupOptions: {
        input: path.join(root, 'src/renderer/index.html'),
        output: { entryFileNames: 'renderer.js' },
      },
    },
  },
});
