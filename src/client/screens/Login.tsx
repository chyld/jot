import { useState } from 'react';
import { NotebookPen } from 'lucide-react';
import type { User } from '../../shared/types';
import { api, ApiError } from '../api';

export function Login(props: { onLogin: (user: User) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="login-page">
      <form
        className="login-card"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            props.onLogin((await api.login(username, password)).user);
          } catch (err) {
            setError(err instanceof ApiError && err.status === 401 ? 'Wrong username or password.' : 'Could not log in. Try again.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="login-logo">
          <NotebookPen size={30} />
          <span>Jot</span>
        </div>
        <label>
          Username
          <input name="username" autoComplete="username" autoFocus value={username} onChange={(e) => setUsername(e.target.value)} required />
        </label>
        <label>
          Password
          <input name="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && (
          <div role="alert" className="form-error">
            {error}
          </div>
        )}
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Logging in…' : 'Log in'}
        </button>
      </form>
    </div>
  );
}
