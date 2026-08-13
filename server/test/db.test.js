import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initDb, getSetting, setSetting, ensureAdmin } from '../src/db.js';

const TABLES = [
  'landing_settings',
  'nodes',
  'relay_settings',
  'servers',
  'settings',
  'sni_library',
  'users',
];

test('initDb creates all tables', () => {
  const db = initDb(':memory:');
  const names = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((r) => r.name)
    .sort();
  assert.deepEqual(names, [...TABLES].sort());
});

test('settings round-trip', () => {
  const db = initDb(':memory:');
  setSetting(db, 'sub_slug', 'abc123');
  assert.equal(getSetting(db, 'sub_slug'), 'abc123');
  assert.equal(getSetting(db, 'missing'), null);
});

test('ensureAdmin seeds only when users empty', () => {
  const db = initDb(':memory:');
  ensureAdmin(db, { username: 'admin', passwordHash: 'h1' });
  ensureAdmin(db, { username: 'other', passwordHash: 'h2' });
  const rows = db.prepare('SELECT username FROM users').all();
  assert.deepEqual(rows, [{ username: 'admin' }]);
});

test('FK cascade: delete server removes nodes + machine settings', () => {
  const db = initDb(':memory:');
  db.prepare(
    `INSERT INTO servers (name,role,host,ssh_user,ssh_auth_type,ssh_auth_secret) VALUES ('s1','relay','1.2.3.4','root','key','x')`,
  ).run();
  const sid = db.prepare(`SELECT id FROM servers WHERE name='s1'`).get().id;
  db.prepare(
    `INSERT INTO relay_settings (server_id,reality_public_key,reality_private_key,short_id,port_base) VALUES (?, 'pub','priv','abcd',31000)`,
  ).run(sid);
  db.prepare(
    `INSERT INTO nodes (name,server_id,protocol,listen_port,creds_enc) VALUES ('n1',?,'vless',31001,'{}')`,
  ).run(sid);
  db.prepare('DELETE FROM servers WHERE id=?').run(sid);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM relay_settings').get().c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM nodes').get().c, 0);
});

test('nodes UNIQUE(server_id, listen_port) enforced', () => {
  const db = initDb(':memory:');
  db.prepare(
    `INSERT INTO servers (name,role,host,ssh_user,ssh_auth_type,ssh_auth_secret) VALUES ('s1','relay','1.2.3.4','root','key','x')`,
  ).run();
  const sid = db.prepare(`SELECT id FROM servers WHERE name='s1'`).get().id;
  db.prepare(
    `INSERT INTO nodes (name,server_id,protocol,listen_port,creds_enc) VALUES ('a',?,'vless',31001,'{}')`,
  ).run(sid);
  assert.throws(() =>
    db
      .prepare(
        `INSERT INTO nodes (name,server_id,protocol,listen_port,creds_enc) VALUES ('b',?,'vmess',31001,'{}')`,
      )
      .run(sid),
  );
});
