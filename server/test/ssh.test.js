import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildConn, testConnection } from '../src/ssh.js';

const SECRET = 'a'.repeat(32);

function row(over = {}) {
  return {
    host: '203.0.113.11',
    ssh_port: 2222,
    ssh_user: 'root',
    ssh_auth_type: 'key',
    ssh_auth_secret: 'encrypted-value',
    ...over,
  };
}

test('buildConn: key auth uses privateKey, decrypt applied', () => {
  const decrypt = (secret, tok) => `dec:${tok}`;
  const conn = buildConn(row(), decrypt, SECRET);
  assert.equal(conn.host, '203.0.113.11');
  assert.equal(conn.port, 2222);
  assert.equal(conn.username, 'root');
  assert.equal(conn.privateKey, 'dec:encrypted-value');
  assert.equal(conn.password, undefined);
});

test('buildConn: password auth uses password', () => {
  const decrypt = (secret, tok) => `pw:${tok}`;
  const conn = buildConn(row({ ssh_auth_type: 'password' }), decrypt, SECRET);
  assert.equal(conn.password, 'pw:encrypted-value');
  assert.equal(conn.privateKey, undefined);
});

test('buildConn: defaults port 22 / user root', () => {
  const conn = buildConn(row({ ssh_port: undefined, ssh_user: undefined }), (s, t) => t, SECRET);
  assert.equal(conn.port, 22);
  assert.equal(conn.username, 'root');
});

test('buildConn: sudo flag from ssh_sudo', () => {
  const sudo = buildConn(row({ ssh_sudo: 1 }), (s, t) => t, SECRET);
  assert.equal(sudo.sudo, true);
  const normal = buildConn(row({ ssh_sudo: 0 }), (s, t) => t, SECRET);
  assert.equal(normal.sudo, false);
});

test('testConnection: ok when echo returns ok', async () => {
  const exec = async () => ({ stdout: 'ok\n', stderr: '' });
  const res = await testConnection({}, exec);
  assert.equal(res.ok, true);
});

test('testConnection: failure surfaces message', async () => {
  const exec = async () => {
    throw new Error('connection refused');
  };
  const res = await testConnection({}, exec);
  assert.equal(res.ok, false);
  assert.match(res.message, /connection refused/);
});
