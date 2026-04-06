import pino from 'pino';
import fs from 'fs';
import yaml from 'js-yaml';
import path from 'path';

function getConfigLogLevel(): string {
  try {
    const configPath = path.join(process.cwd(), 'config.yml');
    const raw = fs.readFileSync(configPath, 'utf-8');
    const config = yaml.load(raw) as any;
    if (config?.logging?.level) {
      return config.logging.level;
    }
  } catch {
    // Config not available yet — fall back to env or default
  }
  return process.env.LOG_LEVEL || 'info';
}

export const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: { colorize: true, translateTime: 'HH:MM:ss' },
  },
  level: getConfigLogLevel(),
});
