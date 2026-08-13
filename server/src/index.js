import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadConfig } from './config.js';
import { initDb, getSetting, setSetting, ensureAdmin } from './db.js';
import { hashPassword, makeAuthRouter, requireAuth } from './auth.js';
import { makeServersRouter } from './routes/servers.js';
import { makeNodesRouter } from './routes/nodes.js';
import { makeSnisRouter } from './routes/snis.js';
import { makeSettingsRouter } from './routes/settings.js';
import { makeSubRouter } from './routes/sub.js';
import * as crypto from './crypto.js';
import * as ssh from './ssh.js';
import { ApiError } from './errors.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const VERSION = '0.1.0';

export async function createApp({ config }) {
  const db = initDb(config.dbPath);

  if (!getSetting(db, 'sub_slug')) {
    setSetting(db, 'sub_slug', crypto.genRandomHex(6));
  }

  // 单管理员 bootstrap:无用户时用 ADMIN_PASS 或随机密码(打印一次)
  const existing = db.prepare('SELECT id FROM users LIMIT 1').get();
  if (!existing) {
    const pass = config.adminPass || crypto.genRandomHex(8);
    const hash = await hashPassword(pass);
    ensureAdmin(db, { username: config.adminUser, passwordHash: hash });
    if (!config.adminPass) {
      console.log(`[bootstrap] admin: ${config.adminUser}  password: ${pass}`);
    }
  }

  const app = express();
  app.use(express.json());

  app.get('/api/health', (req, res) => res.json({ ok: true, version: VERSION }));

  app.use('/api/auth', makeAuthRouter(db, config.jwtSecret));
  const auth = requireAuth(config.jwtSecret);
  app.use('/api/servers', auth, makeServersRouter({ db, crypto, appSecret: config.appSecret, ssh, config }));
  app.use('/api/nodes', auth, makeNodesRouter({ db, crypto, appSecret: config.appSecret, ssh, config }));
  app.use('/api/snis', auth, makeSnisRouter(db));
  app.use('/api/settings', auth, makeSettingsRouter(db, config.appSecret));
  app.use('/sub', makeSubRouter(db, config.appSecret));

  app.use('/api', (req, res) => res.status(404).json({ error: 'not found' }));

  app.use((err, req, res, next) => {
    if (err instanceof ApiError) return res.status(err.status).json({ error: err.message });
    console.error('[error]', err);
    res.status(500).json({ error: 'internal error' });
  });

  // 前端静态托管(SPA fallback)
  const frontendDist = path.resolve(DIR, '../../frontend/dist');
  if (fs.existsSync(path.join(frontendDist, 'index.html'))) {
    app.use(express.static(frontendDist));
    app.get('*', (req, res) => res.sendFile(path.join(frontendDist, 'index.html')));
  }

  return { app, db };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const config = loadConfig();
  createApp({ config }).then(({ app }) => {
    app.listen(config.port, config.host, () => {
      console.log(`[singbox-panel] listening on http://${config.host}:${config.port}`);
    });
  }).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
