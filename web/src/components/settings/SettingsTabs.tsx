'use client';

import { motion } from 'framer-motion';
import type { KeyboardEvent } from 'react';

export interface SettingsTabDef<T extends string = string> {
  id: T;
  label: string;
}

export interface SettingsTabsProps<T extends string = string> {
  tabs: ReadonlyArray<SettingsTabDef<T>>;
  activeTab: T;
  onChange: (tab: T) => void;
  accentColor?: string;
}

/**
 * Tab strip with proper ARIA roles and arrow-key navigation. Mirrors the
 * visual pattern used by the bot-detail page so the dashboard stays consistent.
 */
export function SettingsTabs<T extends string>({
  tabs,
  activeTab,
  onChange,
  accentColor = '#10B981',
}: SettingsTabsProps<T>) {
  const handleKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const idx = tabs.findIndex((t) => t.id === activeTab);
    if (idx < 0) return;
    const next = e.key === 'ArrowRight'
      ? tabs[(idx + 1) % tabs.length]
      : tabs[(idx - 1 + tabs.length) % tabs.length];
    onChange(next.id);
  };

  return (
    <div role="tablist" aria-label="Settings sections" className="flex gap-1 overflow-x-auto pb-0 border-b border-zinc-800">
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            role="tab"
            type="button"
            aria-selected={isActive}
            aria-controls={`settings-panel-${tab.id}`}
            id={`settings-tab-${tab.id}`}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={handleKey}
            className={`relative px-4 py-2.5 text-xs font-medium rounded-t-lg transition-colors whitespace-nowrap ${
              isActive
                ? 'text-white bg-zinc-900/80'
                : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/40'
            }`}
          >
            {tab.label}
            {isActive && (
              <motion.span
                layoutId="settings-tab-underline"
                className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full"
                style={{ backgroundColor: accentColor }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

export default SettingsTabs;
