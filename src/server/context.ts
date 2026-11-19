import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DB } from './db';
import type { FontSourceConfig } from './fonts';

/** Everything the routes, the CLI and the tests share. */
export interface JotContext {
  db: DB;
  dataDir: string;
  starterFontsDir: string;
  fontSource: FontSourceConfig;
}

export const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
export const DEFAULT_STARTER_FONTS_DIR = join(REPO_ROOT, 'assets', 'starter-fonts');

export const userDir = (ctx: JotContext, userId: string) => join(ctx.dataDir, 'users', userId);
export const photosDir = (ctx: JotContext, userId: string) => join(userDir(ctx, userId), 'photos');
export const fontsDir = (ctx: JotContext, userId: string) => join(userDir(ctx, userId), 'fonts');
