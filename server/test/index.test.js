import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/index.js';

const CONFIG = {
  appSecret: 'b'.repeat(32),
  jwtSecret: 'jwt',
  host: '127.0.0.1',
  port: 8081,
  dbPath: ':memory:',
  adminUser: 'admin',
  adminPass: 'seed-pass',
  singboxBin: '/usr/local/bin/sing-box',
  singboxConfig: '/etc/sing-box/config.json',
  singboxUnit: 'sing-box',
  singboxDownloadBase: 'https://github.com/SagerNet/sing-box/releases/download',
  singboxVersion: '1.11.4',
  checkTimeoutMs: 15000,
  deployTimeoutMs: 60000,
};

test('health + unknown api 404', async () => {
  const { app } = await createApp({ config: CONFIG });
  const h = await request(app).get('/api/health');
  assert.equal(h.status, 200);
  assert.equal(h.body.ok, true);
  const nf = await request(app).get('/api/unknown');
  assert.equal(nf.status, 404);
  assert.equal(nf.body.error, 'not found');
});

test('auto-seeded admin can login', async () => {
  const { app } = await createApp({ config: CONFIG });
  const login = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'seed-pass' });
  assert.equal(login.status, 200);
  assert.ok(login.body.token);
});

test('servers route mounted behind auth', async () => {
  const { app } = await createApp({ config: CONFIG });
  const noAuth = await request(app).get('/api/servers');
  assert.equal(noAuth.status, 401);
});
