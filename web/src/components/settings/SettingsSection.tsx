'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '@/components/Toast';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

// ─── Types ────────────────────────────────────────────────────────────────

export type SettingsValue =
  | string
  | number
  | boolean
  | string[]
  | { [k: string]: SettingsValue }
  | null;

export interface SettingsResponse {
  section: string;
  values: Record<string, SettingsValue>;
  restartRequired?: string[];
  restartRequiredFields?: string[];
}

export interface FieldOverride {
  /** Override the auto-generated label. */
  label?: string;
  /** Optional hint rendered below the input. */
  hint?: string;
  /** Numeric step (numbers only). */
  step?: number;
  /** Numeric min (numbers only). */
  min?: number;
  /** Numeric max (numbers only). */
  max?: number;
  /** Hide this field from the form (still round-tripped on save). */
  hidden?: boolean;
  /** Render as multi-line textarea (strings only). */
  multiline?: boolean;
}

export interface SettingsSectionProps {
  /** Section identifier used in the API path (`/api/config/:section`). */
  section: string;
  /** Visible heading for the section. */
  title: string;
  /** Optional descriptive blurb under the heading. */
  description?: string;
  /** Per-key overrides keyed by dotted path (e.g. "nested.subKey"). */
  fieldOverrides?: Record<string, FieldOverride>;
  /**
   * Called whenever the form's dirty state changes. Dirty means current values
   * diverge from the last fetched/saved baseline. Fires `false` after a
   * successful save.
   */
  onDirtyChange?: (dirty: boolean) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/** camelCase / snake_case / dotted.path → Title Case label. */
export function humanizeKey(key: string): string {
  // strip dotted prefixes — only the leaf gets humanized
  const leaf = key.split('.').pop() ?? key;
  return leaf
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase());
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function isPlainObject(v: unknown): v is Record<string, SettingsValue> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Stable-key JSON serializer for deep-equality comparison. Object keys are
 * sorted so that `{a:1,b:2}` and `{b:2,a:1}` produce identical output.
 */
function stableStringify(value: SettingsValue | Record<string, SettingsValue>): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v as SettingsValue)).join(',')}]`;
  }
  const obj = value as Record<string, SettingsValue>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

// ─── Component ────────────────────────────────────────────────────────────

export function SettingsSection({
  section,
  title,
  description,
  fieldOverrides = {},
  onDirtyChange,
}: SettingsSectionProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, SettingsValue>>({});
  const [restartRequired, setRestartRequired] = useState<string[]>([]);
  /** Baseline = last fetched or last successfully saved values (stable-stringified). */
  const [baseline, setBaseline] = useState<string>('{}');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/config/${section}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: SettingsResponse = await res.json();
      const next = data.values ?? {};
      setValues(next);
      setBaseline(stableStringify(next));
      setRestartRequired(data.restartRequired ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load section');
    } finally {
      setLoading(false);
    }
  }, [section]);

  useEffect(() => { load(); }, [load]);

  // Notify parent on dirty state transitions. Compare current values against
  // the baseline via stable-key JSON deep equality. Only fire on edge changes.
  const dirty = useMemo(() => stableStringify(values) !== baseline, [values, baseline]);
  const lastDirtyRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (lastDirtyRef.current === dirty) return;
    lastDirtyRef.current = dirty;
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  // On unmount, clear any lingering dirty signal so the parent's set stays tidy.
  useEffect(() => {
    return () => {
      if (lastDirtyRef.current) onDirtyChange?.(false);
    };
  }, [onDirtyChange]);

  const setAtPath = useCallback((path: string[], next: SettingsValue) => {
    setValues((prev) => {
      // deep clone of objects/arrays on the path so React notices the change
      const out: Record<string, SettingsValue> = { ...prev };
      let cursor: Record<string, SettingsValue> = out;
      for (let i = 0; i < path.length - 1; i++) {
        const key = path[i];
        const existing = cursor[key];
        const cloned: Record<string, SettingsValue> = isPlainObject(existing) ? { ...existing } : {};
        cursor[key] = cloned;
        cursor = cloned;
      }
      cursor[path[path.length - 1]] = next;
      return out;
    });
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/config/${section}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      // Reset baseline to the canonical post-save values so dirty clears.
      const saved = data.values ?? values;
      if (data.values) setValues(data.values);
      setBaseline(stableStringify(saved));
      const restart = data.restartRequiredFields ?? data.restartRequired ?? [];
      setRestartRequired(restart);
      toast(`${title} saved`, 'success');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Save failed';
      setError(msg);
      toast(`Failed to save ${title}: ${msg}`, 'error');
    } finally {
      setSaving(false);
    }
  }, [section, title, values, toast]);

  const fieldEntries = useMemo(() => Object.entries(values), [values]);

  return (
    <section
      role="tabpanel"
      id={`settings-panel-${section}`}
      aria-labelledby={`settings-tab-${section}`}
      className="bg-zinc-900 rounded-lg border border-zinc-800 p-5 space-y-4"
    >
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {description && (
          <p className="text-zinc-400 text-sm mt-1">{description}</p>
        )}
      </div>

      {restartRequired.length > 0 && (
        <div
          role="alert"
          className="p-3 rounded text-xs bg-amber-900/30 text-amber-200 border border-amber-700/60"
        >
          <strong className="font-semibold">Restart required</strong> for these
          fields to take effect:{' '}
          <span className="font-mono">{restartRequired.join(', ')}</span>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="p-3 rounded text-xs bg-red-900/40 text-red-200 border border-red-700/60"
        >
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-3 text-zinc-400 text-sm py-6">
          <span
            className="inline-block w-4 h-4 border-2 border-zinc-600 border-t-zinc-300 rounded-full animate-spin"
            aria-hidden="true"
          />
          Loading {title}…
        </div>
      ) : fieldEntries.length === 0 ? (
        <p className="text-sm text-zinc-500 italic py-4">No fields available for this section.</p>
      ) : (
        <div className="space-y-3">
          {fieldEntries.map(([key, value]) => (
            <FieldRow
              key={key}
              path={[key]}
              value={value}
              overrides={fieldOverrides}
              onChange={setAtPath}
            />
          ))}
        </div>
      )}

      <div className="flex justify-end pt-2 border-t border-zinc-800/60">
        <button
          type="button"
          onClick={save}
          disabled={loading || saving}
          className="px-4 py-2 bg-emerald-700 hover:bg-emerald-600 rounded text-sm font-medium disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </section>
  );
}

// ─── Field row ────────────────────────────────────────────────────────────

interface FieldRowProps {
  path: string[];
  value: SettingsValue;
  overrides: Record<string, FieldOverride>;
  onChange: (path: string[], next: SettingsValue) => void;
  depth?: number;
}

function FieldRow({ path, value, overrides, onChange, depth = 0 }: FieldRowProps) {
  const dotted = path.join('.');
  const override = overrides[dotted] ?? {};
  if (override.hidden) return null;

  const label = override.label ?? humanizeKey(path[path.length - 1]);
  const inputId = `settings-input-${dotted.replace(/\./g, '-')}`;

  // Nested object → sub-section
  if (isPlainObject(value)) {
    const subEntries = Object.entries(value);
    const HeadingTag = depth === 0 ? 'h3' : 'h4';
    return (
      <fieldset className="border border-zinc-800/70 rounded-md p-3 space-y-3">
        <HeadingTag className="text-sm font-semibold text-zinc-300">{label}</HeadingTag>
        {subEntries.length === 0 ? (
          <p className="text-xs text-zinc-500 italic">empty</p>
        ) : (
          <div className="space-y-3">
            {subEntries.map(([childKey, childVal]) => (
              <FieldRow
                key={childKey}
                path={[...path, childKey]}
                value={childVal}
                overrides={overrides}
                onChange={onChange}
                depth={depth + 1}
              />
            ))}
          </div>
        )}
      </fieldset>
    );
  }

  // boolean → checkbox
  if (typeof value === 'boolean') {
    return (
      <div className="flex items-start gap-3">
        <input
          id={inputId}
          type="checkbox"
          checked={value}
          onChange={(e) => onChange(path, e.target.checked)}
          className="mt-1 rounded"
        />
        <div className="flex-1">
          <label htmlFor={inputId} className="text-sm text-zinc-200 select-none cursor-pointer">
            {label}
          </label>
          {override.hint && <p className="text-[11px] text-zinc-500 mt-0.5">{override.hint}</p>}
        </div>
      </div>
    );
  }

  // number → numeric input
  if (typeof value === 'number') {
    return (
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] items-center gap-3">
        <label htmlFor={inputId} className="text-sm text-zinc-300">
          {label}
        </label>
        <div>
          <input
            id={inputId}
            type="number"
            value={Number.isFinite(value) ? value : ''}
            step={override.step ?? 'any'}
            min={override.min}
            max={override.max}
            onChange={(e) => {
              const raw = e.target.value;
              const parsed = raw === '' ? 0 : Number(raw);
              onChange(path, Number.isNaN(parsed) ? 0 : parsed);
            }}
            className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm w-full"
          />
          {override.hint && <p className="text-[11px] text-zinc-500 mt-1">{override.hint}</p>}
        </div>
      </div>
    );
  }

  // string[] → comma-separated text input
  if (isStringArray(value)) {
    return (
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] items-start gap-3">
        <label htmlFor={inputId} className="text-sm text-zinc-300 pt-2">
          {label}
        </label>
        <div>
          <input
            id={inputId}
            type="text"
            value={value.join(', ')}
            onChange={(e) => {
              const parts = e.target.value
                .split(',')
                .map((p) => p.trim())
                .filter((p) => p.length > 0);
              onChange(path, parts);
            }}
            className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm w-full"
          />
          <p className="text-[11px] text-zinc-500 mt-1">
            {override.hint ?? 'Comma-separated list.'}
          </p>
        </div>
      </div>
    );
  }

  // string (or null/undefined treated as string)
  if (typeof value === 'string' || value === null || value === undefined) {
    const stringValue = typeof value === 'string' ? value : '';
    return (
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] items-start gap-3">
        <label htmlFor={inputId} className="text-sm text-zinc-300 pt-2">
          {label}
        </label>
        <div>
          {override.multiline ? (
            <textarea
              id={inputId}
              value={stringValue}
              onChange={(e) => onChange(path, e.target.value)}
              rows={4}
              className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm w-full font-mono"
            />
          ) : (
            <input
              id={inputId}
              type="text"
              value={stringValue}
              onChange={(e) => onChange(path, e.target.value)}
              className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm w-full"
            />
          )}
          {override.hint && <p className="text-[11px] text-zinc-500 mt-1">{override.hint}</p>}
        </div>
      </div>
    );
  }

  // Unknown / unsupported (e.g. mixed-type arrays) — render JSON read-only.
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] items-start gap-3">
      <span className="text-sm text-zinc-300 pt-2">{label}</span>
      <pre className="bg-zinc-800/60 border border-zinc-700 rounded px-3 py-2 text-xs text-zinc-400 overflow-x-auto">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

export default SettingsSection;
