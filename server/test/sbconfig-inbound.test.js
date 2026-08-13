import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInbound } from '../src/sbconfig/inbound.js';

const MACHINE = {
  host: '203.0.113.11',
  certPath: '/etc/sing-box/tls/hk1.crt',
  keyPath: '/etc/sing-box/tls/hk1.key',
  realityPrivateKey: 'priv-base64url-xxx',
  shortId: 'aabbccddeeff0011',
};

function node(over = {}) {
  return {
    listen_port: 31001,
    protocol: 'vless',
    creds: {},
    sni: 'www.microsoft.com',
    ws_path: '',
    tls_mode: 'none',
    tunnel_address: '',
    tunnel_port: null,
    ...over,
  };
}

test('vless-reality: users + reality borrow', () => {
  const ib = buildInbound({
    node: node({ creds: { uuid: 'u1', flow: 'xtls-rprx-vision' }, sni: 'www.apple.com' }),
    machine: MACHINE,
  });
  assert.equal(ib.type, 'vless');
  assert.equal(ib.listen, '::');
  assert.equal(ib.listen_port, 31001);
  assert.equal(ib.tag, 'relay-in-31001');
  assert.equal(ib.users[0].uuid, 'u1');
  assert.equal(ib.users[0].flow, 'xtls-rprx-vision');
  assert.equal(ib.tls.enabled, true);
  assert.equal(ib.tls.server_name, 'www.apple.com');
  assert.equal(ib.tls.reality.enabled, true);
  assert.deepEqual(ib.tls.reality.handshake, { server: 'www.apple.com', server_port: 443 });
  assert.equal(ib.tls.reality.private_key, MACHINE.realityPrivateKey);
  assert.deepEqual(ib.tls.reality.short_id, [MACHINE.shortId]);
});

test('vmess-ws-tls: ws transport + self-signed cert paths', () => {
  const ib = buildInbound({
    node: node({ protocol: 'vmess', creds: { uuid: 'u2' }, ws_path: '/ws-x1' }),
    machine: MACHINE,
  });
  assert.equal(ib.type, 'vmess');
  assert.equal(ib.users[0].uuid, 'u2');
  assert.deepEqual(ib.transport, { type: 'ws', path: '/ws-x1' });
  assert.equal(ib.tls.enabled, true);
  assert.equal(ib.tls.server_name, MACHINE.host);
  assert.equal(ib.tls.certificate_path, MACHINE.certPath);
  assert.equal(ib.tls.key_path, MACHINE.keyPath);
});

test('trojan-tls: password + cert paths', () => {
  const ib = buildInbound({
    node: node({ protocol: 'trojan', creds: { password: 'pw1' } }),
    machine: MACHINE,
  });
  assert.equal(ib.type, 'trojan');
  assert.equal(ib.users[0].password, 'pw1');
  assert.equal(ib.tls.certificate_path, MACHINE.certPath);
});

test('ss2022: method + password, no tls', () => {
  const ib = buildInbound({
    node: node({ protocol: 'shadowsocks', creds: { method: '2022-blake3-aes-128-gcm', password: 'sspw' } }),
    machine: MACHINE,
  });
  assert.equal(ib.type, 'shadowsocks');
  assert.equal(ib.method, '2022-blake3-aes-128-gcm');
  assert.equal(ib.password, 'sspw');
  assert.equal(ib.tls, undefined);
});

test('hysteria: sing-box type hysteria2 + cert', () => {
  const ib = buildInbound({
    node: node({ protocol: 'hysteria', creds: { password: 'hpw' } }),
    machine: MACHINE,
  });
  assert.equal(ib.type, 'hysteria2');
  assert.equal(ib.users[0].password, 'hpw');
  assert.equal(ib.tls.certificate_path, MACHINE.certPath);
});

test('socks / http: plain, no creds, no tls', () => {
  for (const protocol of ['socks', 'http']) {
    const ib = buildInbound({ node: node({ protocol }), machine: MACHINE });
    assert.equal(ib.type, protocol);
    assert.equal(ib.tls, undefined);
  }
});

test('tunnel: direct inbound with override target', () => {
  const ib = buildInbound({
    node: node({ protocol: 'tunnel', tunnel_address: '2001:db8::24', tunnel_port: 8388 }),
    machine: MACHINE,
  });
  assert.equal(ib.type, 'direct');
  assert.equal(ib.network, 'tcp');
  assert.equal(ib.override_address, '2001:db8::24');
  assert.equal(ib.override_port, 8388);
});

test('tuic: users uuid+password + bbr + cert', () => {
  const ib = buildInbound({
    node: node({ protocol: 'tuic', creds: { uuid: 'tu1', password: 'tpw' } }),
    machine: MACHINE,
  });
  assert.equal(ib.type, 'tuic');
  assert.equal(ib.users[0].uuid, 'tu1');
  assert.equal(ib.users[0].password, 'tpw');
  assert.equal(ib.congestion_control, 'bbr');
  assert.equal(ib.tls.certificate_path, MACHINE.certPath);
});

test('shadowtls: v3 users + handshake borrow', () => {
  const ib = buildInbound({
    node: node({ protocol: 'shadowtls', creds: { password: 'stpw' }, sni: 'www.google.com' }),
    machine: MACHINE,
  });
  assert.equal(ib.type, 'shadowtls');
  assert.equal(ib.version, 3);
  assert.equal(ib.users[0].password, 'stpw');
  assert.deepEqual(ib.handshake, { server: 'www.google.com', server_port: 443 });
});

test('naive: username+password + cert', () => {
  const ib = buildInbound({
    node: node({ protocol: 'naive', creds: { username: 'usr1', password: 'npw' } }),
    machine: MACHINE,
  });
  assert.equal(ib.type, 'naive');
  assert.deepEqual(ib.users[0], { username: 'usr1', password: 'npw' });
  assert.equal(ib.tls.certificate_path, MACHINE.certPath);
});

test('unknown protocol throws', () => {
  assert.throws(() => buildInbound({ node: node({ protocol: 'nope' }), machine: MACHINE }), /unknown/);
});
