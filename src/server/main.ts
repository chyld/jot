// Starts Jot on PORT (9003) with its state in DATA_DIR (/data in the container).
import { accessSync, constants, mkdirSync } from 'node:fs';
import { buildApp } from './app';

const dataDir = process.env.DATA_DIR ?? './data';
const port = Number(process.env.PORT ?? 9003);

try {
  mkdirSync(dataDir, { recursive: true });
  accessSync(dataDir, constants.W_OK);
} catch {
  console.error(
    `Jot cannot write to its data folder (${dataDir}). Check that ./data exists and is owned by the user the container runs as (JOT_UID/JOT_GID).`,
  );
  process.exit(1);
}

const app = await buildApp({
  dataDir,
  logger: true,
  secureCookies: process.env.JOT_SECURE_COOKIES === '1',
});

const shutdown = async () => {
  await app.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await app.listen({ port, host: '0.0.0.0' });
