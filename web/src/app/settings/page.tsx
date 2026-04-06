'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { motion } from 'framer-motion';

const TASK_TYPES = ['codegen', 'curriculum', 'critic', 'chat', 'embed'] as const;

interface Provider {
  name: string;
  apiKey: string;
  keyMasked: string;
  model: string;
  maxConcurrentRequests: number;
  enabled: boolean;
}

interface RouteConfig {
  provider: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  useThinking?: boolean;
  fallback?: string[];
}

interface Settings {
  providers: Provider[];
  routes: Record<string, RouteConfig>;
  defaultProvider: string;
}

interface UsageMetrics {
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalEstimatedCostUsd: number;
  avgLatencyMs: number;
  successRate: number;
  byProvider: Record<string, { calls: number; tokens: number; cost: number }>;
  byTaskType: Record<string, { calls: number; tokens: number; cost: number }>;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [usage, setUsage] = useState<UsageMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // New provider form
  const [newProvider, setNewProvider] = useState({ name: 'gemini', apiKey: '', model: '', maxConcurrent: 3 });

  // Route editing
  const [editRoutes, setEditRoutes] = useState<Record<string, RouteConfig>>({});

  const fetchSettings = useCallback(async () => {
    try {
      const [settingsRes, usageRes] = await Promise.all([
        fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/llm/providers`).then((r) => r.json()),
        fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/llm/usage`).then((r) => r.json()),
      ]);
      setSettings(settingsRes);
      setUsage(usageRes.usage);
      setEditRoutes(settingsRes.routes || {});
    } catch {
      showFeedback('error', 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  const showFeedback = (type: 'success' | 'error', message: string) => {
    setFeedback({ type, message });
    setTimeout(() => setFeedback(null), 4000);
  };

  const addProvider = async () => {
    if (!newProvider.apiKey) return showFeedback('error', 'API key is required');
    setSaving(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/llm/providers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newProvider.name,
          apiKey: newProvider.apiKey,
          model: newProvider.model,
          maxConcurrentRequests: newProvider.maxConcurrent,
          enabled: true,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSettings(data.settings);
        setNewProvider({ name: 'gemini', apiKey: '', model: '', maxConcurrent: 3 });
        showFeedback('success', `Provider "${newProvider.name}" saved`);
      }
    } catch {
      showFeedback('error', 'Failed to save provider');
    } finally {
      setSaving(false);
    }
  };

  const removeProvider = async (name: string) => {
    try {
      await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/llm/providers/${name}`, { method: 'DELETE' });
      await fetchSettings();
      showFeedback('success', `Removed ${name}`);
    } catch {
      showFeedback('error', 'Failed to remove provider');
    }
  };

  const toggleProvider = async (provider: Provider) => {
    try {
      await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/llm/providers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...provider, enabled: !provider.enabled }),
      });
      await fetchSettings();
    } catch {
      showFeedback('error', 'Failed to toggle provider');
    }
  };

  const saveRoutes = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/llm/routes`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ routes: editRoutes, defaultProvider: settings?.defaultProvider }),
      });
      const data = await res.json();
      if (data.success) {
        setSettings(data.settings);
        showFeedback('success', 'Routes saved');
      }
    } catch {
      showFeedback('error', 'Failed to save routes');
    } finally {
      setSaving(false);
    }
  };

  const reloadRouter = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/llm/reload`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showFeedback('success', `Router reloaded with providers: ${data.providers.join(', ')}`);
      } else {
        showFeedback('error', data.error || 'Reload failed');
      }
    } catch {
      showFeedback('error', 'Failed to reload router');
    } finally {
      setSaving(false);
    }
  };

  const updateRoute = (taskType: string, field: string, value: any) => {
    setEditRoutes((prev) => ({
      ...prev,
      [taskType]: { ...prev[taskType], provider: prev[taskType]?.provider || settings?.defaultProvider || 'gemini', [field]: value },
    }));
  };

  if (loading) return <div className="p-8 text-zinc-400">Loading settings...</div>;

  const providerNames = settings?.providers.map((p) => p.name) ?? [];

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6">
      <div className="max-w-4xl mx-auto space-y-8">
        <div>
          <h1 className="text-2xl font-bold">AI Settings</h1>
          <p className="text-zinc-400 text-sm mt-1">Manage LLM providers, API keys, and task routing</p>
        </div>

        {feedback && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`p-3 rounded text-sm ${feedback.type === 'success' ? 'bg-emerald-900/50 text-emerald-300 border border-emerald-700' : 'bg-red-900/50 text-red-300 border border-red-700'}`}
          >
            {feedback.message}
          </motion.div>
        )}

        {/* ── Providers ── */}
        <section className="bg-zinc-900 rounded-lg border border-zinc-800 p-5">
          <h2 className="text-lg font-semibold mb-4">Providers</h2>

          {settings?.providers.map((p) => (
            <div key={p.name} className="flex items-center gap-4 py-3 border-b border-zinc-800 last:border-0">
              <button
                onClick={() => toggleProvider(p)}
                className={`w-10 h-5 rounded-full relative transition ${p.enabled ? 'bg-emerald-600' : 'bg-zinc-700'}`}
                title={p.enabled ? 'Disable' : 'Enable'}
              >
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${p.enabled ? 'left-5' : 'left-0.5'}`} />
              </button>
              <div className="flex-1">
                <span className="font-mono text-sm font-semibold capitalize">{p.name}</span>
                <span className="text-zinc-500 text-xs ml-2">{p.model || 'default model'}</span>
              </div>
              <span className="text-zinc-500 text-xs font-mono">{p.keyMasked}</span>
              <span className="text-zinc-600 text-xs">max {p.maxConcurrentRequests} concurrent</span>
              <button onClick={() => removeProvider(p.name)} className="text-red-500 hover:text-red-400 text-xs" title="Remove">Remove</button>
            </div>
          ))}

          {/* Add provider form */}
          <div className="mt-4 pt-4 border-t border-zinc-800">
            <h3 className="text-sm font-medium text-zinc-400 mb-2">Add / Update Provider</h3>
            <div className="grid grid-cols-2 gap-3">
              <select
                value={newProvider.name}
                onChange={(e) => setNewProvider((p) => ({ ...p, name: e.target.value }))}
                className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm"
              >
                <option value="gemini">Gemini</option>
                <option value="anthropic">Anthropic</option>
              </select>
              <input
                type="password"
                placeholder="API Key"
                value={newProvider.apiKey}
                onChange={(e) => setNewProvider((p) => ({ ...p, apiKey: e.target.value }))}
                className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm"
              />
              <input
                type="text"
                placeholder="Model (optional)"
                value={newProvider.model}
                onChange={(e) => setNewProvider((p) => ({ ...p, model: e.target.value }))}
                className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm"
              />
              <input
                type="number"
                placeholder="Max concurrent"
                value={newProvider.maxConcurrent}
                onChange={(e) => setNewProvider((p) => ({ ...p, maxConcurrent: parseInt(e.target.value) || 3 }))}
                className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm"
              />
            </div>
            <button
              onClick={addProvider}
              disabled={saving}
              className="mt-3 px-4 py-2 bg-emerald-700 hover:bg-emerald-600 rounded text-sm font-medium disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Provider'}
            </button>
          </div>
        </section>

        {/* ── Route Configuration ── */}
        <section className="bg-zinc-900 rounded-lg border border-zinc-800 p-5">
          <h2 className="text-lg font-semibold mb-4">Task Routing</h2>
          <p className="text-zinc-400 text-xs mb-4">Route different task types to different providers. Leave empty to use the default provider.</p>

          <div className="space-y-3">
            {TASK_TYPES.map((taskType) => {
              const route = editRoutes[taskType] || {};
              return (
                <div key={taskType} className="grid grid-cols-5 gap-2 items-center">
                  <span className="text-sm font-mono text-amber-400">{taskType}</span>
                  <select
                    value={route.provider || ''}
                    onChange={(e) => updateRoute(taskType, 'provider', e.target.value)}
                    className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs"
                  >
                    <option value="">Default</option>
                    {providerNames.map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                  <input
                    type="number"
                    placeholder="Max tokens"
                    value={route.maxTokens || ''}
                    onChange={(e) => updateRoute(taskType, 'maxTokens', parseInt(e.target.value) || undefined)}
                    className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs"
                  />
                  <select
                    value={route.fallback?.[0] || ''}
                    onChange={(e) => updateRoute(taskType, 'fallback', e.target.value ? [e.target.value] : undefined)}
                    className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs"
                  >
                    <option value="">No fallback</option>
                    {providerNames.map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                  {taskType === 'codegen' && (
                    <label className="flex items-center gap-1 text-xs text-zinc-400">
                      <input
                        type="checkbox"
                        checked={route.useThinking || false}
                        onChange={(e) => updateRoute(taskType, 'useThinking', e.target.checked)}
                        className="rounded"
                      />
                      Thinking
                    </label>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex gap-3 mt-4">
            <button
              onClick={saveRoutes}
              disabled={saving}
              className="px-4 py-2 bg-blue-700 hover:bg-blue-600 rounded text-sm font-medium disabled:opacity-50"
            >
              Save Routes
            </button>
            <button
              onClick={reloadRouter}
              disabled={saving}
              className="px-4 py-2 bg-amber-700 hover:bg-amber-600 rounded text-sm font-medium disabled:opacity-50"
            >
              Reload Router
            </button>
          </div>
        </section>

        {/* ── Usage Stats ── */}
        {usage && usage.totalCalls > 0 && (
          <section className="bg-zinc-900 rounded-lg border border-zinc-800 p-5">
            <h2 className="text-lg font-semibold mb-4">Token Usage</h2>
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-emerald-400">{usage.totalCalls.toLocaleString()}</div>
                <div className="text-xs text-zinc-500">Total Calls</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-400">{(usage.totalInputTokens + usage.totalOutputTokens).toLocaleString()}</div>
                <div className="text-xs text-zinc-500">Total Tokens</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-amber-400">${usage.totalEstimatedCostUsd.toFixed(4)}</div>
                <div className="text-xs text-zinc-500">Est. Cost</div>
              </div>
            </div>

            {Object.keys(usage.byProvider).length > 0 && (
              <div className="mt-4">
                <h3 className="text-sm font-medium text-zinc-400 mb-2">By Provider</h3>
                {Object.entries(usage.byProvider).map(([name, data]) => (
                  <div key={name} className="flex items-center justify-between py-1 text-sm">
                    <span className="font-mono capitalize">{name}</span>
                    <span className="text-zinc-500">{data.calls} calls, {data.tokens.toLocaleString()} tokens, ${data.cost.toFixed(4)}</span>
                  </div>
                ))}
              </div>
            )}

            {Object.keys(usage.byTaskType).length > 0 && (
              <div className="mt-4">
                <h3 className="text-sm font-medium text-zinc-400 mb-2">By Task Type</h3>
                {Object.entries(usage.byTaskType).map(([type, data]) => (
                  <div key={type} className="flex items-center justify-between py-1 text-sm">
                    <span className="font-mono text-amber-400">{type}</span>
                    <span className="text-zinc-500">{data.calls} calls, {data.tokens.toLocaleString()} tokens, ${data.cost.toFixed(4)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
