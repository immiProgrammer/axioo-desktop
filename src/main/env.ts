import path from 'node:path';
import { app } from 'electron';
import dotenv from 'dotenv';

let loaded = false;

export function loadDevEnv() {
  if (loaded) return;
  loaded = true;
  if (app && !app.isPackaged) {
    dotenv.config({
      path: [
        path.join(app.getAppPath(), '.env'),
        path.resolve(process.cwd(), '.env'),
      ],
      quiet: true,
    });
  }
}

loadDevEnv();
