import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const DDL = `
CREATE TABLE IF NOT EXISTS servers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('relay','landing')),
  control TEXT NOT NULL DEFAULT 'ssh' CHECK(control IN ('ssh','agent')),
  host TEXT NOT NULL DEFAULT '',
  client_host TEXT NOT NULL DEFAULT '',  -- 对外地址(客户端/机器间连接用;留空=用 host,SSH 目标=host)
  ssh_port INTEGER NOT NULL DEFAULT 22,
  ssh_user TEXT NOT NULL DEFAULT 'root',
  ssh_auth_type TEXT NOT NULL DEFAULT 'key' CHECK(ssh_auth_type IN ('key','password')),
  ssh_auth_secret TEXT NOT NULL DEFAULT '',
  ssh_sudo INTEGER NOT NULL DEFAULT 0,   -- 1 = 命令经 sudo -n 执行(甲骨文等仅给普通用户的机器)
  region TEXT NOT NULL DEFAULT '',
  ping_status TEXT NOT NULL DEFAULT 'unknown' CHECK(ping_status IN ('online','inactive','offline','unknown')),
  singbox_version TEXT NOT NULL DEFAULT '',
  last_seen TEXT
);
CREATE TABLE IF NOT EXISTS relay_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER NOT NULL UNIQUE REFERENCES servers(id) ON DELETE CASCADE,
  reality_public_key TEXT NOT NULL,
  reality_private_key TEXT NOT NULL,
  short_id TEXT NOT NULL,
  port_base INTEGER NOT NULL DEFAULT 31000
);
CREATE TABLE IF NOT EXISTS landing_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER NOT NULL UNIQUE REFERENCES servers(id) ON DELETE CASCADE,
  in_port INTEGER NOT NULL,
  method TEXT NOT NULL DEFAULT '2022-blake3-aes-128-gcm',
  password TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  protocol TEXT NOT NULL,
  listen_port INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  creds_enc TEXT NOT NULL DEFAULT '',
  tls_mode TEXT NOT NULL DEFAULT 'none' CHECK(tls_mode IN ('none','reality','tls','shadowtls')),
  sni TEXT NOT NULL DEFAULT '',
  transport TEXT NOT NULL DEFAULT 'raw' CHECK(transport IN ('raw','ws')),
  ws_path TEXT NOT NULL DEFAULT '',
  outbound_type TEXT NOT NULL DEFAULT 'direct' CHECK(outbound_type IN ('direct','relay')),
  landing_server_id INTEGER REFERENCES servers(id),
  tunnel_address TEXT NOT NULL DEFAULT '',
  tunnel_port INTEGER,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(server_id, listen_port)
);
CREATE TABLE IF NOT EXISTS sni_library (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT NOT NULL UNIQUE,
  note TEXT NOT NULL DEFAULT '',
  builtin INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

export function initDb(dbPath) {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(DDL);
  migrate(db);
  seedSniLibrary(db);
  return db;
}

/** 轻量迁移:存量库补列 */
function migrate(db) {
  const cols = db.prepare('PRAGMA table_info(servers)').all().map((c) => c.name);
  if (!cols.includes('ssh_sudo')) {
    db.exec('ALTER TABLE servers ADD COLUMN ssh_sudo INTEGER NOT NULL DEFAULT 0');
  }
  if (!cols.includes('client_host')) {
    db.exec("ALTER TABLE servers ADD COLUMN client_host TEXT NOT NULL DEFAULT ''");
  }
}

/** Reality 借站域名库内置种子(仅空表时插入,可编辑/删除)。
 * ✓实测可用/⚠️实测不兼容 标注基于 2026-08 CoreNet(HK)实测;结果与机器网络路径相关,各地可能不同。 */
const SNI_SEED = [
  ['www.microsoft.com', '微软官网 ⚠️实测不兼容'],
  ['www.apple.com', 'Apple 官网 ⚠️实测不兼容'],
  ['dl.google.com', 'Google 下载 ✓实测可用'],
  ['www.google.com', 'Google'],
  ['www.youtube.com', 'YouTube'],
  ['www.cloudflare.com', 'Cloudflare ✓实测可用'],
  ['gateway.icloud.com', 'iCloud'],
  ['swdist.apple.com', 'Apple 软件更新'],
  ['www.bing.com', 'Bing ✓实测可用'],
  ['support.microsoft.com', '微软支持'],
  ['www.office.com', 'Microsoft 365'],
  ['www.amazon.com', 'Amazon'],
  ['www.yahoo.com', 'Yahoo ⚠️实测不兼容'],
  ['www.oracle.com', 'Oracle ✓实测可用'],
  ['www.nvidia.com', 'NVIDIA ✓实测可用'],
  ['www.adobe.com', 'Adobe ✓实测可用'],
  ['www.samsung.com', '三星 ✓实测可用'],
  ['www.facebook.com', 'Facebook ⚠️实测不兼容'],
  ['www.instagram.com', 'Instagram ⚠️实测不兼容'],
  ['www.tiktok.com', 'TikTok ⚠️实测不兼容'],
  ['discord.com', 'Discord ⚠️实测不兼容'],
  ['www.netflix.com', 'Netflix ✓实测可用'],
  ['www.tesla.com', 'Tesla ✓实测可用'],
  ['www.cisco.com', 'Cisco ✓实测可用'],
  ['www.spotify.com', 'Spotify'],
  ['chat.openai.com', 'OpenAI'],
  ['www.paypal.com', 'PayPal ✓实测可用'],
];

function seedSniLibrary(db) {
  const count = db.prepare('SELECT COUNT(*) c FROM sni_library').get().c;
  if (count > 0) return;
  const ins = db.prepare('INSERT INTO sni_library (domain, note, builtin) VALUES (?, ?, 1)');
  for (const [domain, note] of SNI_SEED) {
    ins.run(domain, note);
  }
}

export function getSetting(db, key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

export function setSetting(db, key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value);
}

export function ensureAdmin(db, { username, passwordHash }) {
  const row = db.prepare('SELECT id FROM users LIMIT 1').get();
  if (!row) {
    db.prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)').run(
      username,
      passwordHash,
      new Date().toISOString(),
    );
  }
}
