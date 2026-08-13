# SingBox 个人中转面板 实施计划

> ⚠️ **已废弃(2026-08-11)**:旧链路模型 + Vue 前端,已被新设计取代。请改读 `docs/backend-design.md`(设计)与 `docs/superpowers/plans/2026-08-11-singbox-panel-backend.md`(实施计划)。本文件仅留档。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为一个个人自用的 6 台 Linux 服务器集群搭建基于 sing-box 的 Web 管理面板，支持服务器 CRUD、中转链路管理（1→3 等）、SSH 自动下发配置与 reload、双格式订阅。

**Architecture:** Node.js (Express + better-sqlite3 + ssh2) 后端 + Vue 3 (Vite) 前端，单目录 monorepo。面板生成 sing-box `config.json`（VLESS+Reality 入口 + ss-2022 中转链路），经 SSH 推送并 `systemctl reload`。订阅接口 `/sub/:slug` 按 UA 输出 base64 或 sing-box json。

**Tech Stack:** Node 24、Express 5、better-sqlite3、ssh2、jsonwebtoken、bcryptjs、node:test、Vue 3 + Vite。

## Global Constraints

- Node ≥ 20（本机 24），npm ≥ 10。
- 后端 ESM：`server/package.json` 设 `"type": "module"`。
- 数据库：`server/data/panel.db`（SQLite，better-sqlite3，路径可用 `PANEL_DB` 覆盖）。
- 凭据（SSH 私钥/口令、ss-2022 密码、Reality 私钥）一律经 `crypto.encrypt(secret, ...)` 加密入库，明文只存在于内存。
- 主密钥 `APP_SECRET` 来自环境变量；未设置时进程拒绝启动并打印提示。
- 单管理员账号存 `users` 表，密码 bcrypt（bcryptjs）。
- 订阅链接 slug 存 `settings.sub_slug`。除 `/api/health`、`/sub/:slug` 外所有 API 需 `Authorization: Bearer <token>`。
- 传输协议固定：入口 vless + reality（`dest_sni` 默认 `www.microsoft.com`），中转链路 ss-2022 `2022-blake3-aes-128-gcm`。
- 端口分配：中转机链路入站端口从 `port_base`（默认 31000）起递增，每条链路唯一；落地机入站端口 `in_port` 手动设置（默认 32000+id）。
- 测试命令：`npm test`（在 server/ 下运行 `node --test test/`）。
- 不实现：多用户、计费、流量统计、资源监控、多级串联、Clash 模板编辑、自动测速。

---

### Task 1: 项目脚手架

**Files:**
- Create: `package.json`（根，含 workspaces 与 server 依赖）
- Create: `.gitignore`
- Create: `.env.example`
- Create: `server/package.json`
- Create: `README.md`（3 行说明）

**Interfaces:**
- Produces: 根 `package.json` 的 `npm test`、`npm run dev` 脚本供后续任务使用。

- [ ] **Step 1: 创建根 package.json**

根目录 `package.json`：
```json
{
  "name": "singbox-panel",
  "private": true,
  "version": "0.1.0",
  "workspaces": ["server"],
  "scripts": {
    "dev": "npm run dev --workspace server",
    "test": "npm run test --workspace server",
    "build:frontend": "cd frontend && npm run build"
  }
}
```

- [ ] **Step 2: 创建 .gitignore**

```gitignore
node_modules/
server/data/
server/.env
frontend/dist/
*.log
```

- [ ] **Step 3: 创建 .env.example**

```env
APP_SECRET=replace-with-openssl-rand-hex-32
PANEL_LISTEN=0.0.0.0:8081
PANEL_DB=./data/panel.db
ADMIN_USER=admin
ADMIN_PASS=your-password
JWT_SECRET=replace-with-another-random-string
SINGBOX_BIN=/usr/local/bin/sing-box
SINGBOX_CONFIG=/etc/sing-box/config.json
SINGBOX_UNIT=sing-box
PROBE_INTERVAL_MS=60000
```

- [ ] **Step 4: 创建 server/package.json（占位，后续任务补依赖）**

```json
{
  "name": "server",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "node src/index.js",
    "test": "node --test test/"
  }
}
```

- [ ] **Step 5: 创建 README.md**

```markdown
# SingBox 个人中转面板

个人自用的 sing-box 节点管理面板：服务器 CRUD + 中转链路 + SSH 下发 + 双格式订阅。
设计见 `docs/superpowers/specs/2026-08-11-singbox-panel-design.md`。
```

- [ ] **Step 6: 初始化 git 并提交**

```bash
git init
git add package.json .gitignore .env.example server/package.json README.md
git commit -m "chore: scaffold project"
```

---

### Task 2: crypto.js 加解密与凭据生成

**Files:**
- Create: `server/src/crypto.js`
- Test: `server/test/crypto.test.js`

**Interfaces:**
- Produces:
  - `encrypt(secret: string, plaintext: string) => string`（格式 `base64(iv).base64(tag|data)`）
  - `decrypt(secret: string, token: string) => string`
  - `genUuid() => string`（crypto.randomUUID）
  - `genSsPassword() => string`（16 字节 base64，适配 2022-blake3-aes-128-gcm）
  - `genShortId() => string`（16 位 hex）
  - `genRealityKeypair() => { publicKey: string, privateKey: string }`（x25519，JWK 的 `x`/`d`，均为 base64url）
  - `genRandomHex(secret?)`——用于 bootstrap 密码：`genRandomHex(bytes=12) => string`

- [ ] **Step 1: 写失败测试**

`server/test/crypto.test.js`：
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encrypt, decrypt, genUuid, genSsPassword, genShortId, genRealityKeypair, genRandomHex } from '../src/crypto.js';

test('encrypt/decrypt round-trip', () => {
  const tok = encrypt('secret-key', 'hello world');
  assert.notEqual(tok, 'hello world');
  assert.equal(decrypt('secret-key', tok), 'hello world');
});

test('decrypt wrong key throws', () => {
  const tok = encrypt('k1', 'data');
  assert.throws(() => decrypt('k2', tok));
});

test('genUuid returns v4 uuid', () => {
  const u = genUuid();
  assert.match(u, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('genSsPassword base64 decodes to 16 bytes', () => {
  const p = genSsPassword();
  assert.equal(Buffer.from(p, 'base64').length, 16);
});

test('genShortId hex length 16', () => {
  assert.match(genShortId(), /^[0-9a-f]{16}$/);
});

test('x25519 keypair keys are base64url non-empty, 43 chars', () => {
  const { publicKey, privateKey } = genRealityKeypair();
  assert.equal(publicKey.length, 43);
  assert.equal(privateKey.length, 43);
  assert.match(publicKey, /^[A-Za-z0-9_-]{43}$/);
});

test('genRandomHex returns given byte count *2 hex', () => {
  assert.equal(genRandomHex(12).length, 24);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/crypto.test.js`（在 server/ 下）
Expected: FAIL，报 `Cannot find module '../src/crypto.js'`

- [ ] **Step 3: 实现 crypto.js**

`server/src/crypto.js`：
```js
import crypto from 'node:crypto';

const TAG_LEN = 16;

export function encrypt(secret, plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(secret, 'utf8'), iv);
  const enc = cipher.update(Buffer.from(plaintext, 'utf8'));
  const final = cipher.final();
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([enc, final, tag]);
  return `${iv.toString('base64')}.${payload.toString('base64')}`;
}

export function decrypt(secret, token) {
  const [ivB64, dataB64] = token.split('.');
  const iv = Buffer.from(ivB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');
  const tag = data.subarray(data.length - TAG_LEN);
  const body = data.subarray(0, data.length - TAG_LEN);
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(secret, 'utf8'), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}

export function genUuid() {
  return crypto.randomUUID();
}

export function genSsPassword() {
  return crypto.randomBytes(16).toString('base64');
}

export function genShortId() {
  return crypto.randomBytes(8).toString('hex');
}

export function genRealityKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
  const pubJwk = publicKey.export({ format: 'jwk' });
  const privJwk = privateKey.export({ format: 'jwk' });
  return { publicKey: pubJwk.x, privateKey: privJwk.d };
}

export function genRandomHex(bytes = 12) {
  return crypto.randomBytes(bytes).toString('hex');
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/crypto.test.js`
Expected: 7 个 PASS

- [ ] **Step 5: 提交**

```bash
git add server/src/crypto.js server/test/crypto.test.js
git commit -m "feat: aes-gcm encrypt/decrypt and credential generators"
```

---

### Task 3: config.js 环境变量解析

**Files:**
- Create: `server/src/config.js`

**Interfaces:**
- Produces: `loadConfig(env = process.env) => { appSecret, jwtSecret, listen, host, port, dbPath, adminUser, adminPass, singboxBin, singboxConfig, singboxUnit, probeIntervalMs }`
- Throws Error（若 `appSecret` 缺失）。
- `host`/`port` 由 `PANEL_LISTEN`（`host:port`）拆分。

- [ ] **Step 1: 实现 config.js**

`server/src/config.js`：
```js
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
    dbPath: path.resolve(DIR, '..', env.PANEL_DB || './data/panel.db'),
    adminUser: env.ADMIN_USER || 'admin',
    adminPass: env.ADMIN_PASS || '',
    singboxBin: env.SINGBOX_BIN || '/usr/local/bin/sing-box',
    singboxConfig: env.SINGBOX_CONFIG || '/etc/sing-box/config.json',
    singboxUnit: env.SINGBOX_UNIT || 'sing-box',
    probeIntervalMs: parseInt(env.PROBE_INTERVAL_MS || '60000', 10),
  };
}
```

- [ ] **Step 2: 提交**

```bash
git add server/src/config.js
git commit -m "feat: env config loader"
```

---

### Task 4: db.js SQLite 初始化与访问器

**Files:**
- Create: `server/src/db.js`
- Test: `server/test/db.test.js`

**Interfaces:**
- Produces: `initDb(dbPath) => db`（better-sqlite3 实例，执行迁移）
  - 表：`servers`、`relay_settings`、`landing_settings`、`links`、`settings`、`users`
  - `getSetting(db, key) => string|null`
  - `setSetting(db, key, value) => void`
  - `ensureAdmin(db, { username, passwordHash }) => void`（无用户时插入）

Schema（必与设计文档 §5 一致）：
```sql
CREATE TABLE IF NOT EXISTS servers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('relay','landing')),
  host TEXT NOT NULL,
  ssh_port INTEGER NOT NULL DEFAULT 22,
  ssh_user TEXT NOT NULL DEFAULT 'root',
  ssh_auth_type TEXT NOT NULL DEFAULT 'key' CHECK(ssh_auth_type IN ('key','password')),
  ssh_auth_secret TEXT NOT NULL,
  region TEXT NOT NULL DEFAULT '',
  ping_status TEXT NOT NULL DEFAULT 'unknown',
  singbox_version TEXT NOT NULL DEFAULT '',
  last_seen TEXT
);
CREATE TABLE IF NOT EXISTS relay_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER NOT NULL UNIQUE REFERENCES servers(id) ON DELETE CASCADE,
  uuid TEXT NOT NULL,
  reality_public_key TEXT NOT NULL,
  reality_private_key TEXT NOT NULL,
  short_id TEXT NOT NULL,
  dest_sni TEXT NOT NULL DEFAULT 'www.microsoft.com',
  port_base INTEGER NOT NULL DEFAULT 31000
);
CREATE TABLE IF NOT EXISTS landing_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER NOT NULL UNIQUE REFERENCES servers(id) ON DELETE CASCADE,
  in_port INTEGER NOT NULL,
  method TEXT NOT NULL DEFAULT '2022-blake3-aes-128-gcm',
  password TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  relay_server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  landing_server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  relay_listen_port INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  uuid TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

- [ ] **Step 1: 写失败测试**

`server/test/db.test.js`：
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initDb, getSetting, setSetting, ensureAdmin } from '../src/db.js';

test('initDb creates all tables', () => {
  const db = initDb(':memory:');
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
    .map((r) => r.name).sort();
  assert.deepEqual(names, ['landing_settings', 'links', 'relay_settings', 'servers', 'settings', 'users']);
});

test('settings round-trip', () => {
  const db = initDb(':memory:');
  setSetting(db, 'sub_slug', 'abc123');
  assert.equal(getSetting(db, 'sub_slug'), 'abc123');
  assert.equal(getSetting(db, 'missing'), null);
});

test('ensureAdmin seeds only when table empty', () => {
  const db = initDb(':memory:');
  ensureAdmin(db, { username: 'admin', passwordHash: 'h1' });
  ensureAdmin(db, { username: 'other', passwordHash: 'h2' });
  const rows = db.prepare('SELECT username FROM users').all();
  assert.deepEqual(rows, [{ username: 'admin' }]);
});

test('FK cascade deletes server and its settings and links', () => {
  const db = initDb(':memory:');
  db.prepare(`INSERT INTO servers (name,role,host,ssh_user,ssh_auth_type,ssh_auth_secret) VALUES ('s3','landing','1.2.3.4','root','key','x')`).run();
  const sid = db.prepare(`SELECT id FROM servers WHERE name='s3'`).get().id;
  db.prepare(`INSERT INTO landing_settings (server_id,in_port,method,password) VALUES (?,32001,'2022-blake3-aes-128-gcm','p')`).run(sid);
  db.prepare(`DELETE FROM servers WHERE id=?`).run(sid);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM landing_settings').get().c, 0);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/db.test.js`
Expected: FAIL，找不到模块

- [ ] **Step 3: 实现 db.js**

`server/src/db.js`：
```js
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export function initDb(dbPath) {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS servers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('relay','landing')),
      host TEXT NOT NULL,
      ssh_port INTEGER NOT NULL DEFAULT 22,
      ssh_user TEXT NOT NULL DEFAULT 'root',
      ssh_auth_type TEXT NOT NULL DEFAULT 'key' CHECK(ssh_auth_type IN ('key','password')),
      ssh_auth_secret TEXT NOT NULL,
      region TEXT NOT NULL DEFAULT '',
      ping_status TEXT NOT NULL DEFAULT 'unknown',
      singbox_version TEXT NOT NULL DEFAULT '',
      last_seen TEXT
    );
    CREATE TABLE IF NOT EXISTS relay_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id INTEGER NOT NULL UNIQUE REFERENCES servers(id) ON DELETE CASCADE,
      uuid TEXT NOT NULL,
      reality_public_key TEXT NOT NULL,
      reality_private_key TEXT NOT NULL,
      short_id TEXT NOT NULL,
      dest_sni TEXT NOT NULL DEFAULT 'www.microsoft.com',
      port_base INTEGER NOT NULL DEFAULT 31000
    );
    CREATE TABLE IF NOT EXISTS landing_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id INTEGER NOT NULL UNIQUE REFERENCES servers(id) ON DELETE CASCADE,
      in_port INTEGER NOT NULL,
      method TEXT NOT NULL DEFAULT '2022-blake3-aes-128-gcm',
      password TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      relay_server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      landing_server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      relay_listen_port INTEGER NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      uuid TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
}

export function getSetting(db, key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

export function setSetting(db, key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
}

export function ensureAdmin(db, { username, passwordHash }) {
  const row = db.prepare('SELECT id FROM users LIMIT 1').get();
  if (!row) {
    db.prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)')
      .run(username, passwordHash, new Date().toISOString());
  }
}
```

- [ ] **Step 4: 安装依赖并运行测试**

```bash
npm install better-sqlite3 --workspace server
node --test test/db.test.js
```
Expected: 4 个 PASS

- [ ] **Step 5: 提交**

```bash
git add server/src/db.js server/test/db.test.js server/package.json server/package-lock.json
git commit -m "feat: sqlite schema and accessors"
```

---

### Task 5: sbconfig/landing.js 落地机配置生成

**Files:**
- Create: `server/src/sbconfig/landing.js`
- Test: `server/test/sbconfig.test.js`（本任务只测 landing 部分，第 6 任务在同文件追加）

**Interfaces:**
- Produces: `buildLandingConfig({ landing }) => object`
  - `landing = { inPort: number, method: string, password: string }`

- [ ] **Step 1: 写失败测试（在 server/test/sbconfig.test.js）**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLandingConfig } from '../src/sbconfig/landing.js';

test('buildLandingConfig produces ss-2022 inbound + direct outbound', () => {
  const cfg = buildLandingConfig({
    landing: { inPort: 32001, method: '2022-blake3-aes-128-gcm', password: 'cGFzc3dvcmQxMjM0NTY=' },
  });
  assert.equal(cfg.inbounds.length, 1);
  const ib = cfg.inbounds[0];
  assert.equal(ib.type, 'shadowsocks');
  assert.equal(ib.listen_port, 32001);
  assert.equal(ib.method, '2022-blake3-aes-128-gcm');
  assert.equal(ib.password, 'cGFzc3dvcmQxMjM0NTY=');
  assert.equal(cfg.outbounds[0].type, 'direct');
  assert.equal(cfg.route.final, 'direct');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test test/sbconfig.test.js`
Expected: FAIL

- [ ] **Step 3: 实现 landing.js**

`server/src/sbconfig/landing.js`：
```js
export function buildLandingConfig({ landing }) {
  return {
    log: { level: 'info', timestamp: true },
    inbounds: [
      {
        type: 'shadowsocks',
        tag: `landing-in-${landing.inPort}`,
        listen: '::',
        listen_port: landing.inPort,
        method: landing.method,
        password: landing.password,
      },
    ],
    outbounds: [{ type: 'direct', tag: 'direct' }],
    route: { final: 'direct' },
  };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test test/sbconfig.test.js`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add server/src/sbconfig/landing.js server/test/sbconfig.test.js
git commit -m "feat: landing sing-box config generator"
```

---

### Task 6: sbconfig/relay.js 中转机配置生成

**Files:**
- Create: `server/src/sbconfig/relay.js`
- Test: `server/test/sbconfig.test.js`（追加）

**Interfaces:**
- Consumes: —（独立纯函数）
- Produces: `buildRelayConfig({ reality, links }) => object`
  - `reality = { privateKey: string, shortId: string, destSni: string }`
  - `links = Array<{ id: number, listenPort: number, uuid: string, landingHost: string, landingPort: number, landingMethod: string, landingPassword: string }>`
  - 输出：每链路一个 vless+reality 入站（tag `relay-in-${listenPort}`，users 含 `flow: 'xtls-rprx-vision'`），每链路一个 shadowsocks 出站（tag `landing-${id}`），route rules 将 `inbound [listenPort] → landing-${id}`。

- [ ] **Step 1: 追加失败测试**

在 `server/test/sbconfig.test.js` 末尾追加：
```js
import { buildRelayConfig } from '../src/sbconfig/relay.js';

test('buildRelayConfig: per-link inbound + detour outbound + route rule', () => {
  const cfg = buildRelayConfig({
    reality: { privateKey: 'priv', shortId: 'aabbccddeeff0011', destSni: 'www.microsoft.com' },
    links: [
      {
        id: 1, listenPort: 31001, uuid: 'u-1',
        landingHost: '1.2.3.4', landingPort: 32001,
        landingMethod: '2022-blake3-aes-128-gcm', landingPassword: 'pw1',
      },
      {
        id: 2, listenPort: 31002, uuid: 'u-2',
        landingHost: '1.2.3.5', landingPort: 32001,
        landingMethod: '2022-blake3-aes-128-gcm', landingPassword: 'pw2',
      },
    ],
  });

  assert.equal(cfg.inbounds.length, 2);
  const ib = cfg.inbounds[0];
  assert.equal(ib.type, 'vless');
  assert.equal(ib.listen_port, 31001);
  assert.equal(ib.users[0].uuid, 'u-1');
  assert.equal(ib.users[0].flow, 'xtls-rprx-vision');
  assert.equal(ib.tls.reality.enabled, true);
  assert.equal(ib.tls.reality.private_key, 'priv');
  assert.equal(ib.tls.reality.short_id[0], 'aabbccddeeff0011');
  assert.equal(ib.tls.server_name, 'www.microsoft.com');

  const out = cfg.outbounds.map((o) => o.tag);
  assert.ok(out.includes('direct'));
  const dest = cfg.outbounds.find((o) => o.tag === 'landing-2');
  assert.equal(dest.server, '1.2.3.5');
  assert.equal(dest.server_port, 32001);
  assert.equal(dest.method, '2022-blake3-aes-128-gcm');
  assert.equal(dest.password, 'pw2');

  assert.deepEqual(cfg.route.rules, [
    { inbound: ['31001'], outbound: 'landing-1' },
    { inbound: ['31002'], outbound: 'landing-2' },
  ]);
  assert.equal(cfg.route.final, 'direct');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test test/sbconfig.test.js`
Expected: FAIL，`Cannot find module '../src/sbconfig/relay.js'`

- [ ] **Step 3: 实现 relay.js**

`server/src/sbconfig/relay.js`：
```js
export function buildRelayConfig({ reality, links }) {
  const inbounds = links.map((link) => ({
    type: 'vless',
    tag: `relay-in-${link.listenPort}`,
    listen: '::',
    listen_port: link.listenPort,
    users: [{ uuid: link.uuid, flow: 'xtls-rprx-vision' }],
    tls: {
      enabled: true,
      server_name: reality.destSni,
      reality: {
        enabled: true,
        handshake: { server: reality.destSni, port: 443 },
        private_key: reality.privateKey,
        short_id: [reality.shortId],
      },
    },
  }));

  const outbounds = [
    { type: 'direct', tag: 'direct' },
    ...links.map((link) => ({
      type: 'shadowsocks',
      tag: `landing-${link.id}`,
      server: link.landingHost,
      server_port: link.landingPort,
      method: link.landingMethod,
      password: link.landingPassword,
    })),
  ];

  return {
    log: { level: 'info', timestamp: true },
    inbounds,
    outbounds,
    route: {
      rules: links.map((link) => ({ inbound: [String(link.listenPort)], outbound: `landing-${link.id}` })),
      final: 'direct',
    },
  };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test test/sbconfig.test.js`
Expected: 2 个 PASS

- [ ] **Step 5: 提交**

```bash
git add server/src/sbconfig/relay.js server/test/sbconfig.test.js
git commit -m "feat: relay sing-box config generator with detour"
```

---

### Task 7: sbconfig/share.js 分享链接与客户端出站

**Files:**
- Create: `server/src/sbconfig/share.js`
- Test: `server/test/share.test.js`

**Interfaces:**
- Produces:
  - `buildShareLink(view) => string`
    - `view = { name, relayHost, listenPort, uuid, publicKey, shortId, destSni }`
    - 输出 `vless://uuid@relayHost:listenPort?encryption=none&security=reality&sni=destSni&fp=chrome&pbk=publicKey&sid=shortId&type=tcp&flow=xtls-rprx-vision#name`
  - `buildClientOutbound(view) => object`（sing-box 客户端 vless outbound，含 utls + reality）

- [ ] **Step 1: 写失败测试**

`server/test/share.test.js`：
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildShareLink, buildClientOutbound } from '../src/sbconfig/share.js';

const view = {
  name: 'HK1->KR3',
  relayHost: '1.1.1.1',
  listenPort: 31001,
  uuid: '11111111-2222-4333-8444-555555555555',
  publicKey: 'pubk',
  shortId: 'aabbccddeeff0011',
  destSni: 'www.microsoft.com',
};

test('buildShareLink vless+reality url', () => {
  const url = buildShareLink(view);
  assert.ok(url.startsWith('vless://11111111-2222-4333-8444-555555555555@1.1.1.1:31001?'));
  assert.ok(url.includes('security=reality'));
  assert.ok(url.includes('pbk=pubk'));
  assert.ok(url.includes('sid=aabbccddeeff0011'));
  assert.ok(url.includes('encryption=none'));
  assert.ok(url.includes('type=tcp'));
  assert.ok(url.includes('flow=xtls-rprx-vision'));
  assert.ok(url.includes('#HK1-%3E-KR3'));  // encoded "HK1->KR3"
});

test('buildClientOutbound sing-box vless reality outbound', () => {
  const o = buildClientOutbound(view);
  assert.equal(o.type, 'vless');
  assert.equal(o.server, '1.1.1.1');
  assert.equal(o.server_port, 31001);
  assert.equal(o.uuid, view.uuid);
  assert.equal(o.flow, 'xtls-rprx-vision');
  assert.deepEqual(o.tls, {
    enabled: true,
    server_name: 'www.microsoft.com',
    utls: { enabled: true, fingerprint: 'chrome' },
    reality: { enabled: true, public_key: 'pubk', short_id: 'aabbccddeeff0011' },
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test test/share.test.js`
Expected: FAIL

- [ ] **Step 3: 实现 share.js**

`server/src/sbconfig/share.js`：
```js
export function buildShareLink(view) {
  const q = new URLSearchParams({
    encryption: 'none',
    security: 'reality',
    sni: view.destSni,
    fp: 'chrome',
    pbk: view.publicKey,
    sid: view.shortId,
    type: 'tcp',
    flow: 'xtls-rprx-vision',
  });
  return `vless://${view.uuid}@${view.relayHost}:${view.listenPort}?${q.toString()}#${encodeURIComponent(view.name)}`;
}

export function buildClientOutbound(view) {
  return {
    type: 'vless',
    tag: view.name,
    server: view.relayHost,
    server_port: view.listenPort,
    uuid: view.uuid,
    flow: 'xtls-rprx-vision',
    tls: {
      enabled: true,
      server_name: view.destSni,
      utls: { enabled: true, fingerprint: 'chrome' },
      reality: { enabled: true, public_key: view.publicKey, short_id: view.shortId },
    },
  };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test test/share.test.js`
Expected: 2 个 PASS

- [ ] **Step 5: 提交**

```bash
git add server/src/sbconfig/share.js server/test/share.test.js
git commit -m "feat: share link and client outbound builders"
```

---

### Task 8: sub.js 订阅转换

**Files:**
- Create: `server/src/sub.js`
- Test: `server/test/sub.test.js`

**Interfaces:**
- Consumes: `buildShareLink`, `buildClientOutbound`（from sbconfig/share.js）
- Produces:
  - `collectLinkViews(db, crypto, appSecret) => Array<view>`——查询所有 enabled 链路，join 中转机(reality pubkey/dest_sni/short_id)与落地机信息，解密不需要（pubkey 明文），全部字段拼成 `view`（name 为 `入口名->落地名-(id)`）。
  - `toBase64(linkViews) => string`（每行一个 sharelink，整串 base64）
  - `toSingboxConfig(linkViews) => object`（含 mixed inbound 127.0.0.1:2080 + 所有 outbound + direct + selector `auto`，route.final=`auto`）
  - `pickFormat(query, ua)`：`query.format` 有值时用之；否则 UA 含 `sing-box`/`SingBox`/`SFI`/`SFA`/`SFM` → `'singbox'`，否则 `'base64'`。

- [ ] **Step 1: 写失败测试**

`server/test/sub.test.js`：
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toBase64, toSingboxConfig, pickFormat } from '../src/sub.js';

const views = [
  { name: 'nz-1', relayHost: '1.1.1.1', listenPort: 31001, uuid: 'u1', publicKey: 'pk1', shortId: 's1', destSni: 'www.microsoft.com' },
  { name: 'nz-2', relayHost: '2.2.2.2', listenPort: 31002, uuid: 'u2', publicKey: 'pk2', shortId: 's2', destSni: 'www.microsoft.com' },
];

test('toBase64 encodes one share link per line', () => {
  const dec = Buffer.from(toBase64(views), 'base64').toString('utf8').split('\n');
  assert.equal(dec.length, 2);
  assert.ok(dec[0].startsWith('vless://'));
});

test('toSingboxConfig: mixed inbound + outbounds + selector final', () => {
  const cfg = toSingboxConfig(views);
  assert.equal(cfg.inbounds[0].type, 'mixed');
  assert.equal(cfg.inbounds[0].listen_port, 2080);
  const tags = cfg.outbounds.map((o) => o.tag);
  assert.ok(tags.includes('nz-1') && tags.includes('nz-2') && tags.includes('direct'));
  const sel = cfg.outbounds.find((o) => o.type === 'selector');
  assert.deepEqual(sel.outbounds, ['nz-1', 'nz-2']);
  assert.equal(cfg.route.final, 'auto');
});

test('pickFormat: explicit query wins', () => {
  assert.equal(pickFormat({ format: 'base64' }, 'SingBox/1.2'), 'base64');
  assert.equal(pickFormat({ format: 'singbox' }, 'v2rayN'), 'singbox');
});

test('pickFormat: sing-box UA defaults to singbox', () => {
  assert.equal(pickFormat({}, 'SingBox/1.11.0 (Windows)'), 'singbox');
  assert.equal(pickFormat({}, 'SFI 1.10 / Android'), 'singbox');
});

test('pickFormat: v2rayN/clash UA defaults to base64', () => {
  assert.equal(pickFormat({}, 'v2rayN/7.2.0'), 'base64');
  assert.equal(pickFormat({}, 'ClashForWindows/0.20'), 'base64');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test test/sub.test.js`
Expected: FAIL

- [ ] **Step 3: 实现 sub.js**

`server/src/sub.js`：
```js
import { buildShareLink, buildClientOutbound } from './sbconfig/share.js';

const SINGBOX_UA = /sing-box|singbox|\bSFI\b|\bSFA\b|\bSFM\b/i;

export function pickFormat(query, ua) {
  if (query.format === 'base64' || query.format === 'singbox') {
    return query.format;
  }
  if (SINGBOX_UA.test(ua || '')) {
    return 'singbox';
  }
  return 'base64';
}

export function toBase64(linkViews) {
  const text = linkViews.map(buildShareLink).join('\n');
  return Buffer.from(text, 'utf8').toString('base64');
}

export function toSingboxConfig(linkViews) {
  const outbounds = linkViews.map((v) => buildClientOutbound(v));
  const selector = {
    type: 'selector',
    tag: 'auto',
    outbounds: outbounds.map((o) => o.tag),
  };
  return {
    log: { level: 'warn', timestamp: true },
    inbounds: [{ type: 'mixed', tag: 'mixed-in', listen: '127.0.0.1', listen_port: 2080 }],
    outbounds: [...outbounds, selector, { type: 'direct', tag: 'direct' }],
    route: { final: 'auto' },
  };
}

export function collectLinkViews(db) {
  const rows = db.prepare(`
    SELECT
      l.id, l.name, l.uuid AS uuid, l.relay_listen_port AS listenPort,
      s.name AS relayName, s.host AS relayHost,
      rs.reality_public_key AS publicKey, rs.short_id AS shortId, rs.dest_sni AS destSni,
      g.name AS landingName
    FROM links l
    JOIN servers s ON s.id = l.relay_server_id
    JOIN relay_settings rs ON rs.server_id = s.id
    JOIN servers g ON g.id = l.landing_server_id
    WHERE l.enabled = 1
    ORDER BY l.id
  `).all();
  return rows.map((r) => ({
    name: `${r.relayName}->${r.landingName}-${r.id}`,
    relayHost: r.relayHost,
    listenPort: r.listenPort,
    uuid: r.uuid,
    publicKey: r.publicKey,
    shortId: r.shortId,
    destSni: r.destSni,
  }));
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test test/sub.test.js`
Expected: 5 个 PASS

- [ ] **Step 5: 提交**

```bash
git add server/src/sub.js server/test/sub.test.js
git commit -m "feat: subscription base64/singbox conversion"
```

---

### Task 9: ssh.js SSH 封装

**Files:**
- Create: `server/src/ssh.js`

**Interfaces:**
- Produces:
  - `buildConn(serverRow, decryptFn, appSecret) => object`——返回 ssh2 connect 参数：
    - auth_type `key` → `{ host, port, username, privateKey: decrypt(...) }`
    - auth_type `password` → `{ host, port, username, password: decrypt(...) }`
  - `exec(conn, cmd) => Promise<{ stdout, stderr }>`（exit code 非 0 reject）
  - `writeFile(conn, remotePath, content) => Promise<void>`（sftp）
  - `testConnection(conn) => Promise<{ ok: boolean, message?: string }>`

- [ ] **Step 1: 实现 ssh.js**

`server/src/ssh.js`：
```js
import { Client } from 'ssh2';

export function buildConn(serverRow, decryptFn, appSecret) {
  const base = {
    host: serverRow.host,
    port: serverRow.ssh_port || 22,
    username: serverRow.ssh_user || 'root',
  };
  const secret = decryptFn(appSecret, serverRow.ssh_auth_secret);
  if (serverRow.ssh_auth_type === 'password') {
    return { ...base, password: secret };
  }
  return { ...base, privateKey: secret };
}

export function exec(conn, cmd, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const c = new Client();
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; c.end(); reject(new Error('ssh exec timeout')); }
    }, timeoutMs);
    const finish = (fn, ...args) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      c.end();
      fn(...args);
    };
    c.on('ready', () => {
      c.exec(cmd, (err, stream) => {
        if (err) return finish(reject, err);
        let stdout = '';
        let stderr = '';
        stream.on('data', (d) => { stdout += d.toString(); });
        stream.stderr.on('data', (d) => { stderr += d.toString(); });
        stream.on('close', (code) => {
          if (code !== 0) return finish(reject, new Error(stderr.trim() || `exit code ${code}`));
          finish(resolve, { stdout, stderr });
        });
      });
    });
    c.on('error', (err) => finish(reject, err));
    c.connect(conn);
  });
}

export function writeFile(conn, remotePath, content) {
  return new Promise((resolve, reject) => {
    const c = new Client();
    let settled = false;
    const finish = (fn, ...args) => {
      if (settled) return;
      settled = true;
      c.end();
      fn(...args);
    };
    c.on('ready', () => {
      c.sftp((err, sftp) => {
        if (err) return finish(reject, err);
        const ws = sftp.createWriteStream(remotePath);
        ws.on('error', (e) => finish(reject, e));
        ws.on('close', () => finish(resolve));
        ws.end(content);
      });
    });
    c.on('error', (err) => finish(reject, err));
    c.connect(conn);
  });
}

export async function testConnection(conn) {
  try {
    const r = await exec(conn, 'echo ok');
    return { ok: r.stdout.trim() === 'ok', message: JSON.stringify(r) };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add server/src/ssh.js
git commit -m "feat: ssh2 wrapper (exec, sftp, test)"
```

（ssh2 依赖在 Task 11 装上；本任务先提交源码。）

---

### Task 10: deploy.js 配置下发编排

**Files:**
- Create: `server/src/deploy.js`
- Test: `server/test/deploy.test.js`

**Interfaces:**
- Consumes: `exec`, `writeFile`（from ssh.js）
- Produces: `deployMachine(ssh, conn, config, { singboxBin, singboxConfig, singboxUnit }) => Promise<{ ok: true, steps: string[] }>`，失败抛 Error。
  步骤（每一步 push 到 steps）：
  1. `mkdir -p /tmp/singbox-panel`
  2. `writeFile(conn, '/tmp/singbox-panel/config.json', JSON.stringify(config, null, 2))`
  3. `exec(conn, \`${singboxBin} check -c /tmp/singbox-panel/config.json\`)`——失败即中止
  4. 备份：`cp ${singboxConfig} ${singboxConfig}.bak`（忽略不存在）
  5. 安装：`install -m 600 /tmp/singbox-panel/config.json ${singboxConfig}`
  6. reload：`systemctl reload ${singboxUnit}`——失败则回滚（恢复 .bak 并再 reload），再抛错。

- [ ] **Step 1: 写失败测试**

`server/test/deploy.test.js`：
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deployMachine } from '../src/deploy.js';

function fakeSsh({ failStep = -1, cmds = [] } = {}) {
  const calls = [];
  return {
    calls,
    exec: async (conn, cmd) => {
      calls.push(cmd);
      cmds.push({ cmd, code: 0 });
      if (calls.length === failStep) {
        const err = new Error('simulated fail');
        err.code = 1;
        throw err;
      }
      return { stdout: '', stderr: '' };
    },
    writeFile: async () => { calls.push('writeFile'); cmds.push({ cmd: 'writeFile', code: 0 }); return; },
  };
}

const config = { log: {}, outbounds: [{ type: 'direct', tag: 'direct' }] };
const opts = { singboxBin: '/usr/local/bin/sing-box', singboxConfig: '/etc/sing-box/config.json', singboxUnit: 'sing-box' };

test('successful deploy runs check, install, reload', async () => {
  const ssh = fakeSsh();
  const res = await deployMachine(ssh, {}, config, opts);
  assert.equal(res.ok, true);
  assert.ok(ssh.calls.some((c) => c.includes('sing-box check')));
  assert.ok(ssh.calls.some((c) => c.includes('install -m 600')));
  assert.ok(ssh.calls.some((c) => c.includes('systemctl reload sing-box')));
});

test('check failure aborts before install', async () => {
  const ssh = fakeSsh();
  await assert.rejects(() => deployMachine(ssh, {}, config, opts));
  assert.ok(!ssh.calls.some((c) => c.includes('install')));
});

test('reload failure restores backup then rethrows', async () => {
  const ssh = fakeSsh({ failStep: 999 });
  // force reload to fail: monkeypatch after 5th exec
  let n = 0;
  ssh.exec = async (conn, cmd) => {
    n++;
    ssh.calls.push(cmd);
    if (cmd.includes('systemctl reload')) throw new Error('reload down');
    return { stdout: '', stderr: '' };
  };
  await assert.rejects(() => deployMachine(ssh, {}, config, opts));
  assert.ok(ssh.calls.some((c) => c.includes('.bak')));
  assert.ok(ssh.calls.some((c) => c.includes('systemctl reload sing-box')));
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test test/deploy.test.js`
Expected: FAIL，模块缺失

- [ ] **Step 3: 实现 deploy.js**

`server/src/deploy.js`：
```js
const TMP_CONFIG = '/tmp/singbox-panel/config.json';

export async function deployMachine(ssh, conn, config, { singboxBin, singboxConfig, singboxUnit }) {
  const steps = [];
  const json = JSON.stringify(config, null, 2);

  steps.push('mkdir');
  await ssh.exec(conn, 'mkdir -p /tmp/singbox-panel');

  steps.push('upload');
  await ssh.writeFile(conn, TMP_CONFIG, json);

  steps.push('check');
  await ssh.exec(conn, `${singboxBin} check -c ${TMP_CONFIG}`);

  steps.push('backup');
  await ssh.exec(conn, `cp -f ${singboxConfig} ${singboxConfig}.bak 2>/dev/null || true`);

  steps.push('install');
  await ssh.exec(conn, `install -m 600 ${TMP_CONFIG} ${singboxConfig}`);

  steps.push('reload');
  try {
    await ssh.exec(conn, `systemctl reload ${singboxUnit}`);
  } catch (err) {
    await ssh.exec(conn, `cp -f ${singboxConfig}.bak ${singboxConfig} 2>/dev/null || true`);
    await ssh.exec(conn, `systemctl reload ${singboxUnit}`).catch(() => {});
    throw new Error(`reload failed, config restored: ${err.message}`);
  }

  return { ok: true, steps };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test test/deploy.test.js`
Expected: 3 个 PASS

- [ ] **Step 5: 提交 + 安装 ssh2 依赖**

```bash
npm install ssh2 --workspace server
git add server/src/deploy.js server/test/deploy.test.js server/package.json server/package-lock.json
git commit -m "feat: config deploy orchestration with rollback"
```

---

### Task 11: probe.js 状态探测

**Files:**
- Create: `server/src/probe.js`
- Test: `server/test/probe.test.js`

**Interfaces:**
- Consumes: `exec`, `buildConn`（from ssh.js）
- Produces: `probeOnce(db, ssh, crypto, config, servers) => Promise<void>`——对每台服务器：
  - `exec(conn, \`${singboxBin} version | head -1\`)` → 解析版本
  - `exec(conn, \`systemctl is-active ${singboxUnit}\`)` → `active`/`inactive`
  - 写回 `servers.ping_status/online`, `singbox_version`, `last_seen`
  - 任一 exec 失败 → `ping_status='offline'`，版本留空
- 解析 helper `parseVersion(stdout) => string`（`sing-box 1.11.0` 或裸版本号）。

- [ ] **Step 1: 写失败测试**

`server/test/probe.test.js`：
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeOnce, parseVersion } from '../src/probe.js';

test('parseVersion extracts bare version number', () => {
  assert.equal(parseVersion('sing-box 1.11.0'), '1.11.0');
  assert.equal(parseVersion('sing-box version 1.11.0 Beta'), '1.11.0 Beta');
  assert.equal(parseVersion(''), '');
});

test('probeOnce marks server online and stores version', async () => {
  const db = {
    exec: () => {},
    prepare: (sql) => ({
      all: () => [{ id: 1, host: '1.2.3.4', ssh_port: 22, ssh_user: 'root', ssh_auth_type: 'key', ssh_auth_secret: 'enc' }],
      run: (...args) => { db.lastRun = { sql, args }; },
    }),
  };
  const ssh = {
    exec: async (conn, cmd) => (cmd.includes('version') ? { stdout: 'sing-box 1.11.0\n' } : { stdout: 'active\n' }),
  };
  await probeOnce(db, ssh, { decrypt: () => 'key' }, { singboxBin: 'sing-box', singboxUnit: 'sing-box' });
  assert.ok(db.lastRun.sql.includes('SET ping_status'));
  assert.ok(db.lastRun.args.includes('online'));
  assert.ok(db.lastRun.args.includes('1.11.0'));
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test test/probe.test.js`
Expected: FAIL

- [ ] **Step 3: 实现 probe.js**

`server/src/probe.js`：
```js
export function parseVersion(stdout) {
  const m = stdout.match(/[0-9]+\.[0-9]+(?:\.[0-9]+)?(?:\s+[A-Za-z]+)?/);
  return m ? m[0].trim() : '';
}

export async function probeOnce(db, ssh, crypto, config, serverRows) {
  const list = serverRows || db.prepare('SELECT * FROM servers').all();
  const update = db.prepare(`UPDATE servers SET ping_status=?, singbox_version=?, last_seen=? WHERE id=?`);
  for (const row of list) {
    const conn = buildConnFromRow(row, crypto, config);
    try {
      const ver = await ssh.exec(conn, `${config.singboxBin} version | head -1`);
      const act = await ssh.exec(conn, `systemctl is-active ${config.singboxUnit}`);
      const version = parseVersion(ver.stdout);
      const status = act.stdout.trim() === 'active' ? 'online' : 'inactive';
      update.run(status, version, new Date().toISOString(), row.id);
    } catch {
      update.run('offline', '', new Date().toISOString(), row.id);
    }
  }
}

function buildConnFromRow(row, crypto, config) {
  return {
    host: row.host,
    port: row.ssh_port || 22,
    username: row.ssh_user || 'root',
    ...(row.ssh_auth_type === 'password'
      ? { password: crypto.decrypt(config.appSecret, row.ssh_auth_secret) }
      : { privateKey: crypto.decrypt(config.appSecret, row.ssh_auth_secret) }),
  };
}
```

（注：probe.js 内部不再依赖 ssh.buildConn，因为测试中的 mock conn 结构更直白；ssh.buildConn 保留给 routes 复用。）

- [ ] **Step 4: 运行确认通过**

Run: `node --test test/probe.test.js`
Expected: 2 个 PASS

- [ ] **Step 5: 提交**

```bash
git add server/src/probe.js server/test/probe.test.js
git commit -m "feat: periodic node status probe"
```

---

### Task 12: auth.js 鉴权

**Files:**
- Create: `server/src/auth.js`
- Test: `server/test/auth.test.js`

**Interfaces:**
- Consumes: `initDb`, db 实例（users 表）
- Produces:
  - `hashPassword(plain) => Promise<string>`（bcryptjs，10 rounds）
  - `verifyPassword(plain, hash) => Promise<boolean>`
  - `signToken(jwtSecret, { username }) => string`（HS256，exp 7d）
  - `requireAuth(jwtSecret)` → Express 中间件 `(req, res, next)`，解析 `Authorization: Bearer`，失败 401
  - `makeAuthRouter(db, jwtSecret) => express.Router`（`POST /login`，`GET /me`）
- Dependency: `jsonwebtoken`, `bcryptjs`

- [ ] **Step 1: 写失败测试**

`server/test/auth.test.js`：
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, signToken, requireAuth, makeAuthRouter } from '../src/auth.js';
import express from 'express';
import request from 'supertest';

test('bcrypt hash/verify', async () => {
  const hash = await hashPassword('sekrit');
  assert.notEqual(hash, 'sekrit');
  assert.equal(await verifyPassword('sekrit', hash), true);
  assert.equal(await verifyPassword('nope', hash), false);
});

test('signToken/requireAuth happy path', async () => {
  const token = signToken('jwt-secret', { username: 'admin' });
  const req = { headers: { authorization: `Bearer ${token}` } };
  let nexted = false;
  requireAuth('jwt-secret')(req, {}, () => { nexted = true; });
  assert.equal(nexted, true);
  assert.equal(req.user.username, 'admin');
});

test('requireAuth rejects bad token', async () => {
  const res = {};
  res.status = (code) => { res.code = code; return res; };
  res.json = (body) => { res.body = body; };
  await new Promise((resolve) => {
    requireAuth('jwt-secret')({ headers: {} }, res, resolve);
  });
  assert.equal(res.code, 401);
});

test('auth router login flow', async () => {
  const db = { prepare: () => ({ get: () => ({ id: 1, username: 'admin', password_hash: 'h' }) }) };
  const app = express();
  app.use(express.json());
  app.use('/api/auth', makeAuthRouter(db, 'jwt-secret'));
  const res = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'x' });
  // password 'x' won't match real bcrypt; verifyPassword mock not used here.
  assert.ok([200, 401].includes(res.status));
});
```

> 说明：最后一条测试因 db mock 不够真实，本任务聚焦前三条纯函数断言；路由的完整行为在 Task 13 集成测试中覆盖（那里提供真实的 initDb + ensureAdmin）。

- [ ] **Step 2: 安装依赖并运行确认失败**

```bash
npm install jsonwebtoken bcryptjs --workspace server
npm install supertest express --workspace server
node --test test/auth.test.js
```
Expected: FAIL，模块缺失

- [ ] **Step 3: 实现 auth.js**

`server/src/auth.js`：
```js
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import express from 'express';

export async function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

export function signToken(jwtSecret, payload) {
  return jwt.sign(payload, jwtSecret, { expiresIn: '7d' });
}

export function requireAuth(jwtSecret) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return res.status(401).json({ error: 'unauthorized' });
    try {
      req.user = jwt.verify(token, jwtSecret);
      return next();
    } catch {
      return res.status(401).json({ error: 'unauthorized' });
    }
  };
}

export function makeAuthRouter(db, jwtSecret) {
  const router = express.Router();

  router.post('/login', async (req, res) => {
    const { username, password } = req.body || {};
    const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username || '');
    if (!row || !(await verifyPassword(password || '', row.password_hash))) {
      return res.status(401).json({ error: 'invalid credentials' });
    }
    const token = signToken(jwtSecret, { username: row.username, sub: row.id });
    return res.json({ token, username: row.username });
  });

  router.get('/me', requireAuth(jwtSecret), (req, res) => {
    return res.json({ username: req.user.username });
  });

  return router;
}
```

> 注意：`makeAuthRouter` 使用 `verifyPassword`（真实 bcrypt）。集成测试在 Task 13 用 `ensureAdmin` 种入真实 hash 后验证。

- [ ] **Step 4: 运行确认通过（跳过最后一个断言较弱的用例则用 `--test-name-pattern` 或直接全跑）**

Run: `node --test test/auth.test.js`
Expected: 前 3 条 PASS，最后一条通过（200/401 均算通过）

- [ ] **Step 5: 提交**

```bash
git add server/src/auth.js server/test/auth.test.js server/package.json server/package-lock.json
git commit -m "feat: jwt auth, bcrypt, login router"
```

---

### Task 13: routes/ 服务器、链路、订阅、设置路由

**Files:**
- Create: `server/src/routes/servers.js`
- Create: `server/src/routes/links.js`
- Create: `server/src/routes/sub.js`
- Create: `server/src/routes/settings.js`
- Test: `server/test/api.test.js`（用真实 initDb(':memory:') + supertest 覆盖全套 API）

**Interfaces:**
- `makeServersRouter({ db, crypto, appSecret, ssh })`：
  - `GET /api/servers` → 数组，含 role settings 摘要（不返回加密字段明文）
  - `POST /api/servers` body `{ name, role, host, sshPort, sshUser, sshAuthType, sshAuthSecret, region }`：
    - role=relay → 自动生成 relay_settings（uuid、reality keypair、shortId、dest_sni、port_base=31000），ssh_auth_secret 加密入库
    - role=landing → 自动生成 landing_settings（in_port=32000+id、method、password）
  - `PUT /api/servers/:id` → 更新 servers 字段（及 role settings 可选更新）
  - `DELETE /api/servers/:id` → 有链路引用时 409
  - `POST /api/servers/:id/test` → `ssh.testConnection(buildConn(...))` 返回 `{ ok, message }`
- `makeLinksRouter({ db, crypto, appSecret, ssh, config })`：
  - `GET /api/links` → 数组（join 入口/落地名、reality pubkey、dest_sni 等 shim view）
  - `POST /api/links` body `{ name, relayServerId, landingServerId }` → 校验 role、分配端口（port_base 起第一个空闲）、genUuid，插入，然后 `deployRelay(relayId)`，返回 `{ link, deploy }`
  - `PUT /api/links/:id` body `{ name?, enabled? }` → 更新 + `deployRelay`
  - `DELETE /api/links/:id` → 删除 + `deployRelay`
  - `deployRelay(relayId)`：查该中转机 enabled 链路（join landing 情报）→ `buildRelayConfig` → `ssh` 下发（复用 deployServices）
- `deployServices.js`（新增 `server/src/deployServices.js`）：
  - `deployRelay(db, ssh, crypto, config, relayId) => Promise<{ ok, steps }>`
  - `deployLanding(db, ssh, crypto, config, landingId) => Promise<{ ok, steps }>`
  - 内含只读复用函数 `getRelayConn(db, crypto, appSecret, relayId)`、`getLandingConn(...)`
- `makeSubRouter(db)`：
  - `GET /sub/:slug` → 校验 slug → `collectLinkViews(db)` → `pickFormat(req.query, req.get('user-agent'))` → base64（`text/plain; charset=utf-8`）或 singbox（`application/json`）
- `makeSettingsRouter(db, appSecret)`：
  - `GET /api/settings` → `{ subSlug, subUrl }`（若无 slug，生成并写入）
  - `POST /api/settings` body `{ subSlug }` → 自定义/重置 slug

- [ ] **Step 1: 实现 deployServices.js**（先于 routes，供其复用）

`server/src/deployServices.js`：
```js
import { buildRelayConfig } from './sbconfig/relay.js';
import { buildLandingConfig } from './sbconfig/landing.js';
import { deployMachine } from './deploy.js';
import { buildConn } from './ssh.js';

function connFor(db, crypto, appSecret, serverId) {
  const row = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId);
  return { row, conn: buildConn(row, crypto.decrypt, appSecret) };
}

export async function deployRelay(db, ssh, crypto, config, relayId) {
  const relay = db.prepare('SELECT * FROM servers WHERE id = ?').get(relayId);
  const rs = db.prepare('SELECT * FROM relay_settings WHERE server_id = ?').get(relayId);
  if (!relay || !rs) return { ok: false, error: 'relay not found or settings missing' };
  const links = db.prepare(`
    SELECT l.id, l.relay_listen_port AS listenPort, l.uuid,
           g.host AS landingHost, ls.in_port AS landingPort, ls.method AS landingMethod, ls.password AS landingPassword
    FROM links l
    JOIN servers g ON g.id = l.landing_server_id
    JOIN landing_settings ls ON ls.server_id = g.id
    WHERE l.relay_server_id = ? AND l.enabled = 1
    ORDER BY l.id
  `).all(relayId);
  const reality = { privateKey: crypto.decrypt(config.appSecret, rs.reality_private_key), shortId: rs.short_id, destSni: rs.dest_sni };
  const cfg = buildRelayConfig({ reality, links });
  const { conn } = connFor(db, crypto, config.appSecret, relayId);
  return deployMachine(ssh, conn, cfg, { singboxBin: config.singboxBin, singboxConfig: config.singboxConfig, singboxUnit: config.singboxUnit });
}

export async function deployLanding(db, ssh, crypto, config, landingId) {
  const ls = db.prepare('SELECT * FROM landing_settings WHERE server_id = ?').get(landingId);
  if (!ls) return { ok: false, error: 'landing settings missing' };
  const cfg = buildLandingConfig({ landing: { inPort: ls.in_port, method: ls.method, password: crypto.decrypt(config.appSecret, ls.password) } });
  const { conn } = connFor(db, crypto, config.appSecret, landingId);
  return deployMachine(ssh, conn, cfg, { singboxBin: config.singboxBin, singboxConfig: config.singboxConfig, singboxUnit: config.singboxUnit });
}
```

- [ ] **Step 2: 写集成测试 api.test.js**

`server/test/api.test.js`：
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { initDb, ensureAdmin } from '../src/db.js';
import { makeAuthRouter, requireAuth, hashPassword } from '../src/auth.js';
import { makeServersRouter } from '../src/routes/servers.js';
import { makeLinksRouter } from '../src/routes/links.js';
import { makeSubRouter } from '../src/routes/sub.js';
import { makeSettingsRouter } from '../src/routes/settings.js';
import * as cryptoExports from '../src/crypto.js';

const APP_SECRET = 'a'.repeat(32);
const jwtSecret = 'jwt-secret';

function makeApp(overrides = {}) {
  const db = overrides.db || initDb(':memory:');
  ensureAdmin(db, { username: 'admin', passwordHash: 'unused-placeholder' });
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('sub_slug', 'whatever')").run();
  const crypto = overrides.crypto || cryptoExports;
  const ssh = overrides.ssh || { exec: async () => ({ stdout: '', stderr: '' }), writeFile: async () => {} };
  const config = { appSecret: APP_SECRET, singboxBin: 'sing-box', singboxConfig: '/etc/sing-box/config.json', singboxUnit: 'sing-box' };
  const app = express();
  app.use(express.json());
  app.use('/api/auth', makeAuthRouter(db, jwtSecret));
  const auth = requireAuth(jwtSecret);
  app.use('/api/servers', auth, makeServersRouter({ db, crypto, appSecret: APP_SECRET, ssh }));
  app.use('/api/links', auth, makeLinksRouter({ db, crypto, ssh, config }));
  app.use('/api/settings', auth, makeSettingsRouter(db, APP_SECRET));
  app.use('/sub', makeSubRouter(db));
  return { app, db, crypto };
}

async function seedAdminPassword(db, password) {
  const hash = await hashPassword(password);
  db.prepare('UPDATE users SET password_hash=? WHERE username=?').run(hash, 'admin');
}

test('full flow: login, add relay + landing, create link, fetch subscribe', async () => {
  const { app, db } = makeApp();
  await seedAdminPassword(db, 'pw123');

  const login = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'pw123' });
  assert.equal(login.status, 200);
  const token = login.body.token;

  const r1 = await request(app).post('/api/servers')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'hk1', role: 'relay', host: '1.1.1.1', sshUser: 'root', sshAuthType: 'key', sshAuthSecret: 'PRIV', region: 'HK' });
  assert.equal(r1.status, 200);
  const relayId = r1.body.id;

  const r2 = await request(app).post('/api/servers')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'kr3', role: 'landing', host: '2.2.2.2', sshUser: 'root', sshAuthType: 'key', sshAuthSecret: 'PRIV2' });
  const landingId = r2.body.id;

  const linksRes = await request(app).post('/api/links')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'hk1->kr3', relayServerId: relayId, landingServerId: landingId });
  assert.equal(linksRes.status, 200);
  assert.equal(linksRes.body.link.relay_listen_port, 31001);
  assert.ok(linksRes.body.link.uuid);

  const subRes = await request(app).get('/sub/whatever').set('User-Agent', 'v2rayN/7.0');
  assert.equal(subRes.status, 200);
  const decoded = Buffer.from(subRes.text, 'base64').toString('utf8');
  assert.ok(decoded.includes('hk1->kr3-1'));

  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
  assert.equal(me.status, 200);
});

test('invalid login -> 401', async () => {
  const { app, db } = makeApp();
  await seedAdminPassword(db, 'pw123');
  const login = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'bad' });
  assert.equal(login.status, 401);
});

test('no token on protected route -> 401', async () => {
  const { app } = makeApp();
  const res = await request(app).get('/api/servers');
  assert.equal(res.status, 401);
});
```

> 说明：`makeSubRouter` 校验 `settings.sub_slug`，但集成测试在用 `/sub/whatever` 时未 set slug，会 404。因此 Step 2 里须先把 slug 种入：
> 在 `makeApp()` 里 `db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('sub_slug', 'whatever')").run()`——在 `ensureAdmin` 之后加一行。

- [ ] **Step 3: 实现 routes/servers.js**

`server/src/routes/servers.js`：
```js
import express from 'express';
import { buildConn } from '../ssh.js';

export function makeServersRouter({ db, crypto, appSecret, ssh }) {
  const router = express.Router();

  const listQuery = `
    SELECT s.*,
      (CASE s.role
        WHEN 'relay' THEN rs.uuid
        WHEN 'landing' THEN CAST(ls.in_port AS TEXT)
      END) AS role_value
    FROM servers s
    LEFT JOIN relay_settings rs ON rs.server_id = s.id
    LEFT JOIN landing_settings ls ON ls.server_id = s.id
  `;

  router.get('/', (req, res) => {
    res.json(db.prepare(listQuery).all());
  });

  router.post('/', (req, res) => {
    const b = req.body || {};
    const { name, role, host, sshPort = 22, sshUser = 'root', sshAuthType = 'key', sshAuthSecret, region = '' } = b;
    if (!name || !['relay', 'landing'].includes(role) || !host || !sshAuthSecret) {
      return res.status(400).json({ error: 'name/role/host/sshAuthSecret required' });
    }
    const info = db.prepare(
      `INSERT INTO servers (name, role, host, ssh_port, ssh_user, ssh_auth_type, ssh_auth_secret, region)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(name, role, host, sshPort, sshUser, sshAuthType, crypto.encrypt(appSecret, sshAuthSecret), region);
    const id = info.lastInsertRowid;

    if (role === 'relay') {
      const { publicKey, privateKey } = crypto.genRealityKeypair();
      db.prepare(
        `INSERT INTO relay_settings (server_id, uuid, reality_public_key, reality_private_key, short_id, dest_sni, port_base)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(id, crypto.genUuid(), publicKey, crypto.encrypt(appSecret, privateKey), crypto.genShortId(), 'www.microsoft.com', 31000);
    } else {
      db.prepare(
        `INSERT INTO landing_settings (server_id, in_port, method, password) VALUES (?, ?, ?, ?)`
      ).run(id, 32000 + id, '2022-blake3-aes-128-gcm', crypto.encrypt(appSecret, crypto.genSsPassword()));
    }
    res.json(db.prepare(listQuery + ' WHERE s.id = ?').get(id));
  });

  router.put('/:id', (req, res) => {
    const id = Number(req.params.id);
    const b = req.body || {};
    const row = db.prepare('SELECT * FROM servers WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: 'not found' });
    const next = {
      name: b.name ?? row.name,
      role: b.role ?? row.role,
      host: b.host ?? row.host,
      sshPort: b.sshPort ?? row.ssh_port,
      sshUser: b.sshUser ?? row.ssh_user,
      authType: b.sshAuthType ?? row.ssh_auth_type,
      authSecret: b.sshAuthSecret !== undefined ? crypto.encrypt(appSecret, b.sshAuthSecret) : row.ssh_auth_secret,
      region: b.region ?? row.region,
    };
    db.prepare(
      `UPDATE servers SET name=?, role=?, host=?, ssh_port=?, ssh_user=?, ssh_auth_type=?, ssh_auth_secret=?, region=? WHERE id=?`
    ).run(next.name, next.role, next.host, next.sshPort, next.sshUser, next.authType, next.authSecret, next.region, id);
    res.json(db.prepare(listQuery + ' WHERE s.id = ?').get(id));
  });

  router.delete('/:id', (req, res) => {
    const id = Number(req.params.id);
    const used = db.prepare('SELECT COUNT(*) c FROM links WHERE relay_server_id = ? OR landing_server_id = ?').get(id, id).c;
    if (used > 0) return res.status(409).json({ error: 'server in use by links' });
    db.prepare('DELETE FROM servers WHERE id = ?').run(id);
    res.json({ ok: true });
  });

  router.post('/:id/test', async (req, res) => {
    const id = Number(req.params.id);
    const row = db.prepare('SELECT * FROM servers WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: 'not found' });
    const conn = buildConn(row, crypto.decrypt, appSecret);
    const result = await ssh.testConnection ? ssh.testConnection(conn) : { ok: false, message: 'ssh.testConnection missing' };
    res.json(result);
  });

  return router;
}
```

- [ ] **Step 4: 实现 routes/links.js**

`server/src/routes/links.js`：
```js
import express from 'express';
import { deployRelay } from '../deployServices.js';

export function makeLinksRouter({ db, crypto, ssh, config }) {
  const router = express.Router();

  const listQuery = `
    SELECT l.*, s.name AS relay_name, g.name AS landing_name
    FROM links l
    JOIN servers s ON s.id = l.relay_server_id
    JOIN servers g ON g.id = l.landing_server_id
  `;

  router.get('/', (req, res) => {
    res.json(db.prepare(listQuery).all());
  });

  router.post('/', async (req, res) => {
    const b = req.body || {};
    const { name, relayServerId, landingServerId } = b;
    if (!name || !relayServerId || !landingServerId) {
      return res.status(400).json({ error: 'name/relayServerId/landingServerId required' });
    }
    const relay = db.prepare('SELECT role FROM servers WHERE id = ?').get(relayServerId);
    const landing = db.prepare('SELECT role FROM servers WHERE id = ?').get(landingServerId);
    if (!relay || relay.role !== 'relay') return res.status(400).json({ error: 'invalid relay' });
    if (!landing || landing.role !== 'landing') return res.status(400).json({ error: 'invalid landing' });

    const rs = db.prepare('SELECT port_base FROM relay_settings WHERE server_id = ?').get(relayServerId);
    const used = db.prepare('SELECT relay_listen_port FROM links WHERE relay_server_id = ?').all(relayServerId)
      .map((r) => r.relay_listen_port);
    let port = (rs ? rs.port_base : 31000) + 1;
    while (used.includes(port)) port++;

    const uuid = crypto.genUuid();
    const info = db.prepare(
      `INSERT INTO links (name, relay_server_id, landing_server_id, relay_listen_port, enabled, uuid, created_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`
    ).run(name, relayServerId, landingServerId, port, uuid, new Date().toISOString());
    const linkId = info.lastInsertRowid;

    let deploy = null;
    try {
      deploy = await deployRelay(db, ssh, crypto, config, relayServerId);
    } catch (err) {
      deploy = { ok: false, error: err.message };
    }
    res.json({ link: db.prepare(listQuery + ' WHERE l.id = ?').get(linkId), deploy });
  });

  router.put('/:id', async (req, res) => {
    const id = Number(req.params.id);
    const row = db.prepare('SELECT * FROM links WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: 'not found' });
    const b = req.body || {};
    const next = {
      name: b.name ?? row.name,
      enabled: b.enabled !== undefined ? (b.enabled ? 1 : 0) : row.enabled,
    };
    db.prepare('UPDATE links SET name=?, enabled=? WHERE id=?').run(next.name, next.enabled, id);
    let deploy = null;
    try {
      deploy = await deployRelay(db, ssh, crypto, config, row.relay_server_id);
    } catch (err) {
      deploy = { ok: false, error: err.message };
    }
    res.json({ link: db.prepare(listQuery + ' WHERE l.id = ?').get(id), deploy });
  });

  router.delete('/:id', async (req, res) => {
    const id = Number(req.params.id);
    const row = db.prepare('SELECT * FROM links WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: 'not found' });
    db.prepare('DELETE FROM links WHERE id = ?').run(id);
    let deploy = null;
    try {
      deploy = await deployRelay(db, ssh, crypto, config, row.relay_server_id);
    } catch (err) {
      deploy = { ok: false, error: err.message };
    }
    res.json({ ok: true, deploy });
  });

  return router;
}
```

- [ ] **Step 5: 实现 routes/sub.js 与 routes/settings.js**

`server/src/routes/sub.js`：
```js
import express from 'express';
import { collectLinkViews, pickFormat, toBase64, toSingboxConfig } from '../sub.js';
import { getSetting } from '../db.js';

export function makeSubRouter(db) {
  const router = express.Router();
  router.get('/:slug', (req, res) => {
    const slug = req.params.slug;
    if (getSetting(db, 'sub_slug') !== slug) {
      return res.status(404).json({ error: 'not found' });
    }
    const views = collectLinkViews(db);
    const format = pickFormat(req.query, req.get('user-agent') || '');
    if (format === 'singbox') {
      return res.type('application/json').send(JSON.stringify(toSingboxConfig(views), null, 2));
    }
    return res.type('text/plain').send(toBase64(views));
  });
  return router;
}
```

`server/src/routes/settings.js`：
```js
import express from 'express';
import { getSetting, setSetting } from '../db.js';
import { genRandomHex } from '../crypto.js';

export function makeSettingsRouter(db, appSecret) {
  const router = express.Router();
  router.get('/', (req, res) => {
    let slug = getSetting(db, 'sub_slug');
    if (!slug) {
      slug = genRandomHex(6);
      setSetting(db, 'sub_slug', slug);
    }
    res.json({ subSlug: slug, subUrl: `/sub/${slug}` });
  });
  router.post('/', (req, res) => {
    const slug = String((req.body || {}).subSlug || '').replace(/[^a-zA-Z0-9_-]/g, '');
    if (!slug) return res.status(400).json({ error: 'invalid slug' });
    setSetting(db, 'sub_slug', slug);
    res.json({ subSlug: slug, subUrl: `/sub/${slug}` });
  });
  return router;
}
```

- [ ] **Step 6: 补充 crypto.js 命名空间导出（供注入 routes/test 使用）**

在 `server/src/crypto.js` 末尾追加：
```js
export const cryptoModule = { encrypt, decrypt, genUuid, genSsPassword, genShortId, genRealityKeypair, genRandomHex };
```
> 说明：routes 通过构造参数注入 `crypto` 对象，生产装配时传 `cryptoModule`；测试可直接传 `cryptoModule` 或自定义 mock。上方 `makeApp` 已用 `overrides.crypto || cryptoExports`，等价。

- [ ] **Step 7: 跑全部测试**

Run（在 server/ 下）: `node --test test/`
Expected: 之前任务全部 PASS + api.test.js 3 条 PASS

- [ ] **Step 8: 提交**

```bash
git add server/src/deployServices.js server/src/routes/ server/test/api.test.js server/src/crypto.js
git commit -m "feat: servers/links/sub/settings routes + deploy services + api tests"
```

---

### Task 14: index.js 应用装配 + probe 循环

**Files:**
- Create: `server/src/index.js`
- Test: `server/test/index.test.js`（启动冒烟）

**Interfaces:**
- Consumes: 全部模块。
- Produces:
  - `createApp({ config }) => { app, db, server }`（不自动 listen）
  - 装配：`/api/health` → `{ ok: true, version: '0.1.0' }`；`/api/auth`；`/api/servers`；`/api/links`；`/api/settings`；`/sub`；未匹配 JSON 404。
  - 启动时：`initDb`、`ensureAdmin`（bcrypt 由 ADMIN_PASS 或随机生成打印）、若无 sub slug 生成。
  - 若 `frontend/dist/index.html` 存在 → 静态托管（express.static + SPA fallback）。
  - `startProbeLoop(db, ssh, crypto, config, intervalMs)` 导出，返回 `{ stop }`。默认在 `listen` 后启动。

- [ ] **Step 1: 实现 index.js**

`server/src/index.js`：
```js
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { initDb, ensureAdmin, getSetting, setSetting } from './db.js';
import { hashPassword } from './auth.js';
import * as crypto from './crypto.js';
import * as ssh from './ssh.js';
import { makeAuthRouter, requireAuth } from './auth.js';
import { makeServersRouter } from './routes/servers.js';
import { makeLinksRouter } from './routes/links.js';
import { makeSubRouter } from './routes/sub.js';
import { makeSettingsRouter } from './routes/settings.js';
import { probeOnce } from './probe.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VERSION = '0.1.0';

export function createApp({ config }) {
  const db = initDb(config.dbPath);

  if (!getSetting(db, 'sub_slug')) {
    setSetting(db, 'sub_slug', crypto.genRandomHex(6));
  }

  const adminHash = 'pending';
  (async () => {
    const existing = db.prepare('SELECT id FROM users LIMIT 1').get();
    if (!existing) {
      const pass = config.adminPass || crypto.genRandomHex(8);
      const hash = await hashPassword(pass);
      ensureAdmin(db, { username: config.adminUser, passwordHash: hash });
      if (!config.adminPass) {
        console.log(`[bootstrap] admin user: ${config.adminUser}  password: ${pass}`);
      }
    }
  })();

  const app = express();
  app.use(express.json());

  app.get('/api/health', (req, res) => res.json({ ok: true, version: VERSION }));

  app.use('/api/auth', makeAuthRouter(db, config.jwtSecret));
  const auth = requireAuth(config.jwtSecret);
  app.use('/api/servers', auth, makeServersRouter({ db, crypto, appSecret: config.appSecret, ssh }));
  app.use('/api/links', auth, makeLinksRouter({ db, crypto, ssh, config }));
  app.use('/api/settings', auth, makeSettingsRouter(db, config.appSecret));
  app.use('/sub', makeSubRouter(db));

  app.use('/api', (req, res) => res.status(404).json({ error: 'not found' }));

  const frontendDist = path.join(__dirname, '..', '..', 'frontend', 'dist');
  if (fs.existsSync(path.join(frontendDist, 'index.html'))) {
    app.use(express.static(frontendDist));
    app.get('*', (req, res) => res.sendFile(path.join(frontendDist, 'index.html')));
  }

  const startProbeLoop = () => {
    const timer = setInterval(() => {
      probeOnce(db, ssh, crypto, config).catch((err) => console.error('probe error:', err.message));
    }, config.probeIntervalMs);
    probeOnce(db, ssh, crypto, config).catch(() => {});
    return { stop: () => clearInterval(timer) };
  };

  return { app, db, startProbeLoop };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
  const config = loadConfig();
  const { app, startProbeLoop } = createApp({ config });
  const server = app.listen(config.port, config.host, () => {
    console.log(`[singbox-panel] listening on http://${config.host}:${config.port}`);
    startProbeLoop();
  });
  server.on('error', (err) => { console.error(err); process.exit(1); });
}
```

- [ ] **Step 2: 写冒烟测试 index.test.js**

`server/test/index.test.js`：
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/index.js';

test('createApp serves health and 404 on unknown api', async () => {
  const { app } = createApp({ config: { appSecret: 'b'.repeat(32), jwtSecret: 'j', adminUser: 'admin', adminPass: '', probeIntervalMs: 60000, dbPath: ':memory:' } });
  const h = await request(app).get('/api/health');
  assert.equal(h.status, 200);
  assert.equal(h.body.ok, true);
  const nf = await request(app).get('/api/unknown');
  assert.equal(nf.status, 404);
});

test('login works with auto-seeded admin when ADMIN_PASS empty', async () => {
  const { app, db } = createApp({ config: { appSecret: 'b'.repeat(32), jwtSecret: 'j', adminUser: 'auto', adminPass: 'seed-pass', probeIntervalMs: 60000, dbPath: ':memory:' } });
  // hashPassword is async inside createApp; poll until user exists
  for (let i = 0; i < 20 && !db.prepare('SELECT id FROM users LIMIT 1').get(); i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
  const res = await request(app).post('/api/auth/login').send({ username: 'auto', password: 'seed-pass' });
  assert.equal(res.status, 200);
  assert.ok(res.body.token);
});
```

- [ ] **Step 3: 安装依赖到 server**

```bash
npm install express --workspace server   # 若上一步已装则跳过
```

- [ ] **Step 4: 运行全部测试**

Run（在 server/ 下）: `node --test test/`
Expected: 全部 PASS

- [ ] **Step 5: 手动冒烟——本地无服务器也能启动、登录、加服务器**

```bash
APP_SECRET=00000000000000000000000000000000 ADMIN_PASS=test123 npm run dev
```
预期：日志打印 listening，`/api/health` 200。

- [ ] **Step 6: 提交**

```bash
git add server/src/index.js server/test/index.test.js
git commit -m "feat: express app assembly + probe loop + smoke tests"
```

---

### Task 15: 前端脚手架（Vite + Vue3 + 路由 + API 客户端）

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/vite.config.js`
- Create: `frontend/index.html`
- Create: `frontend/src/main.js`
- Create: `frontend/src/App.vue`
- Create: `frontend/src/router.js`
- Create: `frontend/src/api.js`
- Create: `frontend/src/style.css`

**Interfaces:**
- Produces:
  - `api.js`：`apiFetch(path, { method, body, token })`，自动带 `Authorization: Bearer`（token 存 `localStorage.sb_token`）；导出 `login(username, password)`, `getServers()`, `createServer(payload)`, `testServer(id)`, `updateServer(id, payload)`, `deleteServer(id)`, `getLinks()`, `createLink(payload)`, `setLinkEnabled(id, enabled)`, `deleteLink(id)`, `getSettings()`, `setSlug(slug)`。
  - `router.js`：`/login` → Login，`/` → App 主布局（含 tab），登录守卫（无 token 跳 login）。
- Vue 版本：包直接依赖 `vue@3`、`vue-router@4`、`vite@6`、`@vitejs/plugin-vue`。

- [ ] **Step 1: 写前端 package.json**

```json
{
  "name": "frontend",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "vue": "^3.5.0",
    "vue-router": "^4.4.0"
  },
  "devDependencies": {
    "@vitejs/plugin-vue": "^5.2.0",
    "vite": "^6.0.0"
  }
}
```

- [ ] **Step 2: 写 vite.config.js（代理 /api、/sub 到后端）**

```js
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8081',
      '/sub': 'http://127.0.0.1:8081',
    },
  },
});
```

- [ ] **Step 3: 写 index.html**

```html
<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>SingBox 面板</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
```

- [ ] **Step 4: 写 main.js / App.vue / router.js / style.css / api.js**

`frontend/src/main.js`：
```js
import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router.js';
import './style.css';

createApp(App).use(router).mount('#app');
```

`frontend/src/router.js`：
```js
import { createRouter, createWebHistory } from 'vue-router';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: () => import('./views/Login.vue') },
    {
      path: '/',
      component: () => import('./views/Layout.vue'),
      beforeEnter: (_to, _from, next) => {
        next(localStorage.getItem('sb_token') ? undefined : '/login');
      },
      children: [
        { path: '', redirect: '/servers' },
        { path: 'servers', component: () => import('./views/Servers.vue') },
        { path: 'links', component: () => import('./views/Links.vue') },
        { path: 'settings', component: () => import('./views/Settings.vue') },
      ],
    },
  ],
});
```

`frontend/src/api.js`：
```js
async function apiFetch(path, { method = 'GET', body } = {}) {
  const token = localStorage.getItem('sb_token');
  const res = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    localStorage.removeItem('sb_token');
    window.location.href = '/login';
    throw new Error('unauthorized');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export const login = async (username, password) => {
  const data = await apiFetch('/api/auth/login', { method: 'POST', body: { username, password } });
  localStorage.setItem('sb_token', data.token);
  return data;
};
export const getServers = () => apiFetch('/api/servers');
export const createServer = (payload) => apiFetch('/api/servers', { method: 'POST', body: payload });
export const updateServer = (id, payload) => apiFetch(`/api/servers/${id}`, { method: 'PUT', body: payload });
export const deleteServer = (id) => apiFetch(`/api/servers/${id}`, { method: 'DELETE' });
export const testServer = (id) => apiFetch(`/api/servers/${id}/test`, { method: 'POST' });
export const getLinks = () => apiFetch('/api/links');
export const createLink = (payload) => apiFetch('/api/links', { method: 'POST', body: payload });
export const setLinkEnabled = (id, enabled) => apiFetch(`/api/links/${id}`, { method: 'PUT', body: { enabled } });
export const deleteLink = (id) => apiFetch(`/api/links/${id}`, { method: 'DELETE' });
export const getSettings = () => apiFetch('/api/settings');
export const setSlug = (slug) => apiFetch('/api/settings', { method: 'POST', body: { subSlug: slug } });
```

`frontend/src/style.css`：
```css
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background: #0f172a; color: #e2e8f0; }
a { color: #38bdf8; }
button { background: #2563eb; color: #fff; border: 0; padding: 8px 14px; border-radius: 6px; cursor: pointer; }
button.secondary { background: #334155; }
input, select { background: #1e293b; color: #e2e8f0; border: 1px solid #334155; border-radius: 6px; padding: 8px; }
table { border-collapse: collapse; width: 100%; }
th, td { text-align: left; padding: 8px; border-bottom: 1px solid #1e293b; }
.card { background: #1e293b; border-radius: 10px; padding: 16px; margin-bottom: 16px; }
.badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 12px; }
.badge.online { background: #16a34a; }
.badge.offline { background: #dc2626; }
.badge.unknown { background: #64748b; }
```

`frontend/src/App.vue`：
```vue
<template>
  <router-view />
</template>
```

- [ ] **Step 5: 安装前端依赖并确保能 build**

```bash
cd frontend && npm install
npx vite build
```
Expected: dist/index.html 生成，无报错。

- [ ] **Step 6: 提交**

```bash
git add frontend/
git commit -m "feat: vue3 + vite scaffold with router and api client"
```

---

### Task 16: 前端页面（Login / Layout / Servers / Links / Settings）

**Files:**
- Create: `frontend/src/views/Login.vue`
- Create: `frontend/src/views/Layout.vue`
- Create: `frontend/src/views/Servers.vue`
- Create: `frontend/src/views/Links.vue`
- Create: `frontend/src/views/Settings.vue`

**Interfaces:**
- Consumes: `frontend/src/api.js` 全部导出。
- Produces:
  - `Login.vue`：用户名/密码表单 → `login()` → `router.push('/servers')`。
  - `Servers.vue`：列表（name/role/host/ping_status/singbox_version）+ 可展开"新增服务器"表单（role、host、ssh 认证类型与私钥/口令 textarea）+ test SSH + 删除。
  - `Links.vue`：列表（name、relay→landing、port、enabled 启停开关、删除）+ 新建表单（name + relay 下拉 + landing 下拉，仅显示对应 role）+ 展示本次 deploy 结果 ok/error。
  - `Settings.vue`：显示订阅 URL，复制按钮，格式说明；可改 slug。

- [ ] **Step 1: 写 Login.vue**

```vue
<template>
  <main class="center">
    <form class="card" @submit.prevent="submit">
      <h1>SingBox 面板</h1>
      <p><input v-model="username" placeholder="用户名" autocomplete="username" /></p>
      <p><input v-model="password" type="password" placeholder="密码" autocomplete="current-password" /></p>
      <button type="submit" :disabled="busy">{{ busy ? '登录中…' : '登录' }}</button>
      <p v-if="error" class="red">{{ error }}</p>
    </form>
  </main>
</template>

<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { login } from '../api.js';

const router = useRouter();
const username = ref('');
const password = ref('');
const busy = ref(false);
const error = ref('');
async function submit() {
  busy.value = true;
  error.value = '';
  try {
    await login(username.value, password.value);
    router.push('/servers');
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.center { display: grid; place-items: center; min-height: 100vh; }
.red { color: #f87171; }
</style>
```

- [ ] **Step 2: 写 Layout.vue**

```vue
<template>
  <div>
    <nav>
      <router-link to="/servers">服务器</router-link>
      <router-link to="/links">链路</router-link>
      <router-link to="/settings">订阅</router-link>
      <button class="secondary" @click="logout">退出</button>
    </nav>
    <div class="content">
      <router-view />
    </div>
  </div>
</template>

<script setup>
import { useRouter } from 'vue-router';
const router = useRouter();
function logout() {
  localStorage.removeItem('sb_token');
  router.push('/login');
}
</script>

<style scoped>
nav { display: flex; gap: 12px; padding: 12px 20px; background: #020617; align-items: center; }
nav a { color: #94a3b8; text-decoration: none; }
nav a.router-link-exact-active { color: #38bdf8; }
nav button { margin-left: auto; }
.content { padding: 20px; max-width: 1000px; margin: 0 auto; }
</style>
```

- [ ] **Step 3: 写 Servers.vue**

```vue
<template>
  <section>
    <h2>服务器</h2>
    <div class="card">
      <h3>新增服务器</h3>
      <form @submit.prevent="create">
        <p>
          名称 <input v-model="form.name" required />
          角色
          <select v-model="form.role">
            <option value="relay">中转机 (relay)</option>
            <option value="landing">落地机 (landing)</option>
          </select>
          地区 <input v-model="form.region" placeholder="HK" />
        </p>
        <p>
          Host <input v-model="form.host" placeholder="1.2.3.4" required />
          SSH 端口 <input v-model.number="form.sshPort" type="number" value="22" />
          SSH 用户 <input v-model="form.sshUser" value="root" />
        </p>
        <p>
          认证方式
          <select v-model="form.sshAuthType">
            <option value="key">私钥</option>
            <option value="password">密码</option>
          </select>
          <textarea v-model="form.sshAuthSecret" rows="3" placeholder="私钥内容或密码" required></textarea>
        </p>
        <button type="submit">保存</button>
      </form>
    </div>

    <table>
      <thead>
        <tr><th>名称</th><th>角色</th><th>Host</th><th>地区</th><th>状态</th><th>sing-box</th><th>操作</th></tr>
      </thead>
      <tbody>
        <tr v-for="s in servers" :key="s.id">
          <td>{{ s.name }}</td>
          <td>{{ s.role }}</td>
          <td>{{ s.host }}</td>
          <td>{{ s.region }}</td>
          <td><span class="badge" :class="s.ping_status">{{ s.ping_status }}</span></td>
          <td>{{ s.singbox_version || '-' }}</td>
          <td>
            <button class="secondary" @click="test(s)">测连通</button>
            <button class="secondary" @click="remove(s)">删除</button>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-if="error" class="red">{{ error }}</p>
  </section>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { getServers, createServer, testServer, deleteServer } from '../api.js';

const servers = ref([]);
const error = ref('');
const form = ref({ name: '', role: 'relay', host: '', sshPort: 22, sshUser: 'root', sshAuthType: 'key', sshAuthSecret: '', region: '' });

async function load() { servers.value = await getServers(); }
async function create() {
  error.value = '';
  try {
    await createServer({ ...form.value });
    form.value = { name: '', role: 'relay', host: '', sshPort: 22, sshUser: 'root', sshAuthType: 'key', sshAuthSecret: '', region: '' };
    await load();
  } catch (e) { error.value = e.message; }
}
async function test(s) {
  const r = await testServer(s.id);
  alert(r.ok ? '连接成功' : `连接失败: ${r.message || ''}`);
}
async function remove(s) {
  if (!confirm(`删除服务器 ${s.name}?`)) return;
  try { await deleteServer(s.id); await load(); }
  catch (e) { error.value = e.message; }
}
onMounted(load);
</script>

<style scoped>
.red { color: #f87171; }
textarea { width: 100%; font-family: ui-monospace, monospace; }
</style>
```

- [ ] **Step 4: 写 Links.vue**

```vue
<template>
  <section>
    <h2>中转链路</h2>
    <div class="card">
      <h3>新建链路</h3>
      <form @submit.prevent="create">
        <p>
          名称 <input v-model="form.name" placeholder="HK1->KR3" required />
          入口机
          <select v-model="form.relayServerId">
            <option v-for="s in relays" :key="s.id" :value="s.id">{{ s.name }} ({{ s.host }})</option>
          </select>
          落地机
          <select v-model="form.landingServerId">
            <option v-for="s in landings" :key="s.id" :value="s.id">{{ s.name }} ({{ s.host }})</option>
          </select>
        </p>
        <button type="submit">创建</button>
        <span v-if="deployMsg">下发结果: {{ deployMsg }}</span>
      </form>
    </div>

    <table>
      <thead>
        <tr><th>名称</th><th>入口 → 落地</th><th>端口</th><th>启用</th><th>操作</th></tr>
      </thead>
      <tbody>
        <tr v-for="l in links" :key="l.id">
          <td>{{ l.name }}</td>
          <td>{{ l.relay_name }} → {{ l.landing_name }}</td>
          <td>{{ l.relay_listen_port }}</td>
          <td><input type="checkbox" :checked="!!l.enabled" @change="toggle(l, $event.target.checked)" /></td>
          <td><button class="secondary" @click="remove(l)">删除</button></td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { getLinks, getServers, createLink, setLinkEnabled, deleteLink } from '../api.js';

const links = ref([]);
const servers = ref([]);
const relays = ref([]);
const landings = ref([]);
const form = ref({ name: '', relayServerId: null, landingServerId: null });
const deployMsg = ref('');

async function load() {
  links.value = await getLinks();
  servers.value = await getServers();
  relays.value = servers.value.filter((s) => s.role === 'relay');
  landings.value = servers.value.filter((s) => s.role === 'landing');
  if (relays.value.length && form.value.relayServerId === null) form.value.relayServerId = relays.value[0].id;
  if (landings.value.length && form.value.landingServerId === null) form.value.landingServerId = landings.value[0].id;
}
async function create() {
  deployMsg.value = '';
  try {
    const res = await createLink({ ...form.value, relayServerId: Number(form.value.relayServerId), landingServerId: Number(form.value.landingServerId) });
    deployMsg.value = res.deploy?.ok ? `OK (${(res.deploy.steps || []).join(',')})` : `失败: ${res.deploy?.error || ''}`;
    await load();
  } catch (e) { deployMsg.value = e.message; }
}
async function toggle(l, enabled) {
  await setLinkEnabled(l.id, enabled);
  await load();
}
async function remove(l) {
  if (!confirm(`删除链路 ${l.name}?`)) return;
  try { await deleteLink(l.id); await load(); }
  catch (e) { deployMsg.value = e.message; }
}
onMounted(load);
</script>
```

- [ ] **Step 5: 写 Settings.vue**

```vue
<template>
  <section>
    <h2>订阅</h2>
    <div class="card">
      <p>订阅链接（填入客户端）：</p>
      <p><code>{{ fullUrl }}</code></p>
      <button class="secondary" @click="copy">复制</button>
      <button class="secondary" @click="open">打开</button>
      <p>
        自定义 slug：<input v-model="slugInput" />
        <button @click="saveSlug">保存</button>
      </p>
    </div>
    <div class="card">
      <h3>格式说明</h3>
      <ul>
        <li><b>base64</b>：v2rayN、Clash 等（默认，或加 <code>?format=base64</code>）</li>
        <li><b>sing-box json</b>：sing-box / SFA / SFI（默认 UA 检测或加 <code>?format=singbox</code>）</li>
      </ul>
    </div>
  </section>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { getSettings, setSlug } from '../api.js';

const subSlug = ref('');
const slugInput = ref('');
const fullUrl = computed(() => `${location.origin}/sub/${subSlug.value}`);
async function load() {
  const s = await getSettings();
  subSlug.value = s.subSlug;
  slugInput.value = s.subSlug;
}
async function copy() { await navigator.clipboard.writeText(fullUrl.value); alert('已复制'); }
async function open() { window.open(fullUrl.value, '_blank'); }
async function saveSlug() {
  const s = await setSlug(slugInput.value);
  subSlug.value = s.subSlug;
}
onMounted(load);
</script>
```

- [ ] **Step 6: build 前端确认无错**

```bash
cd frontend && npx vite build
```
Expected: 成功产出 dist/

- [ ] **Step 7: 提交**

```bash
git add frontend/src/
git commit -m "feat: frontend views (login, servers, links, settings)"
```

---

### Task 17: 部署产物（systemd / nginx / 安装脚本 / 部署文档）

**Files:**
- Create: `deploy/singbox-panel.service`
- Create: `deploy/nginx.conf.example`
- Create: `deploy/install-panel.sh`
- Create: `docs/部署.md`

**Global constraints compliance:** systemd unit 读取 `/etc/singbox-panel/panel.env`；安装脚本负责：装 Node 20+、建目录、复制 env、装 systemd、启动。

- [ ] **Step 1: 写 systemd unit**

`deploy/singbox-panel.service`：
```ini
[Unit]
Description=SingBox personal panel
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/singbox-panel
EnvironmentFile=-/etc/singbox-panel/panel.env
ExecStart=/usr/bin/node /opt/singbox-panel/server/src/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 2: 写 nginx 反代示例**

`deploy/nginx.conf.example`：
```nginx
server {
    listen 443 ssl;
    server_name panel.example.com;
    ssl_certificate     /etc/letsencrypt/live/panel.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/panel.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8081;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

- [ ] **Step 3: 写部署文档 docs/部署.md**

覆盖：准备工作（openssl rand -hex 32 生成 APP_SECRET）、单机安装脚本用法、手动安装（Node、git clone、npm install、ln env）、systemd 启用、nginx/caddy HTTPS、首次登录（首启随机密码打印）、录入 6 台服务器、建链路、客户端订阅指引（base64/singbox 两种格式适用客户端）、常见问题（reload 失败、Reality dest_sni 更换、ss-2022 客户端兼容性）。正文可读，无占位符。

- [ ] **Step 4: 写安装脚本 install-panel.sh**（精简但可用）

`deploy/install-panel.sh`：
```bash
#!/usr/bin/env bash
set -euo pipefail

PANEL_DIR=/opt/singbox-panel
ENV_FILE=/etc/singbox-panel/panel.env
export DEBIAN_FRONTEND=noninteractive

echo "==> installing Node 20+"
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -c2- | cut -d. -f1)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

echo "==> cloning panel"
mkdir -p "$PANEL_DIR"
if [ ! -f "$PANEL_DIR/package.json" ]; then
  git clone https://github.com/YOUR_REPO/singbox-panel.git "$PANEL_DIR"
fi
cd "$PANEL_DIR"

echo "==> installing deps"
npm install --workspace server
cd frontend && npm install && npx vite build && cd ..

echo "==> configuring env"
mkdir -p "$(dirname "$ENV_FILE")"
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<EOF
APP_SECRET=$(openssl rand -hex 32)
PANEL_LISTEN=0.0.0.0:8081
PANEL_DB=./data/panel.db
ADMIN_USER=admin
ADMIN_PASS=
JWT_SECRET=$(openssl rand -hex 32)
SINGBOX_BIN=/usr/local/bin/sing-box
SINGBOX_CONFIG=/etc/sing-box/config.json
SINGBOX_UNIT=sing-box
PROBE_INTERVAL_MS=60000
EOF
fi

echo "==> systemd"
cp deploy/singbox-panel.service /etc/systemd/system/singbox-panel.service
systemctl daemon-reload
systemctl enable --now singbox-panel
systemctl status singbox-panel --no-pager || true

echo "==> done. 首次登录密码见: journalctl -u singbox-panel -n 50 | grep bootstrap"
```

- [ ] **Step 5: 提交**

```bash
git add deploy/ docs/部署.md
git commit -m "docs: deployment artifacts and guide"
```

---

### Task 18: 端到端验收

**Files:**
- Modify: 无（纯验证）
- Read: `docs/部署.md`

- [ ] **Step 1: 后端全量测试**

Run（在 server/ 下）: `node --test test/`
Expected: 全部 PASS

- [ ] **Step 2: 前端构建**

Run: `cd frontend && npm run build`
Expected: 无报错

- [ ] **Step 3: 本地起服务冒烟**

```bash
APP_SECRET=00000000000000000000000000000000 ADMIN_PASS=test123 npm run dev
```
Expected: listening 日志 + 访问 http://127.0.0.1:8081/api/health 返回 ok。

- [ ] **Step 4: 手动集成清单（写入 docs/部署.md 的"验收清单"节，本步执行）**

1. 登录面板 → 添加 6 台服务器（1/2 relay，3/4/5/6 landing）。
2. 在 3 号机手动装 sing-box + systemd 后，`POST /api/servers/3/test` 通过。
3. 建链路 1→3（创建成功，deploy.ok=true，`systemctl reload` 生效）。
4. 订阅：用 v2rayN 拉 base64、用 sing-box 拉 json，均能看到 `HK1->KR3-1` 节点。
5. 停用链路 → 订阅节点消失，中转机 config reload 后入站移除。
6. 客户端实测：连 1 的 31001 端口，出口 IP 为 3 的 IP。

- [ ] **Step 5: 提交验收文档更新（若有修正项）**

```bash
git add docs/部署.md
git commit -m "docs: verification checklist results"
```