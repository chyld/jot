// Env-guarded failpoints, used only by the tests to stop a backup or restore at an exact
// step. With JOT_FAILPOINT unset (always, in production) they do nothing.
//
//   JOT_FAILPOINT=<name>             the process kills itself (SIGKILL): a real crash
//   JOT_FAILPOINT=<name>:throw       the step throws, as an ordinary failure would
//   JOT_FAILPOINT=<name>:sleep=<ms>  the step waits, so tests can act while it runs
function plan(name: string): 'kill' | 'throw' | number | null {
  const v = process.env.JOT_FAILPOINT;
  if (!v) return null;
  if (v === name) return 'kill';
  if (v === `${name}:throw`) return 'throw';
  const m = v.startsWith(`${name}:sleep=`) ? /^\d+$/.exec(v.slice(name.length + 7)) : null;
  return m ? Number(m[0]) : null;
}

function act(name: string, p: 'kill' | 'throw' | number | null) {
  if (p === 'kill') process.kill(process.pid, 'SIGKILL');
  if (p === 'throw') throw new Error(`failpoint ${name}`);
}

export async function failpoint(name: string): Promise<void> {
  const p = plan(name);
  if (typeof p === 'number') await new Promise((r) => setTimeout(r, p));
  else act(name, p);
}

/** For steps inside a database transaction, which cannot wait. */
export function failpointSync(name: string): void {
  const p = plan(name);
  if (p === 'kill' || p === 'throw') act(name, p);
}
