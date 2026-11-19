// Jot's command-line tool: user administration, and the full system backup.
//
//   jot create-user <username>     create an account with the starter pack
//   jot set-password <username>    set a new password and end that user's sessions
//   jot list-users                 show the existing accounts
//   jot backup [--out <folder>]    write a full backup (default: data/backups)
//   jot verify <file>              check a backup completely, changing nothing
//   jot restore <file>             rebuild the system from a backup (app stopped, empty data folder)
//
// Passwords are read from the terminal (hidden, asked twice) or, when piped, from
// the first line of standard input. Run with: docker compose exec app jot <command>
// (jot restore runs with the app stopped: docker compose run --rm app jot restore <file>).
//
// Every command takes the system-wide backup lock (data/.lock) while it runs.
import { join, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { BackupError } from '../server/backup/errors';
import { takeLock } from '../server/backup/lock';
import { createSystemBackup, restoreSystemBackup, verifyBackup } from '../server/backup/system';
import { DEFAULT_STARTER_FONTS_DIR, type JotContext } from '../server/context';
import { openDatabase } from '../server/db';
import { GOOGLE_FONTS } from '../server/fonts';
import { createUser, listUsers, setPassword, UserError } from '../server/users';

const USAGE = `Usage:
  jot create-user <username>     Create an account (with the starter pack)
  jot set-password <username>    Set a new password and end that user's sessions
  jot list-users                 Show the existing accounts
  jot backup [--out <folder>]    Write a full backup of everything (default: data/backups)
  jot verify <file>              Check a backup completely without changing anything
  jot restore <file>             Rebuild the system from a backup into an empty data folder
                                 (with Jot stopped: docker compose run --rm app jot restore <file>)`;

function readHidden(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    process.stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stdout.write('\n');
          return resolve(value);
        }
        if (ch === '\u0003') {
          stdin.setRawMode(false);
          process.stdout.write('\n');
          return reject(new UserError('Cancelled.'));
        }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function readStdinLine(): Promise<string> {
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  return data.split(/\r?\n/)[0] ?? '';
}

async function askPassword(): Promise<string> {
  if (!process.stdin.isTTY) return readStdinLine();
  const first = await readHidden('Password: ');
  const second = await readHidden('Repeat password: ');
  if (first !== second) throw new UserError('The passwords do not match.');
  return first;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function countsLine(c: { users?: number; notes: number; photos: number; fonts: number; styles: number }) {
  const parts = [];
  if (c.users !== undefined) parts.push(plural(c.users, 'user'));
  parts.push(plural(c.notes, 'note'), plural(c.photos, 'photo'), plural(c.fonts, 'font'), plural(c.styles, 'style'));
  return parts.join(', ');
}

function printMissing(missing: Array<{ name: string; what: string }>, intro: string, out: (s: string) => void) {
  if (missing.length === 0) return;
  out(`${intro} (${plural(missing.length, 'file')}):`);
  for (const m of missing) out(`  ${m.name}: ${m.what}`);
}

function appUrls(): string[] {
  const env = process.env.JOT_APP_URLS;
  if (env) return env.split(',').map((s) => s.trim()).filter(Boolean);
  // In Compose: the app service by name (from a "docker compose run" container), and this container.
  return ['http://app:9003', `http://127.0.0.1:${process.env.PORT ?? 9003}`];
}

async function userCommand(dataDir: string, command: string, args: string[]): Promise<number> {
  mkdirSync(join(dataDir, 'users'), { recursive: true });
  const ctx: JotContext = {
    db: openDatabase(join(dataDir, 'jot.db')),
    dataDir,
    starterFontsDir: DEFAULT_STARTER_FONTS_DIR,
    fontSource: GOOGLE_FONTS,
  };
  try {
    if (command === 'list-users') {
      const users = listUsers(ctx);
      if (users.length === 0) console.log('No users yet.');
      for (const u of users) console.log(`${u.username.padEnd(32)}  created ${u.createdAt}`);
      return 0;
    }
    const password = await askPassword();
    if (command === 'create-user') {
      const u = await createUser(ctx, args[0], password);
      console.log(`Created user "${u.username}".`);
    } else {
      const u = await setPassword(ctx, args[0], password);
      console.log(`Password updated for "${u.username}"; their existing sessions have ended.`);
    }
    return 0;
  } finally {
    ctx.db.close();
  }
}

async function main(argv: string[]): Promise<number> {
  const [command, ...args] = argv;
  const dataDir = process.env.DATA_DIR ?? './data';
  try {
    switch (command) {
      case 'create-user':
      case 'set-password':
      case 'list-users': {
        if (command === 'list-users' ? args.length !== 0 : args.length !== 1) break;
        const lock = takeLock(dataDir);
        try {
          return await userCommand(dataDir, command, args);
        } finally {
          lock.release();
        }
      }
      case 'backup': {
        let out = join(dataDir, 'backups');
        if (args.length === 2 && args[0] === '--out') out = args[1];
        else if (args.length !== 0) break;
        const r = await createSystemBackup(dataDir, resolve(out));
        console.log(`Backup written: ${r.file}`);
        console.log(`SHA-256: ${r.sha256}`);
        console.log(`Contains: ${countsLine(r.counts)}. Sessions are not included.`);
        printMissing(r.missing, 'Warning: these files were already missing and are not in the backup', (s) => console.log(s));
        console.log('Verified: the backup reads back complete and correct.');
        if (r.sameDisk) {
          console.log('Note: this backup is on the same disk as the data. Copy it to another disk, or use --out to write it there.');
        }
        console.log('It contains password hashes: keep it private.');
        return 0;
      }
      case 'verify': {
        if (args.length !== 1) break;
        const lock = takeLock(dataDir);
        try {
          const r = await verifyBackup(resolve(args[0]));
          console.log(`OK: ${args[0]} is a complete ${r.kind === 'system' ? 'full system' : 'personal'} backup made ${r.createdAt}.`);
          console.log(`Contains: ${countsLine(r.counts)}.`);
          if (r.sha256File === 'matched') console.log('It matches its .sha256 file.');
          else console.log('There is no .sha256 file beside it; it was checked against its own manifest.');
          printMissing(r.missing, 'These files were already missing when it was made', (s) => console.log(s));
          return 0;
        } finally {
          lock.release();
        }
      }
      case 'restore': {
        if (args.length !== 1) break;
        const r = await restoreSystemBackup(dataDir, resolve(args[0]), appUrls());
        console.log(`Restored from ${args[0]} (made ${r.createdAt}): ${countsLine(r.counts)}.`);
        printMissing(r.missing, 'These files were already missing when the backup was made, and are still missing', (s) => console.log(s));
        console.log('Everyone has to sign in again. Start Jot: docker compose up -d');
        return 0;
      }
    }
    console.error(USAGE);
    return 2;
  } catch (err) {
    if (err instanceof UserError || err instanceof BackupError) {
      console.error(`Error: ${err.message}`);
      return 1;
    }
    throw err;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
