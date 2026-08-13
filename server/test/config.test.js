import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

const SECRET = 'a'.repeat(32);

test('missing APP_SECRET throws', () => {
  assert.throws(() => loadConfig({}), /APP_SECRET/);
});

test('defaults applied', () => {
  const c = loadConfig({ APP_SECRET: SECRET });
  assert.equal(c.host, '0.0.0.0');
  assert.equal(c.port, 8081);
  assert.equal(c.adminUser, 'admin');
  assert.equal(c.adminPass, '');
  assert.equal(c.singboxBin, '/usr/local/bin/sing-box');
  assert.equal(c.singboxConfig, '/etc/sing-box/config.json');
  assert.equal(c.singboxUnit, 'sing-box');
  assert.ok(c.singboxDownloadBase.includes('github.com/SagerNet/sing-box/releases'));
  assert.equal(c.checkTimeoutMs, 15000);
  assert.equal(c.deployTimeoutMs, 60000);
  assert.equal(c.jwtSecret, SECRET); // JWT_SECRET 缺省回退 appSecret
});

test('PANEL_LISTEN splits host and port', () => {
  const c = loadConfig({ APP_SECRET: SECRET, PANEL_LISTEN: '127.0.0.1:9000' });
  assert.equal(c.host, '127.0.0.1');
  assert.equal(c.port, 9000);
});

test('overrides honored', () => {
  const c = loadConfig({
    APP_SECRET: SECRET,
    JWT_SECRET: 'jwt',
    PANEL_DB: ':memory:',
    SINGBOX_DOWNLOAD_BASE: 'https://ghproxy.com/https://github.com/SagerNet/sing-box/releases/download',
    CHECK_TIMEOUT_MS: '30000',
  });
  assert.equal(c.jwtSecret, 'jwt');
  assert.equal(c.dbPath, ':memory:');
  assert.ok(c.singboxDownloadBase.startsWith('https://ghproxy.com'));
  assert.equal(c.checkTimeoutMs, 30000);
});
