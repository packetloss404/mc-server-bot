'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { SettingsTabs, type SettingsTabDef } from '@/components/settings/SettingsTabs';
import { SettingsSection } from '@/components/settings/SettingsSection';

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

type TabId = 'ai' | 'server' | 'behavior' | 'affinity' | 'instincts' | 'voyager';

const TABS: ReadonlyArray<SettingsTabDef<TabId>> = [
  { id: 'ai', label: 'AI' },
  { id: 'server', label: 'Server' },
  { id: 'behavior', label: 'Behavior' },
  { id: 'affinity', label: 'Affinity' },
  { id: 'instincts', label: 'Instincts' },
  { id: 'voyager', label: 'Voyager' },
];

function isTabId(s: string | null): s is TabId {
  return s === 'ai' || s === 'server' || s === 'behavior' || s === 'affinity' || s === 'instincts' || s === 'voyager';
}

// Per-field labels + hints for the Minecraft server section. The generic
// SettingsSection renders strings as text inputs, port as a number, and
// selectClass as a checkbox; these just make the form self-documenting.
const MINECRAFT_FIELD_OVERRIDES = {
  host: { label: 'Server Host', hint: 'Hostname or IP of the Minecraft server (e.g. play.dyoburon.com or 10.80.13.14).' },
  port: { label: 'Port', hint: 'Default 25565.' },
  version: { label: 'MC Version', hint: 'Must match the target server, e.g. 1.21.11.' },
  auth: { label: 'Auth Mode', hint: 'offline (cracked usernames) or microsoft (premium accounts). Online-mode servers require microsoft.' },
  loginFlow: { label: 'Login Flow', hint: 'none = just join (vanilla/Paper). dyoauth = DyoCraft /login + /register plugin.' },
  loginPassword: { label: 'Login Password', hint: 'Only used by the dyoauth flow. Leave as ******** to keep the current password.' },
  selectClass: { label: 'DyoClasses Class Select', hint: 'Run the DyoClasses hotbar selection after login. Turn OFF for non-DyoCraft servers.' },
} as const;

// ─── Page shell ──────────────────────────────────────────────────────────

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-zinc-400">Loading…</div>}>
      <SettingsPageInner />
    </Suspense>
  );
}

function SettingsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const tabParam = searchParams.get('tab');
  const activeTab: TabId = isTabId(tabParam) ? tabParam : 'ai';

  const setActiveTab = useCallback(
    (tab: TabId) => {
      const params = new URLSearchParams(searchParams.toString());
      if (tab === 'ai') {
        params.delete('tab');
      } else {
        params.set('tab', tab);
      }
      const qs = params.toString();
      router.replace(qs ? `?${qs}` : '?', { scroll: false });
    },
    [router, searchParams],
  );

  // Per-section dirty state — populated by each <SettingsSection> via onDirtyChange.
  // Switching tabs unmounts the section (existing behavior), which clears its
  // entry; the dot is purely a visual warning that switching discards edits.
  const [dirtyTabs, setDirtyTabs] = useState<Set<TabId>>(new Set());
  const makeDirtyHandler = useCallback(
    (id: TabId) => (dirty: boolean) => {
      setDirtyTabs((prev) => {
        const has = prev.has(id);
        if (dirty === has) return prev;
        const next = new Set(prev);
        if (dirty) next.add(id);
        else next.delete(id);
        return next;
      });
    },
    [],
  );

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-zinc-400 text-sm mt-1">
            Configure providers, the target Minecraft server, behavior tuning, affinity rules, instincts, and Voyager loop options.
          </p>
        </div>

        <SettingsTabs<TabId>
          tabs={TABS}
          activeTab={activeTab}
          onChange={setActiveTab}
          dirtyTabs={dirtyTabs}
        />

        <div>
          {activeTab === 'ai' && <AiProviderTab onDirtyChange={makeDirtyHandler('ai')} />}
          {activeTab === 'server' && (
            <SettingsSection
              section="minecraft"
              title="Minecraft Server"
              description="Point the bot fleet at a Minecraft server. Changing any of these requires a dyobot restart to reconnect the fleet — the values are only read when a bot connects."
              fieldOverrides={MINECRAFT_FIELD_OVERRIDES}
              onDirtyChange={makeDirtyHandler('server')}
            />
          )}
          {activeTab === 'behavior' && (
            <SettingsSection
              section="behavior"
              title="Behavior"
              description="Tune how bots prioritize, schedule, and react to ongoing tasks."
              onDirtyChange={makeDirtyHandler('behavior')}
            />
          )}
          {activeTab === 'affinity' && (
            <SettingsSection
              section="affinity"
              title="Affinity"
              description="Adjust relationship modifiers, gift weights, and decay rates."
              onDirtyChange={makeDirtyHandler('affinity')}
            />
          )}
          {activeTab === 'instincts' && (
            <SettingsSection
              section="instincts"
              title="Instincts"
              description="Configure reflexes for combat, hunger, fear, and self-preservation."
              onDirtyChange={makeDirtyHandler('instincts')}
            />
          )}
          {activeTab === 'voyager' && (
            <SettingsSection
              section="voyager"
              title="Voyager"
              description="Tune curriculum, critic thresholds, and execution loop parameters."
              onDirtyChange={makeDirtyHandler('voyager')}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── AI provider tab ────────────────────────────────────────────────────

interface AiProviderTabProps {
  onDirtyChange?: (dirty: boolean) => void;
}

/**
 * Canonical-form serialization for dirty comparison.
 * Object keys sorted recursively so reordering doesn't show as dirty.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(',')}}`;
}

function AiProviderTab({ onDirtyChange }: AiProviderTabProps) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [usage, setUsage] = useState<UsageMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [aiEnabled, setAiEnabled] = useState<boolean>(true);
  const [togglingAi, setTogglingAi] = useState(false);

  // New provider form
  const [newProvider, setNewProvider] = useState({ name: 'gemini', apiKey: '', model: '', maxConcurrent: 3 });

  // Known model IDs per provider — surfaced in a datalist so users get a dropdown
  // but can still type any custom model ID (vendors release new ones constantly).
  // Canonical model IDs verified against each vendor's API docs (April 2026).
  // Lists are ordered current → legacy. Users can also type any custom ID.
  const MODEL_CATALOG: Record<string, string[]> = {
    gemini: [
      'gemini-2.5-flash-preview-05-20',
      'gemini-2.5-pro',
      'gemini-2.0-flash',
    ],
    anthropic: [
      // Current
      'claude-opus-4-7',
      'claude-sonnet-4-6',
      'claude-haiku-4-5',
      // Legacy but still callable
      'claude-opus-4-6',
      'claude-sonnet-4-5',
      'claude-opus-4-5',
      'claude-opus-4-1',
    ],
    openai: [
      // Frontier (gpt-5.4 family)
      'gpt-5.4',
      'gpt-5.4-pro',
      'gpt-5.4-mini',
      'gpt-5.4-nano',
      // gpt-5 family
      'gpt-5',
      'gpt-5-mini',
      'gpt-5-nano',
      // Older
      'gpt-4.1',
      'gpt-4.1-mini',
      'gpt-4o',
    ],
    minimax: [
      'MiniMax-M2.7-highspeed',
      'MiniMax-M2.7',
      'MiniMax-M2.5',
      'MiniMax-M2.1',
      'MiniMax-M2',
      'MiniMax-M1',
      'MiniMax-Text-01',
    ],
    voyage: [
      'voyage-4-large',
      'voyage-4',
      'voyage-4-lite',
      'voyage-code-3',
      'voyage-3-large',
      'voyage-3.5',
    ],
    ollama: [
      'llama3.2:3b',
      'qwen2.5-coder:3b',
      'mistral:7b',
    ],
  };

  // Route editing
  const [editRoutes, setEditRoutes] = useState<Record<string, RouteConfig>>({});

  // Baseline snapshots for dirty detection. We compare current form state to
  // these values; anything different counts as unsaved edits.
  const PRISTINE_NEW_PROVIDER = useMemo(
    () => ({ name: 'gemini', apiKey: '', model: '', maxConcurrent: 3 }),
    [],
  );
  const [routesBaseline, setRoutesBaseline] = useState<string>(stableStringify({}));

  const fetchSettings = useCallback(async () => {
    try {
      const base = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
      const [settingsRes, usageRes, enabledRes] = await Promise.all([
        fetch(`${base}/api/llm/providers`).then((r) => r.json()),
        fetch(`${base}/api/llm/usage`).then((r) => r.json()),
        fetch(`${base}/api/llm/enabled`).then((r) => r.json()).catch(() => ({ enabled: true })),
      ]);
      setSettings(settingsRes);
      setUsage(usageRes.usage);
      setEditRoutes(settingsRes.routes || {});
      setRoutesBaseline(stableStringify(settingsRes.routes || {}));
      setAiEnabled(enabledRes.enabled !== false);
    } catch {
      showFeedback('error', 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, []);

  const toggleAi = async () => {
    setTogglingAi(true);
    const newValue = !aiEnabled;
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/llm/enabled`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: newValue }),
        },
      );
      const data = await res.json();
      if (data.success) {
        setAiEnabled(data.enabled);
        showFeedback('success', newValue ? 'AI enabled — bots will resume' : 'AI disabled — all bots paused, no LLM spend');
      } else {
        showFeedback('error', data.error || 'Failed to toggle AI');
      }
    } catch {
      showFeedback('error', 'Failed to toggle AI');
    } finally {
      setTogglingAi(false);
    }
  };

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  // Dirty tracking: form is dirty when either the add-provider form has any
  // edits OR the routes table differs from the last-saved baseline.
  const newProviderDirty = useMemo(
    () => stableStringify(newProvider) !== stableStringify(PRISTINE_NEW_PROVIDER),
    [newProvider, PRISTINE_NEW_PROVIDER],
  );
  const routesDirty = useMemo(
    () => stableStringify(editRoutes) !== routesBaseline,
    [editRoutes, routesBaseline],
  );
  const dirty = newProviderDirty || routesDirty;
  const lastDirtyRef = useRef<boolean>(false);
  useEffect(() => {
    if (lastDirtyRef.current === dirty) return;
    lastDirtyRef.current = dirty;
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  // Clear dirty signal on unmount so the parent's set doesn't leak.
  useEffect(() => {
    return () => {
      if (lastDirtyRef.current) onDirtyChange?.(false);
    };
  }, [onDirtyChange]);

  const showFeedback = (type: 'success' | 'error', message: string) => {
    setFeedback({ type, message });
    setTimeout(() => setFeedback(null), 4000);
  };

  const addProvider = async () => {
    // Ollama runs locally and doesn't need an API key — everything else does.
    if (newProvider.name !== 'ollama' && !newProvider.apiKey) {
      return showFeedback('error', 'API key is required');
    }
    setSaving(true);
    try {
      const base = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
      const res = await fetch(`${base}/api/llm/providers`, {
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
        // Hot-reload the router so the new key takes effect immediately —
        // no separate "Reload Router" click required.
        const reloadRes = await fetch(`${base}/api/llm/reload`, { method: 'POST' });
        const reloadData = await reloadRes.json();
        const savedName = newProvider.name;
        setNewProvider({ name: 'gemini', apiKey: '', model: '', maxConcurrent: 3 });
        if (reloadData.success) {
          showFeedback('success', `Provider "${savedName}" saved and live (active: ${reloadData.providers.join(', ')})`);
        } else {
          showFeedback('success', `Provider "${savedName}" saved (router reload reported: ${reloadData.error ?? 'unknown'})`);
        }
      }
    } catch {
      showFeedback('error', 'Failed to save provider');
    } finally {
      setSaving(false);
    }
  };

  // Help-text URLs for getting an API key per provider.
  const KEY_HELP: Record<string, string> = {
    gemini: 'https://aistudio.google.com/app/apikey',
    anthropic: 'https://console.anthropic.com/settings/keys',
    openai: 'https://platform.openai.com/api-keys',
    minimax: 'https://platform.minimax.io/user-center/basic-information/interface-key',
    voyage: 'https://dashboard.voyageai.com/api-keys',
    ollama: '', // local, no key
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
        // Reset baseline so dirty clears after a successful save.
        setRoutesBaseline(stableStringify(data.settings?.routes ?? editRoutes));
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

  const updateRoute = (taskType: string, field: string, value: unknown) => {
    setEditRoutes((prev) => ({
      ...prev,
      [taskType]: { ...prev[taskType], provider: prev[taskType]?.provider || settings?.defaultProvider || 'gemini', [field]: value },
    }));
  };

  if (loading) return <div className="p-8 text-zinc-400">Loading settings...</div>;

  const providerNames = settings?.providers.map((p) => p.name) ?? [];

  return (
    <div
      role="tabpanel"
      id="settings-panel-ai"
      aria-labelledby="settings-tab-ai"
      className="space-y-8"
    >
      {feedback && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className={`p-3 rounded text-sm ${feedback.type === 'success' ? 'bg-emerald-900/50 text-emerald-300 border border-emerald-700' : 'bg-red-900/50 text-red-300 border border-red-700'}`}
        >
          {feedback.message}
        </motion.div>
      )}

      {/* ── AI Kill Switch ── */}
      <section
        className={`rounded-lg border p-5 ${
          aiEnabled
            ? 'bg-zinc-900 border-zinc-800'
            : 'bg-red-950/40 border-red-800'
        }`}
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              AI Enabled
              <span
                className={`text-xs px-2 py-0.5 rounded ${
                  aiEnabled
                    ? 'bg-emerald-900/50 text-emerald-300 border border-emerald-700'
                    : 'bg-red-900/60 text-red-200 border border-red-700'
                }`}
              >
                {aiEnabled ? 'ONLINE' : 'KILL SWITCH ACTIVE'}
              </span>
            </h2>
            <p className="text-zinc-400 text-sm mt-1">
              {aiEnabled
                ? 'All bots are using the LLM. Toggle off to pause voyager loops and stop all LLM spend without disconnecting bots.'
                : 'LLM calls are blocked. All voyager loops paused. Bots stay connected but idle. No API spend.'}
            </p>
          </div>
          <button
            onClick={toggleAi}
            disabled={togglingAi}
            className={`relative inline-flex h-9 w-16 items-center rounded-full border-2 transition-colors ${
              aiEnabled
                ? 'bg-emerald-600 border-emerald-500'
                : 'bg-zinc-700 border-zinc-600'
            } disabled:opacity-50`}
            aria-label="Toggle AI enabled"
          >
            <span
              className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${
                aiEnabled ? 'translate-x-8' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </section>

      {/* ── Providers ── */}
      <section className="bg-zinc-900 rounded-lg border border-zinc-800 p-5">
        <h2 className="text-lg font-semibold mb-4">Providers</h2>

        {(() => {
          const KNOWN: { id: string; label: string }[] = [
            { id: 'gemini', label: 'Gemini' },
            { id: 'anthropic', label: 'Anthropic' },
            { id: 'openai', label: 'OpenAI' },
            { id: 'minimax', label: 'MiniMax' },
            { id: 'voyage', label: 'Voyage AI (embeddings)' },
            { id: 'ollama', label: 'Ollama (local)' },
          ];
          return KNOWN.map((known) => {
            const p = settings?.providers.find((x) => x.name === known.id);
            if (p) {
              return (
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
              );
            }
            // Placeholder row for a known provider that hasn't been configured yet.
            const help = KEY_HELP[known.id];
            return (
              <div key={known.id} className="flex items-center gap-4 py-3 border-b border-zinc-800 last:border-0 opacity-60">
                <span className="w-10 h-5 rounded-full bg-zinc-800 inline-block" />
                <div className="flex-1">
                  <span className="font-mono text-sm font-semibold capitalize">{known.label}</span>
                  <span className="text-zinc-600 text-xs ml-2">not configured</span>
                </div>
                {help && (
                  <a
                    href={help}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-amber-400 hover:text-amber-300 underline"
                    title="Where to get a key"
                  >
                    get key ↗
                  </a>
                )}
                <button
                  onClick={() => {
                    setNewProvider({ name: known.id, apiKey: '', model: '', maxConcurrent: 3 });
                    // Scroll the form into view.
                    setTimeout(() => {
                      document.getElementById('add-provider-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }, 50);
                  }}
                  className="text-emerald-400 hover:text-emerald-300 text-xs font-medium"
                >
                  + Add API key
                </button>
              </div>
            );
          });
        })()}

        {/* Add provider form */}
        <div id="add-provider-form" className="mt-4 pt-4 border-t border-zinc-800 scroll-mt-6">
          <h3 className="text-sm font-medium text-zinc-400 mb-2">Add / Update Provider</h3>
          <div className="grid grid-cols-2 gap-3">
            <select
              value={newProvider.name}
              onChange={(e) => setNewProvider((p) => ({ ...p, name: e.target.value, model: '' }))}
              className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm"
            >
              <option value="gemini">Gemini</option>
              <option value="anthropic">Anthropic</option>
              <option value="openai">OpenAI</option>
              <option value="minimax">MiniMax</option>
              <option value="voyage">Voyage AI (embeddings)</option>
              <option value="ollama">Ollama (local)</option>
            </select>
            <div>
              <input
                type="password"
                placeholder={newProvider.name === 'ollama' ? 'Not required (local)' : `${newProvider.name} API key`}
                value={newProvider.apiKey}
                onChange={(e) => setNewProvider((p) => ({ ...p, apiKey: e.target.value }))}
                disabled={newProvider.name === 'ollama'}
                className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm w-full disabled:opacity-50"
              />
              {KEY_HELP[newProvider.name] && (
                <p className="text-[10px] text-zinc-500 mt-1">
                  Get a key:{' '}
                  <a
                    href={KEY_HELP[newProvider.name]}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-amber-400 hover:text-amber-300 underline"
                  >
                    {KEY_HELP[newProvider.name].replace(/^https?:\/\//, '').split('/')[0]}
                  </a>
                </p>
              )}
            </div>
            <div>
              <input
                type="text"
                list={`models-${newProvider.name}`}
                placeholder="Model (pick from list or type custom)"
                value={newProvider.model}
                onChange={(e) => setNewProvider((p) => ({ ...p, model: e.target.value }))}
                className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm w-full"
              />
              <datalist id={`models-${newProvider.name}`}>
                {(MODEL_CATALOG[newProvider.name] || []).map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </div>
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
            const route = editRoutes[taskType] || ({} as RouteConfig);
            const routeProviderModels = MODEL_CATALOG[route.provider || ''] || [];
            return (
              <div key={taskType} className="grid grid-cols-6 gap-2 items-center">
                <span className="text-sm font-mono text-amber-400">{taskType}</span>
                <select
                  value={route.provider || ''}
                  onChange={(e) => updateRoute(taskType, 'provider', e.target.value)}
                  className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs"
                >
                  <option value="">Default</option>
                  {providerNames.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
                <div>
                  <input
                    type="text"
                    list={`route-models-${taskType}`}
                    placeholder="Model (optional)"
                    value={route.model || ''}
                    onChange={(e) => updateRoute(taskType, 'model', e.target.value || undefined)}
                    className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs w-full"
                  />
                  <datalist id={`route-models-${taskType}`}>
                    {routeProviderModels.map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                </div>
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
  );
}
