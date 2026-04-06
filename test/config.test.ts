import { describe, it, expect } from 'vitest';
import path from 'path';
import fs from 'fs';

describe('config', () => {
  it('config.yml exists and is valid YAML', async () => {
    const yaml = await import('js-yaml');
    const configPath = path.join(process.cwd(), 'config.yml');
    expect(fs.existsSync(configPath)).toBe(true);

    const raw = fs.readFileSync(configPath, 'utf-8');
    const config = yaml.load(raw) as any;
    expect(config).toBeDefined();
    expect(config.api).toBeDefined();
    expect(config.llm).toBeDefined();
    expect(config.llm.provider).toBe('gemini');
    expect(config.llm.maxConcurrentRequests).toBeGreaterThan(0);
    expect(config.logging).toBeDefined();
    expect(config.logging.level).toBeDefined();
  });

  it('.env.example defaults match config.yml provider', () => {
    const envExample = fs.readFileSync(path.join(process.cwd(), '.env.example'), 'utf-8');
    // Default provider is gemini, so GOOGLE_API_KEY should be uncommented
    expect(envExample).toContain('GOOGLE_API_KEY=');
    expect(envExample).toMatch(/^GOOGLE_API_KEY=/m);
    // ANTHROPIC_API_KEY should be commented out
    expect(envExample).toMatch(/^#\s*ANTHROPIC_API_KEY=/m);
  });
});
