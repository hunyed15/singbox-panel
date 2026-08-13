import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initDb } from '../src/db.js';
import { nextFreePort, assertPortFree } from '../src/ports.js';

test('nextFreePort: first free from base', () => {
  assert.equal(nextFreePort([], 31001), 31001);
  assert.equal(nextFreePort([31001, 31002], 31001), 31003);
  assert.equal(nextFreePort([], 21000), 21000);
  assert.equal(nextFreePort([21000, 21001, 21002], 21000), 21003);
});

test('assertPortFree: conflict throws 409, exclude self ok', () => {
  const db = initDb(':memory:');
  db.prepare(
    `INSERT INTO servers (name,role,host,ssh_user,ssh_auth_type,ssh_auth_secret) VALUES ('s1','relay','1.2.3.4','root','key','x')`,
  ).run();
  const sid = db.prepare(`SELECT id FROM servers WHERE name='s1'`).get().id;
  db.prepare(
    `INSERT INTO nodes (name,server_id,protocol,listen_port,creds_enc) VALUES ('a',?,'vless',31001,'{}')`,
  ).run(sid);
  const nodeId = db.prepare(`SELECT id FROM nodes WHERE name='a'`).get().id;

  assert.throws(
    () => assertPortFree(db, sid, 31001),
    (e) => e.status === 409,
  );
  // 编辑自身端口不变:排除自己 → 不冲突
  assert.doesNotThrow(() => assertPortFree(db, sid, 31001, nodeId));
  // 其他机器同端口不冲突
  assert.doesNotThrow(() => assertPortFree(db, sid + 1, 31001));
});
