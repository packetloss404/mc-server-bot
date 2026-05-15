'use client';

import { Suspense, useEffect, useState, FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';

function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const next = search.get('next') || '/';

  const [secret, setSecret] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authEnabled, setAuthEnabled] = useState<boolean | null>(null);

  // On mount, check whether auth is enabled at all. If not, show a friendly
  // message rather than a pointless form.
  useEffect(() => {
    api
      .getAuthStatus()
      .then((s) => {
        setAuthEnabled(s.enabled);
        if (!s.enabled || s.authenticated) {
          // Either auth is off, or we're already logged in — bounce back.
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
    if (!secret) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.login(secret);
      router.replace(next);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'login failed';
      setError(msg === 'invalid secret' ? 'Incorrect secret.' : msg);
      setSubmitting(false);
    }
  }

  if (authEnabled === false) {
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

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-[#09090b] text-zinc-100">
      <form
        onSubmit={onSubmit}
        className="max-w-md w-full rounded-2xl bg-zinc-900/80 border border-zinc-800 p-8 shadow-xl"
      >
        <h1 className="text-2xl font-semibold mb-2">DyoBot Dashboard</h1>
        <p className="text-zinc-400 mb-6 text-sm">
          Enter the dashboard secret to continue.
        </p>

        <label htmlFor="secret" className="block text-sm text-zinc-300 mb-2">
          Secret
        </label>
        <input
          id="secret"
          type="password"
          autoComplete="current-password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          autoFocus
          required
          className="w-full rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-2 mb-4 focus:outline-none focus:border-emerald-500"
        />

        {error && (
          <div className="mb-4 text-sm text-rose-400" role="alert">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || !secret}
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
