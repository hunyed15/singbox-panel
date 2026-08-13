import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRelayOutbound, buildRelayRule, buildLandingInbound } from '../src/sbconfig/relay.js';

const LANDING = {
  id: 3,
  host: '203.0.113.23',
  in_port: 32001,
  method: '2022-blake3-aes-128-gcm',
  password: 'landing-pw',
};

test('buildRelayOutbound: shadowsocks to landing, tagged per node', () => {
  const out = buildRelayOutbound({ nodeId: 7, landing: LANDING });
  assert.equal(out.type, 'shadowsocks');
  assert.equal(out.tag, 'landing-7');
  assert.equal(out.server, LANDING.host);
  assert.equal(out.server_port, LANDING.in_port);
  assert.equal(out.method, LANDING.method);
  assert.equal(out.password, LANDING.password);
});

test('buildRelayRule: inbound port -> landing tag', () => {
  const rule = buildRelayRule({ port: 31001, nodeId: 7 });
  assert.deepEqual(rule, { inbound: ['31001'], outbound: 'landing-7' });
});

test('buildLandingInbound: shared ss inbound', () => {
  const ib = buildLandingInbound({ landing: LANDING });
  assert.equal(ib.type, 'shadowsocks');
  assert.equal(ib.tag, 'landing-in-32001');
  assert.equal(ib.listen, '::');
  assert.equal(ib.listen_port, 32001);
  assert.equal(ib.method, '2022-blake3-aes-128-gcm');
  assert.equal(ib.password, 'landing-pw');
});
