// Shared helpers for server-side tests. Every test file gets its own temporary
// data folder and a real SQLite database inside it.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/server/app';
import { createUser } from '../../src/server/users';
import { startFakeGoogle, type FakeGoogle } from './fakeGoogle';

export const PASSWORD = 'correct horse battery';

export interface TestEnv {
  app: FastifyInstance;
  dataDir: string;
  google: FakeGoogle;
  close(): Promise<void>;
}

export async function makeTestEnv(): Promise<TestEnv> {
  const dataDir = mkdtempSync(join(tmpdir(), 'jot-test-'));
  const google = await startFakeGoogle();
  const app = await buildApp({ dataDir, logger: false, fonts: google.config });
  return {
    app,
    dataDir,
    google,
    async close() {
      await app.close();
      await google.close();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

export interface Res {
  status: number;
  json: any;
  body: string;
  rawPayload: Buffer;
  headers: Record<string, any>;
}

function toRes(r: any): Res {
  let json: any = undefined;
  try {
    json = JSON.parse(r.body);
  } catch {
    json = undefined;
  }
  return { status: r.statusCode, json, body: r.body, rawPayload: r.rawPayload, headers: r.headers };
}

export interface Client {
  cookie: string | null;
  get(url: string): Promise<Res>;
  post(url: string, body?: unknown): Promise<Res>;
  patch(url: string, body?: unknown): Promise<Res>;
  put(url: string, body?: unknown): Promise<Res>;
  del(url: string): Promise<Res>;
  upload(url: string, filename: string, content: Buffer, mime: string): Promise<Res>;
  /** POST a raw body (not JSON, not a form), e.g. a backup file. */
  raw(url: string, content: Buffer, contentType: string, extraHeaders?: Record<string, string>): Promise<Res>;
}

export function client(app: FastifyInstance, cookie: string | null = null): Client {
  const headers = (): Record<string, string> => (cookie ? { cookie } : {});
  const send = async (method: string, url: string, body?: unknown) =>
    toRes(
      await app.inject({
        method: method as any,
        url,
        headers: { ...headers(), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
        payload: body !== undefined ? JSON.stringify(body) : undefined,
      }),
    );
  return {
    get cookie() {
      return cookie;
    },
    set cookie(v) {
      cookie = v;
    },
    get: (url) => send('GET', url),
    post: (url, body) => send('POST', url, body ?? {}),
    patch: (url, body) => send('PATCH', url, body ?? {}),
    put: (url, body) => send('PUT', url, body ?? {}),
    del: (url) => send('DELETE', url),
    raw: async (url, content, contentType, extraHeaders = {}) =>
      toRes(
        await app.inject({
          method: 'POST',
          url,
          headers: { ...headers(), 'content-type': contentType, ...extraHeaders },
          payload: content,
        }),
      ),
    upload: async (url, filename, content, mime) => {
      const boundary = '----jottestboundary' + Math.random().toString(16).slice(2);
      const payload = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`,
        ),
        content,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
      return toRes(
        await app.inject({
          method: 'POST',
          url,
          headers: { ...headers(), 'content-type': `multipart/form-data; boundary=${boundary}` },
          payload,
        }),
      );
    },
  };
}

export function sessionCookieFrom(res: Res): string | null {
  const raw = res.headers['set-cookie'];
  const list: string[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
  for (const c of list) {
    const m = /^(jot_session=[^;]+)/.exec(c);
    if (m && !/jot_session=;/.test(c)) return m[1];
  }
  return null;
}

export async function login(app: FastifyInstance, username: string, password = PASSWORD): Promise<Client> {
  const anon = client(app);
  const res = await anon.post('/api/login', { username, password });
  if (res.status !== 200) throw new Error(`login failed for ${username}: ${res.status} ${res.body}`);
  const cookie = sessionCookieFrom(res);
  if (!cookie) throw new Error('no session cookie');
  return client(app, cookie);
}

/** Creates a user through the same code the CLI uses, then logs in. */
export async function newUser(env: TestEnv, username: string, password = PASSWORD): Promise<Client> {
  await createUser((env.app as any).jot, username, password);
  return login(env.app, username, password);
}

/** A Tiptap document with one paragraph of plain text. */
export function doc(...paragraphs: string[]) {
  return {
    type: 'doc',
    content: paragraphs.map((t) => ({ type: 'paragraph', content: t ? [{ type: 'text', text: t }] : [] })),
  };
}

// Smallest valid files for each accepted image type.
export const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
export const GIF_1PX = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
export const JPEG_HEAD = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF\0'), Buffer.alloc(32)]);
export const WEBP_HEAD = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(32)]);
