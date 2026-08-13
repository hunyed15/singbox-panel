import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initDb } from '../src/db.js';
import { encrypt, decrypt } from '../src/crypto.js';
import { parseVersion, checkAllServers } from '../src/probe.js';
import { buildConn as realBuildConn } from '../src/ssh.js';

test('parseVersion extracts bare version', () => {
  assert.equal(parseVersion('sing-box 1.11.0'), '1.11.0');
  assert.equal(parseVersion('sing-box version 1.11.0 Beta'), '1.11.0 Beta');
  assert.equal(parseVersion(''), '');
});

function makeDb() {
  const db = initDb(':memory:');
  const insert = (name, control = 'ssh') =>
    db
      .prepare(
        `INSERT INTO servers (name,role,host,ssh_user,ssh_auth_type,ssh_auth_secret,control)
         VALUES (?,?,?,?,?,?,?)`,
      )
      .run(name, 'relay', '203.0.113.11', 'root', 'key', 'enc', control);
  insert('s1');
  insert('s2');
  insert('s3');
  return db;
}

test('checkAllServers: online/inactive/offline classification + version + last_seen', async () => {
  const db = makeDb();
  const ssh = {
    exec: async (conn, cmd) => {
      if (conn.id === 2) return { stdout: 'sing-box 1.11.3\n', stderr: '' };
      if (cmd.includes('is-active')) return { stdout: 'active\n', stderr: '' };
      return { stdout: 'sing-box 1.11.4\n', stderr: '' };
    },
    buildConn: (row) => ({ id: row.id }),
  };
  // s2: is-active → 'inactive'
  const orig = ssh.exec;
  ssh.exec = async (conn, cmd) => {
    if (conn.id === 2 && cmd.includes('is-active')) return { stdout: 'inactive\n', stderr: '' };
    if (conn.id === 3) throw new Error('ssh down');
    return orig(conn, cmd);
  };

  const list = await checkAllServers(db, ssh, { decrypt: () => "secret" }, {
    singboxBin: 'sing-box',
    singboxUnit: 'sing-box',
  });
  const byName = Object.fromEntries(list.map((s) => [s.name, s]));
  assert.equal(byName.s1.ping_status, 'online');
  assert.equal(byName.s1.singbox_version, '1.11.4');
  assert.equal(byName.s2.ping_status, 'inactive');
  assert.equal(byName.s2.singbox_version, '1.11.3');
  assert.equal(byName.s3.ping_status, 'offline');
  assert.equal(byName.s3.singbox_version, '');
  for (const s of list) assert.ok(s.last_seen, 'last_seen set');
});

test('reachable but service not running -> inactive (not offline), version empty', async () => {
  const db = makeDb();
  const ssh = {
    buildConn: (row) => ({ id: row.id }),
    exec: async (conn, cmd) => {
      // 模拟:二进制缺失(version 空)+ is-active 非 active(命令以 || echo inactive 结尾,退出码 0)
      if (cmd.includes('version')) return { stdout: '', stderr: '' };
      return { stdout: 'inactive\n', stderr: '' };
    },
  };
  const list = await checkAllServers(db, ssh, { decrypt: () => "secret" }, {
    singboxBin: 'sing-box',
    singboxUnit: 'sing-box',
  });
  const s1 = list.find((s) => s.name === 's1');
  assert.equal(s1.ping_status, 'inactive');
  assert.equal(s1.singbox_version, '');
});

test('checkAllServers: buildConn throws (bad creds/agent) -> offline, no 500', async () => {
  const db = makeDb();
  // 补一台 agent 模式(空凭据)服务器
  db.prepare(
    `INSERT INTO servers (name,role,host,ssh_user,ssh_auth_type,ssh_auth_secret,control) VALUES ('sx','relay','203.0.113.99','root','key','','agent')`,
  ).run();
  const ssh = {
    buildConn: (row) => {
      if (row.control === 'agent' || !row.ssh_auth_secret) {
        throw new Error('decrypt failed: empty secret');
      }
      return { id: row.id };
    },
    exec: async (conn, cmd) =>
      cmd.includes('is-active')
        ? { stdout: 'active\n', stderr: '' }
        : { stdout: 'sing-box 1.13.18\n', stderr: '' },
  };
  // 必须 resolve(不抛),agent 那台标记 offline
  const list = await checkAllServers(db, ssh, { decrypt: () => "secret" }, {
    singboxBin: 'sing-box',
    singboxUnit: 'sing-box',
  });
  const sx = list.find((s) => s.name === 'sx');
  assert.equal(sx.ping_status, 'offline');
  assert.equal(sx.singbox_version, '');
  const s1 = list.find((s) => s.name === 's1');
  assert.equal(s1.ping_status, 'online');
  assert.equal(s1.singbox_version, '1.13.18');
});

test('integration: real buildConn (3-arg) + decrypted creds works (regression: decrypt is not a function)', async () => {
  const db = initDb(':memory:');
  const secret = 'a'.repeat(32);
  db.prepare(
    `INSERT INTO servers (name,role,host,ssh_user,ssh_auth_type,ssh_auth_secret)
     VALUES ('s1','relay','203.0.113.11','root','password',?)`,
  ).run(encrypt(secret, 'pw'));
  const ssh = {
    buildConn: (row, dec, appSecret) => realBuildConn(row, dec, appSecret),
    exec: async (conn, cmd) =>
      cmd.includes('is-active')
        ? { stdout: 'active\n', stderr: '' }
        : { stdout: 'sing-box 1.13.18\n', stderr: '' },
  };
  const list = await checkAllServers(db, ssh, { decrypt }, {
    singboxBin: 'sing-box',
    singboxUnit: 'sing-box',
    appSecret: secret,
  });
  const s1 = list.find((s) => s.name === 's1');
  assert.equal(s1.ping_status, 'online');
  assert.equal(s1.singbox_version, '1.13.18');
});

test('concurrency is bounded (max 3 parallel)', async () => {
  const db = makeDb();
  let inflight = 0;
  let max = 0;
  const ssh = {
    exec: async (conn) => {
      inflight += 1;
      max = Math.max(max, inflight);
      await new Promise((r) => setTimeout(r, 20));
      inflight -= 1;
      return { stdout: 'sing-box 1.11.4\n', stderr: '' };
    },
    buildConn: (row) => ({ id: row.id }),
  };
  // 加 3 台机凑 6 台,验证并发上限仍 ≤3
  db.prepare(
    `INSERT INTO servers (name,role,host,ssh_user,ssh_auth_type,ssh_auth_secret) VALUES ('s4','relay','h','root','key','e')`,
  ).run();
  db.prepare(
    `INSERT INTO servers (name,role,host,ssh_user,ssh_auth_type,ssh_auth_secret) VALUES ('s5','relay','h','root','key','e')`,
  ).run();
  db.prepare(
    `INSERT INTO servers (name,role,host,ssh_user,ssh_auth_type,ssh_auth_secret) VALUES ('s6','relay','h','root','key','e')`,
  ).run();
  await checkAllServers(db, ssh, { decrypt: () => "secret" }, { singboxBin: 'sing-box', singboxUnit: 'sing-box' });
  assert.ok(max <= 3, `max concurrent = ${max}`);
});
