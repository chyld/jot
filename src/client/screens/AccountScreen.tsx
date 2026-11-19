// The Account page: the logged-in user's name, then personal backup and restore
// (backup-spec.md §3.1): back up and download, restore from a file after a summary and
// typing RESTORE, and the safety backups Jot took before each restore. There are no
// account settings: user administration is the command line's.
import { useEffect, useState } from 'react';
import { Bot as BotIcon, Copy, Download, Plus, RotateCcw, ShieldCheck, Trash2, Upload, UserRound } from 'lucide-react';
import { relativeTime } from '../../shared/time';
import type { BackupInfo, Bot, RestoreSummary, SafetyBackup } from '../../shared/types';
import { api } from '../api';
import { useData } from '../data';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function formatBytes(n: number): string {
  if (n < 1024) return plural(n, 'byte');
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const errorText = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

function startDownload(href: string, name: string) {
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function MissingList(props: { missing: BackupInfo['missing']; intro: string }) {
  if (props.missing.length === 0) return null;
  return (
    <div className="backup-warning">
      <p>{props.intro}</p>
      <ul>
        {props.missing.map((m) => (
          <li key={m.name}>{m.what}</li>
        ))}
      </ul>
    </div>
  );
}

function BackUpSection() {
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<BackupInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const backUp = async () => {
    setBusy(true);
    setError(null);
    setMade(null);
    try {
      const { backup } = await api.makeBackup();
      setMade(backup);
      startDownload(api.backupUrl(backup.id), backup.name);
    } catch (err) {
      setError(errorText(err, 'The backup failed.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card backup-section" aria-labelledby="backup-make">
      <h2 id="backup-make">Back up my data</h2>
      <p className="muted">Downloads one file with all your notes (including the trash), tags, photos, fonts and styles.</p>
      <div>
        <button type="button" className="btn btn-primary" onClick={() => void backUp()} disabled={busy}>
          <Download size={16} /> Back up my data
        </button>
      </div>
      {busy && <p className="muted" role="status">Making the backup…</p>}
      {made && (
        <p role="status">
          Downloading <strong>{made.name}</strong> ({formatBytes(made.size)}): {plural(made.counts.notes, 'note')}, {plural(made.counts.photos, 'photo')},{' '}
          {plural(made.counts.fonts, 'font')}, {plural(made.counts.styles, 'style')}.
        </p>
      )}
      {made && <MissingList missing={made.missing} intro="These were already lost before this backup was made, so they are not in it:" />}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function RestoreSection(props: { onRestored: () => void; onSafetyChange: () => void }) {
  const [phase, setPhase] = useState<'idle' | 'checking' | 'ready' | 'restoring'>('idle');
  const [staged, setStaged] = useState<{ id: string; summary: RestoreSummary } | null>(null);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [inputKey, setInputKey] = useState(0);

  const reset = () => {
    setStaged(null);
    setTyped('');
    setPhase('idle');
    setInputKey((k) => k + 1);
  };
  const choose = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setStaged(null);
    setPhase('checking');
    try {
      const { restore } = await api.stageRestore(file);
      setStaged(restore);
      setPhase('ready');
    } catch (err) {
      setError(errorText(err, 'This file could not be checked.'));
      reset();
    }
  };
  const cancel = async () => {
    if (staged) await api.cancelRestore(staged.id).catch(() => {});
    reset();
  };
  const restore = async () => {
    if (!staged || typed !== 'RESTORE') return;
    setPhase('restoring');
    setError(null);
    try {
      await api.confirmRestore(staged.id);
      props.onRestored();
    } catch (err) {
      setError(errorText(err, 'The restore failed. Your data was not changed.'));
      props.onSafetyChange();
      reset();
    }
  };

  const s = staged?.summary;
  return (
    <section className="card backup-section" aria-labelledby="backup-restore">
      <h2 id="backup-restore">Restore from a backup</h2>
      <p className="muted">
        A restore replaces all your notes, tags, photos, fonts and styles with the ones in the backup. Jot first takes a safety backup of what
        you have now.
      </p>
      <label className="file-pick">
        <span className="btn">
          <Upload size={16} /> Backup file
        </span>
        <input
          key={inputKey}
          type="file"
          accept=".tar,application/x-tar"
          disabled={phase === 'checking' || phase === 'restoring'}
          onChange={(e) => void choose(e.currentTarget.files?.[0])}
        />
      </label>
      {phase === 'checking' && (
        <p className="muted" role="status">
          Checking the backup…
        </p>
      )}
      {s && (
        <div className="restore-summary">
          <p>
            This backup was made on <strong>{when(s.createdAt)}</strong>. It holds:
          </p>
          <ul className="restore-counts">
            <li>{plural(s.counts.notes, 'note')}</li>
            <li>{plural(s.counts.photos, 'photo')}</li>
            <li>{plural(s.counts.fonts, 'font')}</li>
            <li>{plural(s.counts.styles, 'style')}</li>
          </ul>
          {s.adjustedNotes > 0 && (
            <p>
              {s.adjustedNotes === 1 ? '1 note will be adjusted' : `${s.adjustedNotes} notes will be adjusted`}: content Jot does not allow (such as
              scripts) is removed.
            </p>
          )}
          <MissingList missing={s.missing} intro="These files were already missing when the backup was made; they come back without their file:" />
          <p className="restore-warning">
            Restoring replaces everything you have now. Links to individual notes stop working, because every note gets a new address.
          </p>
          <label className="restore-confirm">
            Type RESTORE to confirm
            <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} disabled={phase === 'restoring'} />
          </label>
          <div className="card-actions">
            <button type="button" className="btn btn-danger" disabled={typed !== 'RESTORE' || phase === 'restoring'} onClick={() => void restore()}>
              <RotateCcw size={16} /> Restore
            </button>
            <button type="button" className="btn" disabled={phase === 'restoring'} onClick={() => void cancel()}>
              Cancel
            </button>
          </div>
          {phase === 'restoring' && (
            <p className="muted" role="status">
              Restoring… keep this tab open.
            </p>
          )}
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function SafetyItem(props: { backup: SafetyBackup; onDelete: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const b = props.backup;
  return (
    <li className="card safety-item">
      <div className="safety-text">
        <strong>Before the restore on {when(b.createdAt)}</strong>
        <span className="muted small">
          {b.name} · {formatBytes(b.size)}
        </span>
      </div>
      <div className="card-actions">
        <a className="btn btn-sm" href={api.safetyBackupUrl(b.name)} download={b.name}>
          <Download size={14} /> Download
        </a>
        {confirming ? (
          <>
            <button type="button" className="btn btn-sm btn-danger" onClick={props.onDelete}>
              Confirm: delete
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-sm" onClick={() => setConfirming(true)}>
            <Trash2 size={14} /> Delete
          </button>
        )}
      </div>
    </li>
  );
}

function SafetySection(props: { version: number }) {
  const [list, setList] = useState<SafetyBackup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () =>
    api.safetyBackups().then(
      (r) => setList(r.backups),
      () => setList([]),
    );
  useEffect(() => {
    void load();
  }, [props.version]);
  return (
    <section className="card backup-section" aria-labelledby="backup-safety">
      <h2 id="backup-safety">
        <ShieldCheck size={18} /> Safety backups
      </h2>
      <p className="muted">Jot takes one automatically before each restore. Jot never deletes them; you can.</p>
      {list?.length === 0 && <p className="muted">No safety backups yet.</p>}
      {list && list.length > 0 && (
        <ul className="safety-list">
          {list.map((b) => (
            <SafetyItem
              key={b.name}
              backup={b}
              onDelete={async () => {
                setError(null);
                try {
                  await api.deleteSafetyBackup(b.name);
                } catch (err) {
                  setError(errorText(err, 'Could not delete it.'));
                }
                await load();
              }}
            />
          ))}
        </ul>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

/** Copies text; where the browser refuses (plain http), says so and the text can be selected instead. */
async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** A setup snippet for a generic MCP client: the address and the Authorization header. */
export function setupSnippet(mcpUrl: string, token: string) {
  return JSON.stringify({ mcpServers: { jot: { type: 'http', url: mcpUrl, headers: { Authorization: `Bearer ${token}` } } } }, null, 2);
}

function BotItem(props: { bot: Bot; mcpUrl: string; onRevoke: () => Promise<void>; onCopied: (what: string | null) => void }) {
  const [confirming, setConfirming] = useState(false);
  const b = props.bot;
  const copied = async (text: string, what: string) => props.onCopied((await copy(text)) ? what : null);
  return (
    <li className="card bot-item">
      <div className="bot-head">
        <BotIcon size={16} />
        <strong>{b.name}</strong>
        <span className="muted small">last used: {b.lastUsedAt ? relativeTime(b.lastUsedAt, new Date()) : 'never'}</span>
      </div>
      <code className="bot-token" data-testid="bot-token">
        {b.token}
      </code>
      <div className="card-actions">
        <button type="button" className="btn btn-sm" aria-label={`Copy token for ${b.name}`} onClick={() => void copied(b.token, 'Token copied.')}>
          <Copy size={14} /> Copy
        </button>
        <button type="button" className="btn btn-sm" aria-label={`Copy setup for ${b.name}`} onClick={() => void copied(setupSnippet(props.mcpUrl, b.token), 'Setup copied.')}>
          <Copy size={14} /> Copy setup
        </button>
        {confirming ? (
          <>
            <button type="button" className="btn btn-sm btn-danger" aria-label={`Confirm: revoke ${b.name}`} onClick={() => void props.onRevoke()}>
              Confirm: revoke
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-sm" aria-label={`Revoke ${b.name}`} onClick={() => setConfirming(true)}>
            <Trash2 size={14} /> Revoke
          </button>
        )}
      </div>
    </li>
  );
}

/** Bots: one token per bot, always visible, for MCP clients (agent-spec.md §2, §4). */
function BotsSection() {
  const [data, setData] = useState<{ mcpUrl: string; bots: Bot[] } | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const load = () =>
    api.bots().then(
      (r) => setData({ mcpUrl: r.mcpUrl, bots: r.bots }),
      () => setData({ mcpUrl: '', bots: [] }),
    );
  useEffect(() => {
    void load();
  }, []);
  const onCopied = (what: string | null) => setNote(what ?? 'This browser does not allow copying here: select the text and copy it.');
  const create = async () => {
    setError(null);
    try {
      await api.createBot(name);
      setName('');
      await load();
    } catch (err) {
      setError(errorText(err, 'Could not create the bot.'));
    }
  };
  const mcpUrl = data?.mcpUrl ?? '';
  return (
    <section className="card backup-section" aria-labelledby="account-bots">
      <h2 id="account-bots">
        <BotIcon size={18} /> Bots
      </h2>
      <p className="muted">
        A bot (an AI assistant with an MCP client) can write notes into your Inbox and read your notes. It cannot change or delete anything. Give each bot its own token; revoking a token stops that bot at once.
      </p>
      <div className="bot-address">
        <span>
          Address for bots: <code>{mcpUrl}</code>
        </span>
        <button type="button" className="btn btn-sm" aria-label="Copy address" onClick={() => void copy(mcpUrl).then((ok) => onCopied(ok ? 'Address copied.' : null))}>
          <Copy size={14} /> Copy
        </button>
      </div>
      <p className="muted small">Setup for an MCP client: the address above, and this header with the bot’s token (Copy setup on a bot fills it in):</p>
      <pre className="bot-snippet">{setupSnippet(mcpUrl, 'YOUR_TOKEN')}</pre>
      <form
        className="bot-create"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <label>
          Bot name
          <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="e.g. Claude" />
        </label>
        <button type="submit" className="btn btn-primary" disabled={!name.trim()}>
          <Plus size={16} /> Create
        </button>
      </form>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {note && (
        <p className="muted small" role="status">
          {note}
        </p>
      )}
      {data && data.bots.length === 0 && <p className="muted">No bots yet.</p>}
      {data && data.bots.length > 0 && (
        <ul className="bot-list">
          {data.bots.map((b) => (
            <BotItem
              key={b.id}
              bot={b}
              mcpUrl={mcpUrl}
              onCopied={onCopied}
              onRevoke={async () => {
                setError(null);
                try {
                  await api.revokeBot(b.id);
                } catch (err) {
                  setError(errorText(err, 'Could not revoke the token.'));
                }
                await load();
              }}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

export function AccountScreen(props: { onRestored?: () => void }) {
  const { user } = useData();
  const [safetyVersion, setSafetyVersion] = useState(0);
  // After a restore the whole app reloads: every note has a new address.
  const onRestored = props.onRestored ?? (() => window.location.assign('/'));
  return (
    <div className="screen backup-screen">
      <div className="screen-head">
        <h1>Account</h1>
      </div>
      <p className="account-user">
        <UserRound size={20} />
        <span data-testid="account-username">{user.username}</span>
      </p>
      <BackUpSection />
      <RestoreSection onRestored={onRestored} onSafetyChange={() => setSafetyVersion((v) => v + 1)} />
      <SafetySection version={safetyVersion} />
      <BotsSection />
    </div>
  );
}
