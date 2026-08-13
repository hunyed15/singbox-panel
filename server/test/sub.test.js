import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initDb } from '../src/db.js';
import { encrypt } from '../src/crypto.js';
import { collectNodes, pickFormat, toBase64, toSingboxConfig } from '../src/sub.js';

const APP_SECRET = 'a'.repeat(32);
const enc = (s) => encrypt(APP_SECRET, s);

function makeViews() {
  const base = {
    id: 1,
    name: 'n',
    host: '203.0.113.11',
    port: 31001,
    sni: 'www.microsoft.com',
    ws_path: '/ws-a1',
    creds: {},
  };
  let n = 0;
  const v = (protocol, over = {}) => {
    n += 1;
    return { ...base, id: n, name: `n${n}`, protocol, creds: {}, ...over };
  };
  return [
    v('vless', { creds: { uuid: 'u1', flow: 'xtls-rprx-vision' }, realityPublicKey: 'pbk', shortId: 'abcd' }),
    v('vmess', { creds: { uuid: 'u2' }, ws_path: '/ws-a1' }),
    v('trojan', { creds: { password: 'tp' } }),
    v('shadowsocks', { creds: { method: '2022-blake3-aes-128-gcm', password: 'sp' } }),
    v('hysteria', { creds: { password: 'hp' } }),
    v('tuic', { creds: { uuid: 'tu1', password: 'tup' } }),
    v('socks'),
    v('http'),
    v('shadowtls', { creds: { password: 'stp' } }),
    v('naive', { creds: { username: 'usr', password: 'np' } }),
  ];
}

test('pickFormat: query wins, UA dispatch', () => {
  assert.equal(pickFormat({ format: 'base64' }, 'SingBox/1.2'), 'base64');
  assert.equal(pickFormat({ format: 'singbox' }, 'v2rayN'), 'singbox');
  assert.equal(pickFormat({}, 'SingBox/1.11.0 (Windows)'), 'singbox');
  assert.equal(pickFormat({}, 'SFI 1.10 / Android'), 'singbox');
  assert.equal(pickFormat({}, 'v2rayN/7.2.0'), 'base64');
  assert.equal(pickFormat({}, 'ClashForWindows/0.20'), 'base64');
});

test('toBase64: only link-capable protocols, correct prefixes', () => {
  const text = Buffer.from(toBase64(makeViews()), 'base64').toString('utf8');
  const lines = text.split('\n').filter(Boolean);
  assert.equal(lines.length, 6); // vless/vmess/trojan/ss/hysteria/tuic
  assert.ok(lines.some((l) => l.startsWith('vless://u1@203.0.113.11:31001?') && l.includes('security=reality') && l.includes('pbk=pbk') && l.includes('sid=abcd')));
  assert.ok(lines.some((l) => l.startsWith('vmess://')));
  assert.ok(lines.some((l) => l.startsWith('trojan://tp@') && l.includes('allowInsecure=1')));
  assert.ok(lines.some((l) => l.startsWith('ss://') && l.includes('@203.0.113.11:31001')));
  assert.ok(lines.some((l) => l.startsWith('hysteria2://hp@')));
  assert.ok(lines.some((l) => l.startsWith('tuic://tu1:tup@') && l.includes('congestion_control=bbr')));
});

test('toSingboxConfig: mixed in 2080 + all client outbounds + selector + direct', () => {
  const cfg = toSingboxConfig(makeViews());
  assert.equal(cfg.inbounds[0].type, 'mixed');
  assert.equal(cfg.inbounds[0].listen_port, 2080);
  const tags = cfg.outbounds.map((o) => o.tag);
  assert.equal(cfg.outbounds.length, 10 + 2); // 10 节点 + selector + direct
  assert.ok(tags.includes('n1') && tags.includes('n2'));
  const sel = cfg.outbounds.find((o) => o.type === 'selector');
  assert.deepEqual(sel.outbounds, tags.filter((t) => t !== 'auto' && t !== 'direct'));
  assert.equal(cfg.route.final, 'auto');
  // 自签 TLS 出站带 insecure
  const trojan = cfg.outbounds.find((o) => o.type === 'trojan');
  assert.equal(trojan.tls.insecure, true);
  // shadowtls 出站形态
  const st = cfg.outbounds.find((o) => o.type === 'shadowtls');
  assert.equal(st.version, 3);
  assert.equal(st.password, 'stp');
});

test('collectNodes: enabled non-tunnel only, decrypted creds + reality keys', () => {
  const db = initDb(':memory:');
  db.prepare(
    `INSERT INTO servers (name,role,host,ssh_user,ssh_auth_type,ssh_auth_secret) VALUES ('hk1','relay','203.0.113.11','root','key','x')`,
  ).run();
  const relayId = db.prepare(`SELECT id FROM servers WHERE name='hk1'`).get().id;
  db.prepare(
    `INSERT INTO relay_settings (server_id,reality_public_key,reality_private_key,short_id,port_base) VALUES (?, 'pbk','priv','abcd',31000)`,
  ).run(relayId);
  const insertNode = (name, protocol, port, enabled, creds, sni = '') =>
    db
      .prepare(
        `INSERT INTO nodes (name,server_id,protocol,listen_port,enabled,creds_enc,tls_mode,sni)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(name, relayId, protocol, port, enabled, enc(JSON.stringify(creds)), protocol === 'vless' ? 'reality' : 'none', sni);

  insertNode('v1', 'vless', 31001, 1, { uuid: 'u1', flow: 'xtls-rprx-vision' }, 'www.apple.com');
  insertNode('tun1', 'tunnel', 31002, 1, {}, '');
  insertNode('trojan-off', 'trojan', 31003, 0, { password: 'tp' });

  const views = collectNodes(db, APP_SECRET);
  assert.equal(views.length, 1);
  const v = views[0];
  assert.equal(v.name, 'v1');
  assert.equal(v.creds.uuid, 'u1');
  assert.equal(v.realityPublicKey, 'pbk');
  assert.equal(v.shortId, 'abcd');
  assert.equal(v.host, '203.0.113.11');
  assert.equal(v.sni, 'www.apple.com');
});
