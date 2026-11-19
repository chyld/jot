// Type 5 (CLI): create user, update password, list users; login works afterwards;
// old sessions end on password change. The CLI runs as a real child process
// against the same data folder as a running app.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/server/app';
import { client, sessionCookieFrom } from '../helpers/setup';

const ROOT = resolve(__dirname, '../..');
let dataDir: string;
let app: FastifyInstance;

function jot(args: string[], input = '') {
  const r = spawnSync(process.execPath, ['--import', 'tsx', join(ROOT, 'src/cli/main.ts'), ...args], {
    cwd: ROOT,
    env: { ...process.env, DATA_DIR: dataDir },
    input,
    encoding: 'utf8',
    timeout: 60000,
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

async function loginStatus(username: string, password: string) {
  return (await client(app).post('/api/login', { username, password })).status;
}

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'jot-cli-'));
  app = await buildApp({ dataDir, logger: false });
});
afterAll(async () => {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('jot CLI', () => {
  it('lists no users on a fresh install', () => {
    const r = jot(['list-users']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/no users/i);
  });

  it('creates a user who can then log in and has the starter pack', async () => {
    const r = jot(['create-user', 'alice'], 'first password\n');
    expect(r.code, r.err).toBe(0);
    expect(r.out).toMatch(/created.*alice/i);
    expect(await loginStatus('alice', 'first password')).toBe(200);
    const c = client(app, sessionCookieFrom(await client(app).post('/api/login', { username: 'alice', password: 'first password' })));
    expect((await c.get('/api/fonts')).json.fonts.length).toBe(5);
    expect((await c.get('/api/styles')).json.styles.length).toBe(5);
  });

  it('lists users', () => {
    jot(['create-user', 'bob'], 'bob password 1\n');
    const r = jot(['list-users']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/alice/);
    expect(r.out).toMatch(/bob/);
    expect(r.out).not.toMatch(/argon2/);
  });

  it('refuses a duplicate username', () => {
    const r = jot(['create-user', 'ALICE'], 'another password\n');
    expect(r.code).not.toBe(0);
    expect(r.err).toMatch(/already exists/i);
  });

  it('refuses invalid usernames and short passwords', () => {
    expect(jot(['create-user', 'bad name'], 'long enough pw\n').code).not.toBe(0);
    expect(jot(['create-user', '../root'], 'long enough pw\n').code).not.toBe(0);
    expect(jot(['create-user'], 'long enough pw\n').code).not.toBe(0);
    const r = jot(['create-user', 'carol'], 'short\n');
    expect(r.code).not.toBe(0);
    expect(r.err).toMatch(/at least 8/i);
    expect(jot(['list-users']).out).not.toMatch(/carol/);
  });

  it('updates a password and ends that user’s existing sessions only', async () => {
    const aliceRes = await client(app).post('/api/login', { username: 'alice', password: 'first password' });
    const aliceSession = client(app, sessionCookieFrom(aliceRes));
    const bobSession = client(app, sessionCookieFrom(await client(app).post('/api/login', { username: 'bob', password: 'bob password 1' })));
    expect((await aliceSession.get('/api/me')).status).toBe(200);

    const r = jot(['set-password', 'alice'], 'second password\n');
    expect(r.code, r.err).toBe(0);
    expect(r.out).toMatch(/password.*alice/i);

    expect((await aliceSession.get('/api/me')).status).toBe(401);
    expect((await bobSession.get('/api/me')).status).toBe(200);
    expect(await loginStatus('alice', 'first password')).toBe(401);
    expect(await loginStatus('alice', 'second password')).toBe(200);
  });

  it('refuses to set a password for an unknown user', () => {
    const r = jot(['set-password', 'nobody'], 'whatever password\n');
    expect(r.code).not.toBe(0);
    expect(r.err).toMatch(/no user/i);
  });

  it('refuses a short new password and keeps the old one', async () => {
    const r = jot(['set-password', 'bob'], 'tiny\n');
    expect(r.code).not.toBe(0);
    expect(await loginStatus('bob', 'bob password 1')).toBe(200);
  });

  it('prints usage for unknown commands', () => {
    const r = jot(['delete-user', 'alice']);
    expect(r.code).not.toBe(0);
    expect(r.err + r.out).toMatch(/create-user/);
    expect(jot([]).code).not.toBe(0);
  });
});
