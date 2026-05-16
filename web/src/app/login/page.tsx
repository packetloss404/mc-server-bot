'use client';

import { Suspense, useEffect, useState, FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';

function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const next = search.get('next') || '/';

  const [secret, setSecret] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authEnabled, setAuthEnabled] = useState<boolean | null>(null);
  /**
   * Followup #58 — true when the backend has a configured `auth.devSecret`,
   * which means the player-identity login MUST supply that secret. When
   * false, any playerName succeeds (local-dev mode).
   */
  const [playerAuthEnforced, setPlayerAuthEnforced] = useState<boolean>(false);

  // On mount, check whether auth is enabled at all. If not, show a friendly
  // message rather than a pointless form.
  useEffect(() => {
    api
      .getAuthStatus()
      .then((s) => {
        setAuthEnabled(s.enabled);
        setPlayerAuthEnforced(Boolean(s.playerAuthEnforced));
        // Bounce only when the dashboard secret is fully disabled AND the
        // user is already authenticated. With Followup #58 the page also
        // doubles as a player-identity login, so leaving them on it is fine
        // even when s.authenticated is true.
        if (!s.enabled && !s.playerAuthEnforced) {
          router.replace(next);
        } else if (s.authenticated && s.playerName) {
          router.replace(next);
        }
      })
      .catch(() => {
        // If we can't reach the server, assume auth is on and let the user try.
        setAuthEnabled(true);
      });
  }, [next, router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (playerName.trim().length > 0) {
        // Followup #58 — mint a player-identity session.
        await api.loginAs(playerName.trim(), secret || undefined);
      } else {
        if (!secret) {
          setError('Enter a secret or a player name.');
          setSubmitting(false);
          return;
        }
        await api.login(secret);
      }
      router.replace(next);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'login failed';
      setError(msg === 'invalid secret' ? 'Incorrect secret.' : msg);
      setSubmitting(false);
    }
  }

  if (authEnabled === false && !playerAuthEnforced) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-[#09090b] text-zinc-100">
        <div className="max-w-md w-full rounded-2xl bg-zinc-900/80 border border-zinc-800 p-8 shadow-xl">
          <h1 className="text-2xl font-semibold mb-3">Auth disabled</h1>
          <p className="text-zinc-400 mb-6">
            DyoBot is running without a dashboard secret. Set{' '}
            <code className="px-1 rounded bg-zinc-800 text-emerald-300">DASHBOARD_AUTH_SECRET</code>{' '}
            in <code className="px-1 rounded bg-zinc-800">.env</code> to require login.
          </p>
          <button
            type="button"
            onClick={() => router.replace(next)}
            className="w-full rounded-lg bg-emerald-500 hover:bg-emerald-400 text-zinc-900 font-medium py-2 px-4 transition"
          >
            Continue to dashboard
          </button>
        </div>
      </div>
    );
  }

  const submitDisabled = submitting || (!secret && !playerName.trim());

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-[#09090b] text-zinc-100">
      <form
        onSubmit={onSubmit}
        className="max-w-md w-full rounded-2xl bg-zinc-900/80 border border-zinc-800 p-8 shadow-xl"
      >
        <h1 className="text-2xl font-semibold mb-2">DyoBot Dashboard</h1>
        <p className="text-zinc-400 mb-6 text-sm">
          Sign in with your Minecraft player name to issue mayor decrees, or
          leave it blank to unlock dashboard-only access with the secret.
        </p>

        <label htmlFor="playerName" className="block text-sm text-zinc-300 mb-2">
          Player name (optional)
        </label>
        <input
          id="playerName"
          type="text"
          autoComplete="username"
          value={playerName}
          onChange={(e) => setPlayerName(e.target.value)}
          placeholder="e.g. Steve"
          maxLength={64}
          className="w-full rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-2 mb-4 focus:outline-none focus:border-emerald-500"
        />

        <label htmlFor="secret" className="block text-sm text-zinc-300 mb-2">
          Secret {playerName.trim() && !playerAuthEnforced ? '(optional)' : ''}
        </label>
        <input
          id="secret"
          type="password"
          autoComplete="current-password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          autoFocus
          className="w-full rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-2 mb-4 focus:outline-none focus:border-emerald-500"
        />

        {error && (
          <div className="mb-4 text-sm text-rose-400" role="alert">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitDisabled}
          className="w-full rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:bg-zinc-700 disabled:text-zinc-400 text-zinc-900 font-medium py-2 px-4 transition"
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#09090b]" />}>
      <LoginForm />
    </Suspense>
  );
}
