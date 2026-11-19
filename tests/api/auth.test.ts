// Type 2 (API integration): login, logout and sessions.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, makeTestEnv, newUser, PASSWORD, sessionCookieFrom, type TestEnv } from '../helpers/setup';

let env: TestEnv;
beforeAll(async () => {
  env = await makeTestEnv();
  await newUser(env, 'alice');
});
afterAll(() => env.close());

describe('login', () => {
  it('logs in with the right password and sets an HTTP-only session cookie', async () => {
    const res = await client(env.app).post('/api/login', { username: 'alice', password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.json.user.username).toBe('alice');
    expect(res.json.user.id).toBeTruthy();
    expect(res.json.user.passwordHash).toBeUndefined();
    const raw = [res.headers['set-cookie']].flat().join('\n');
    expect(raw).toMatch(/jot_session=/);
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/SameSite=Lax/i);
    expect(raw).toMatch(/Path=\//i);
  });

  it('accepts the username in any case', async () => {
    const res = await client(env.app).post('/api/login', { username: 'ALICE', password: PASSWORD });
    expect(res.status).toBe(200);
  });

  it('refuses a wrong password with the same message as an unknown user', async () => {
    const wrong = await client(env.app).post('/api/login', { username: 'alice', password: 'nope nope nope' });
    const unknown = await client(env.app).post('/api/login', { username: 'nobody', password: 'nope nope nope' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.json.error).toBe(unknown.json.error);
    expect(sessionCookieFrom(wrong)).toBeNull();
  });

  it('rejects malformed login bodies', async () => {
    const c = client(env.app);
    expect((await c.post('/api/login', {})).status).toBe(400);
    expect((await c.post('/api/login', { username: 'alice' })).status).toBe(400);
    expect((await c.post('/api/login', { username: ['alice'], password: PASSWORD })).status).toBe(400);
  });
});

describe('sessions', () => {
  it('returns the current user from /api/me', async () => {
    const res = await client(env.app).post('/api/login', { username: 'alice', password: PASSWORD });
    const c = client(env.app, sessionCookieFrom(res));
    const me = await c.get('/api/me');
    expect(me.status).toBe(200);
    expect(me.json.user.username).toBe('alice');
  });

  it('answers 401 from /api/me without a session', async () => {
    expect((await client(env.app).get('/api/me')).status).toBe(401);
  });

  it('keeps separate sessions independent', async () => {
    const a = client(env.app, sessionCookieFrom(await client(env.app).post('/api/login', { username: 'alice', password: PASSWORD })));
    const b = client(env.app, sessionCookieFrom(await client(env.app).post('/api/login', { username: 'alice', password: PASSWORD })));
    expect(a.cookie).not.toBe(b.cookie);
    await a.post('/api/logout');
    expect((await a.get('/api/me')).status).toBe(401);
    expect((await b.get('/api/me')).status).toBe(200);
  });
});

describe('logout', () => {
  it('ends the session and clears the cookie', async () => {
    const res = await client(env.app).post('/api/login', { username: 'alice', password: PASSWORD });
    const c = client(env.app, sessionCookieFrom(res));
    const out = await c.post('/api/logout');
    expect(out.status).toBe(204);
    expect([out.headers['set-cookie']].flat().join('\n')).toMatch(/jot_session=;/);
    expect((await c.get('/api/me')).status).toBe(401);
    expect((await c.get('/api/notes')).status).toBe(401);
  });

  it('is harmless without a session', async () => {
    expect((await client(env.app).post('/api/logout')).status).toBe(204);
  });
});

describe('health', () => {
  it('is public', async () => {
    const res = await client(env.app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true });
  });
});
