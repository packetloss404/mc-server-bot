import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../util/logger';
import type { LLMClient } from './LLMClient';
import type { RouteConfig, TaskType } from './TaskType';
import { GeminiClient } from './GeminiClient';
import { AnthropicClient } from './AnthropicClient';
import { ModelRouter } from './ModelRouter';
import type { TokenLedger } from './TokenLedger';

const SETTINGS_PATH = path.join(process.cwd(), 'data', 'llm-settings.json');

export interface ProviderConfig {
  name: string;
  apiKey: string;
  model: string;
  maxConcurrentRequests: number;
  enabled: boolean;
}

export interface LLMSettingsData {
  providers: ProviderConfig[];
  routes: Record<string, RouteConfig>;
  defaultProvider: string;
}

const DEFAULT_SETTINGS: LLMSettingsData = {
  providers: [],
  routes: {},
  defaultProvider: 'gemini',
};

/**
 * Manages LLM provider API keys and routing config.
 * Persists to data/llm-settings.json and supports hot-reload.
 */
export class LLMSettings {
  private settings: LLMSettingsData;
  private ledger: TokenLedger;
  private currentRouter: ModelRouter | null = null;

  constructor(ledger: TokenLedger) {
    this.ledger = ledger;
    this.settings = this.load();
    // Merge env vars as initial providers if no settings file exists
    this.seedFromEnv();
  }

  /** Get current settings (API keys are masked). */
  getSettings(): LLMSettingsData & { providers: (ProviderConfig & { keyMasked: string })[] } {
    return {
      ...this.settings,
      providers: this.settings.providers.map((p) => ({
        ...p,
        keyMasked: p.apiKey ? p.apiKey.slice(0, 6) + '...' + p.apiKey.slice(-4) : '(not set)',
      })),
    };
  }

  /** Get raw settings (with full keys — internal use only). */
  getRawSettings(): LLMSettingsData {
    return this.settings;
  }

  /** Add or update a provider. */
  upsertProvider(provider: ProviderConfig): void {
    const idx = this.settings.providers.findIndex((p) => p.name === provider.name);
    if (idx >= 0) {
      // Update — preserve existing key if new key is empty
      if (!provider.apiKey && this.settings.providers[idx].apiKey) {
        provider.apiKey = this.settings.providers[idx].apiKey;
      }
      this.settings.providers[idx] = provider;
    } else {
      this.settings.providers.push(provider);
    }
    this.save();
  }

  /** Remove a provider. */
  removeProvider(name: string): boolean {
    const before = this.settings.providers.length;
    this.settings.providers = this.settings.providers.filter((p) => p.name !== name);
    if (this.settings.providers.length < before) {
      this.save();
      return true;
    }
    return false;
  }

  /** Update routing config. */
  setRoutes(routes: Record<string, RouteConfig>): void {
    this.settings.routes = routes;
    this.save();
  }

  /** Set the default provider. */
  setDefaultProvider(name: string): void {
    this.settings.defaultProvider = name;
    this.save();
  }

  /** Build a new ModelRouter from current settings. Returns null if no providers have keys. */
  buildRouter(): ModelRouter | null {
    const clients = new Map<string, LLMClient>();

    for (const p of this.settings.providers) {
      if (!p.enabled || !p.apiKey) continue;

      try {
        if (p.name === 'gemini') {
          clients.set('gemini', new GeminiClient({
            apiKey: p.apiKey,
            model: p.model || 'gemini-2.5-flash-preview-05-20',
            temperature: 0.7,
            maxTokens: 2048,
            maxConcurrentRequests: p.maxConcurrentRequests || 3,
          }));
        } else if (p.name === 'anthropic') {
          clients.set('anthropic', new AnthropicClient({
            apiKey: p.apiKey,
            model: p.model || 'claude-sonnet-4-20250514',
            temperature: 0.7,
            maxTokens: 2048,
            maxConcurrentRequests: p.maxConcurrentRequests || 3,
          }));
        }
        logger.info({ provider: p.name, model: p.model }, 'Provider client rebuilt');
      } catch (err: any) {
        logger.error({ provider: p.name, err: err.message }, 'Failed to build provider client');
      }
    }

    if (clients.size === 0) return null;

    this.currentRouter = new ModelRouter(clients, {
      defaultProvider: this.settings.defaultProvider,
      routes: Object.keys(this.settings.routes).length > 0 ? this.settings.routes : undefined,
    }, this.ledger);

    return this.currentRouter;
  }

  /** Get the current router (for hot-swap). */
  getCurrentRouter(): ModelRouter | null {
    return this.currentRouter;
  }

  private seedFromEnv(): void {
    // Only seed if no providers configured yet
    if (this.settings.providers.length > 0) return;

    const googleKey = process.env.GOOGLE_API_KEY;
    if (googleKey) {
      this.settings.providers.push({
        name: 'gemini',
        apiKey: googleKey,
        model: 'gemini-2.5-flash-preview-05-20',
        maxConcurrentRequests: 3,
        enabled: true,
      });
    }

    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (anthropicKey) {
      this.settings.providers.push({
        name: 'anthropic',
        apiKey: anthropicKey,
        model: 'claude-sonnet-4-20250514',
        maxConcurrentRequests: 3,
        enabled: true,
      });
    }

    if (this.settings.providers.length > 0) {
      this.settings.defaultProvider = this.settings.providers[0].name;
      this.save();
    }
  }

  private save(): void {
    try {
      const dir = path.dirname(SETTINGS_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const tmpPath = SETTINGS_PATH + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify(this.settings, null, 2));
      fs.renameSync(tmpPath, SETTINGS_PATH);
    } catch (err: any) {
      logger.error({ err: err.message }, 'Failed to save LLM settings');
    }
  }

  private load(): LLMSettingsData {
    try {
      if (fs.existsSync(SETTINGS_PATH)) {
        const data = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
        return { ...DEFAULT_SETTINGS, ...data };
      }
    } catch (err: any) {
      logger.warn({ err: err.message }, 'Failed to load LLM settings, using defaults');
    }
    return { ...DEFAULT_SETTINGS };
  }
}
