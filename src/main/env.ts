import path from 'node:path';
import { app } from 'electron';
import dotenv from 'dotenv';

// Must be imported before any module that reads process.env while loading.
if (!app.isPackaged) {
  dotenv.config({
    path: [
      path.join(app.getAppPath(), '.env'),
      path.resolve(process.cwd(), '.env'),
    ],
    quiet: true,
  });
}
