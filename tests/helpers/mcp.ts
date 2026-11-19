// A real MCP client (the SDK's own) talking to Jot over HTTP with a bot token.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { TestEnv } from './setup';

/** Starts the test app on a real port (once) and returns its address. */
export async function listen(env: TestEnv): Promise<string> {
  if (!env.app.server.listening) await env.app.listen({ port: 0, host: '127.0.0.1' });
  return `http://127.0.0.1:${(env.app.server.address() as any).port}`;
}

export async function connectBot(base: string, token: string) {
  const client = new Client({ name: 'jot-test-bot', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return client;
}

/** Calls a tool and returns its text (and whether it was an error). */
export async function call(client: Client, name: string, args: Record<string, unknown>) {
  const r = (await client.callTool({ name, arguments: args })) as any;
  const text = (r.content ?? []).map((c: any) => (c.type === 'text' ? c.text : '')).join('\n');
  return { text, isError: !!r.isError };
}

/** The note id a create_note answer names. */
export function idFrom(text: string): string {
  const m = /\bid: ([A-Za-z0-9_-]{22})\b/.exec(text);
  if (!m) throw new Error(`no note id in: ${text}`);
  return m[1];
}

export const b64 = (b: Buffer) => b.toString('base64');
