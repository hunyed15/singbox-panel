import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));

export function loadConfig(env = process.env) {
  const appSecret = env.APP_SECRET || '';
  if (!appSecret) {
    throw new Error('APP_SECRET is required. Generate one: openssl rand -hex 32');
  }
  const listen = env.PANEL_LISTEN || '0.0.0.0:8081';
  const [host, portStr] = listen.split(':');
  return {
    appSecret,
    jwtSecret: env.JWT_SECRET || appSecret,
    host,
    port: parseInt(portStr, 10) || 8081,
    dbPath: (env.PANEL_DB || './data/panel.db') === ':memory:'
      ? ':memory:'
      : path.resolve(DIR, '..', env.PANEL_DB || './data/panel.db'),
    adminUser: env.ADMIN_USER || 'admin',
    adminPass: env.ADMIN_PASS || '',
    singboxBin: env.SINGBOX_BIN || '/usr/local/bin/sing-box',
    singboxConfig: env.SINGBOX_CONFIG || '/etc/sing-box/config.json',
    singboxUnit: env.SINGBOX_UNIT || 'sing-box',
    singboxDownloadBase:
      env.SINGBOX_DOWNLOAD_BASE ||
      'https://github.com/SagerNet/sing-box/releases/download',
    checkTimeoutMs: parseInt(env.CHECK_TIMEOUT_MS || '15000', 10),
    deployTimeoutMs: parseInt(env.DEPLOY_TIMEOUT_MS || '60000', 10),
  };
}
