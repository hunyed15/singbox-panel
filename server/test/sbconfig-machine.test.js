import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMachineConfig } from '../src/sbconfig/index.js';

const MACHINE = {
  id: 1,
  name: 'hk1',
  host: '203.0.113.11',
  role: 'relay',
  certPath: '/etc/sing-box/tls/hk1.crt',
  keyPath: '/etc/sing-box/tls/hk1.key',
  realityPrivateKey: 'priv',
  shortId: 'aabbccddeeff0011',
};

const LANDING_MAP = {
  3: { host: '203.0.113.23', in_port: 32001, method: '2022-blake3-aes-128-gcm', password: 'lpw' },
};

function node(over) {
  return {
    id: 1,
    name: 'n',
    listen_port: 31001,
    protocol: 'vless',
    enabled: 1,
    creds: { uuid: 'u1' },
    tls_mode: 'reality',
    sni: 'www.microsoft.com',
    transport: 'raw',
    ws_path: '',
    outbound_type: 'direct',
    landing_server_id: null,
    tunnel_address: '',
    tunnel_port: null,
    ...over,
  };
}

test('relay machine: node inbound + landing outbound + rule', () => {
  const cfg = buildMachineConfig({
    machine: MACHINE,
    relaySettings: { realityPrivateKey: 'priv', shortId: 'aabbccddeeff0011' },
    landingSettings: null,
    nodes: [
      node({ id: 7, listen_port: 31001, outbound_type: 'relay', landing_server_id: 3 }),
      node({ id: 8, listen_port: 31002, protocol: 'socks', outbound_type: 'direct', creds: {} }),
    ],
    landings: LANDING_MAP,
  });
  assert.equal(cfg.inbounds.length, 2);
  assert.equal(cfg.inbounds[0].listen_port, 31001);
  assert.equal(cfg.inbounds[1].listen_port, 31002);

  const tags = cfg.outbounds.map((o) => o.tag);
  assert.ok(tags.includes('direct'));
  const landingOut = cfg.outbounds.find((o) => o.tag === 'landing-7');
  assert.equal(landingOut.server, '203.0.113.23');
  assert.equal(landingOut.server_port, 32001);
  assert.equal(landingOut.password, 'lpw');

  assert.deepEqual(cfg.route.rules, [{ inbound: ['31001'], outbound: 'landing-7' }]);
  assert.equal(cfg.route.final, 'direct');
  assert.equal(cfg.log.level, 'info');
});

test('landing machine: shared ss inbound + direct node', () => {
  const cfg = buildMachineConfig({
    machine: { ...MACHINE, id: 3, role: 'landing' },
    relaySettings: null,
    landingSettings: { in_port: 32001, method: '2022-blake3-aes-128-gcm', password: 'lpw' },
    nodes: [node({ protocol: 'trojan', creds: { password: 'pw' } })],
    landings: {},
  });
  assert.equal(cfg.inbounds.length, 2);
  const ss = cfg.inbounds.find((i) => i.type === 'shadowsocks' && i.listen_port === 32001);
  assert.ok(ss, 'shared ss inbound present');
  assert.equal(ss.password, 'lpw');
  assert.equal(cfg.route.rules.length, 0);
  assert.equal(cfg.route.final, 'direct');
});

test('relay machine with no nodes: minimal valid config', () => {
  const cfg = buildMachineConfig({
    machine: MACHINE,
    relaySettings: { realityPrivateKey: 'priv', shortId: 'x' },
    landingSettings: null,
    nodes: [],
    landings: {},
  });
  assert.deepEqual(cfg.inbounds, []);
  assert.deepEqual(cfg.outbounds.map((o) => o.tag), ['direct']);
  assert.equal(cfg.route.final, 'direct');
});

test('tunnel node: direct inbound, no route rule', () => {
  const cfg = buildMachineConfig({
    machine: MACHINE,
    relaySettings: null,
    landingSettings: null,
    nodes: [
      node({
        protocol: 'tunnel',
        creds: {},
        tunnel_address: '2001:db8::24',
        tunnel_port: 8388,
      }),
    ],
    landings: {},
  });
  const tun = cfg.inbounds.find((i) => i.type === 'direct');
  assert.equal(tun.override_address, '2001:db8::24');
  assert.equal(cfg.route.rules.length, 0);
});
