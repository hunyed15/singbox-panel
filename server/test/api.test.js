import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { initDb, ensureAdmin, setSetting } from '../src/db.js';
import { hashPassword, makeAuthRouter, requireAuth } from '../src/auth.js';
import { makeServersRouter } from '../src/routes/servers.js';
import { makeNodesRouter } from '../src/routes/nodes.js';
import { makeSnisRouter } from '../src/routes/snis.js';
import { makeSettingsRouter } from '../src/routes/settings.js';
import { makeSubRouter } from '../src/routes/sub.js';
import * as crypto from '../src/crypto.js';
import { ApiError } from '../src/errors.js';

const APP_SECRET = 'a'.repeat(32);
const JWT_SECRET = 'jwt-secret';

function fakeSsh() {
  const written = [];
  return {
    written,
    exec: async (conn, cmd) => {
      if (cmd.includes('sing-box version')) return { stdout: 'sing-box 1.11.4\n', stderr: '' };
      if (cmd.includes('is-active')) return { stdout: 'active\n', stderr: '' };
      if (cmd.includes('echo ok')) return { stdout: 'ok\n', stderr: '' };
      if (cmd.includes('uname -m')) return { stdout: 'x86_64\n', stderr: '' };
      return { stdout: '', stderr: '' };
    },
    writeFile: async (conn, path, content) => {
      written.push({ path, content: String(content) });
    },
    buildConn: (row) => ({ id: row.id }),
  };
}

async function makeApp(ssh = fakeSsh()) {
  const db = initDb(':memory:');
  ensureAdmin(db, { username: 'admin', passwordHash: await hashPassword('pw123') });
  const config = {
    appSecret: APP_SECRET,
    singboxBin: '/usr/local/bin/sing-box',
    singboxConfig: '/etc/sing-box/config.json',
    singboxUnit: 'sing-box',
    singboxDownloadBase: 'https://github.com/SagerNet/sing-box/releases/download',
    singboxVersion: '1.11.4',
    checkTimeoutMs: 15000,
    deployTimeoutMs: 60000,
  };
  const app = express();
  app.use(express.json());
  app.use('/api/auth', makeAuthRouter(db, JWT_SECRET));
  const auth = requireAuth(JWT_SECRET);
  app.use('/api/servers', auth, makeServersRouter({ db, crypto, appSecret: APP_SECRET, ssh, config }));
  app.use('/api/nodes', auth, makeNodesRouter({ db, crypto, appSecret: APP_SECRET, ssh, config }));
  app.use('/api/snis', auth, makeSnisRouter(db));
  app.use('/api/settings', auth, makeSettingsRouter(db, APP_SECRET));
  app.use('/sub', makeSubRouter(db, APP_SECRET));
  app.use('/api', (req, res) => res.status(404).json({ error: 'not found' }));
  app.use((err, req, res, next) => {
    if (err instanceof ApiError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'internal error' });
  });
  return { app, db };
}

async function login(app) {
  const res = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'pw123' });
  assert.equal(res.status, 200);
  return res.body.token;
}

test('full flow: servers -> nodes -> edit -> subscribe -> settings', async () => {
  const ssh = fakeSsh();
  const { app, db } = await makeApp(ssh);
  const token = await login(app);
  const authGet = (p) => request(app).get(p).set('Authorization', `Bearer ${token}`);
  const authPost = (p, body) => request(app).post(p).set('Authorization', `Bearer ${token}`).send(body);
  const authPut = (p, body) => request(app).put(p).set('Authorization', `Bearer ${token}`).send(body);
  const authDel = (p) => request(app).delete(p).set('Authorization', `Bearer ${token}`);

  // 建中转机 + 落地机(自动生成机器级凭据)
  const r1 = await authPost('/api/servers', { name: 'hk1', role: 'relay', control: 'ssh', region: 'HK', host: '203.0.113.11', sshAuthSecret: 'PRIV', sshSudo: true });
  assert.equal(r1.status, 200);
  const relayId = r1.body.id;
  assert.equal(r1.body.ssh_sudo, 1);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM relay_settings WHERE server_id=?').get(relayId).c, 1);

  const r2 = await authPost('/api/servers', { name: 'kr3', role: 'landing', control: 'ssh', region: 'KR', host: '203.0.113.23', sshAuthSecret: 'PRIV' });
  const landingId = r2.body.id;
  assert.equal(db.prepare('SELECT COUNT(*) c FROM landing_settings WHERE server_id=?').get(landingId).c, 1);

  // 建 VLESS+Reality(中转→kr3):端口自动、uuid 生成、share_link、deploy ok
  const n1 = await authPost('/api/nodes', { template: 'vless-reality', name: 'hk1 主力', serverId: relayId, outboundType: 'relay', landingServerId: landingId });
  assert.equal(n1.status, 200);
  assert.equal(n1.body.node.protocol, 'vless');
  const n1Port = n1.body.node.listen_port;
  assert.ok(n1Port >= 20000 && n1Port <= 65000, `端口应随机(20000-65000),实际 ${n1Port}`);
  assert.ok(n1.body.node.sni === 'www.microsoft.com');
  assert.ok(n1.body.node.share_link.startsWith('vless://'));
  assert.equal(n1.body.deploy.ok, true);
  // 中转节点:入口机配置含 vless 入站 + 落地机配置含共享 ss 入站(32000+landingId)
  const cfgs = ssh.written.filter((w) => w.path.includes('config.json')).map((w) => w.content);
  assert.ok(cfgs.some((c) => c.includes(`"listen_port": ${n1Port}`)), '入口机配置应含 vless 入站');
  assert.ok(cfgs.some((c) => c.includes('32002')), '落地机配置应含共享 ss 入站(32002)');
  const n1Id = n1.body.node.id;

  // 建 SOCKS 直连 + 隧道
  const n2 = await authPost('/api/nodes', { template: 'socks', name: 'socks', serverId: relayId, outboundType: 'direct' });
  assert.equal(n2.body.node.share_link, null);
  // socks 认证:只填用户不填密码 → 400
  const badAuth = await authPost('/api/nodes', { template: 'http', name: 'x', serverId: relayId, outboundType: 'direct', authUser: 'u' });
  assert.equal(badAuth.status, 400);
  // socks 带认证创建成功,配置含 users
  const nAuth = await authPost('/api/nodes', { template: 'socks', name: 'socks-auth', serverId: relayId, outboundType: 'direct', authUser: 'sb-user', authPassword: 'pw123' });
  assert.equal(nAuth.status, 200);
  assert.equal(nAuth.body.node.auth_user, 'sb-user'); // 编辑回显凭据
  assert.equal(nAuth.body.node.auth_password, 'pw123');
  const authCfg = ssh.written.find((w) => w.path.includes('config.json') && w.content.includes('sb-user'));
  assert.ok(authCfg, 'socks 认证应写入配置 users');
  assert.ok(authCfg.content.includes('pw123'));
  const n3 = await authPost('/api/nodes', { template: 'tunnel', name: 'v6隧道', serverId: relayId, outboundType: 'direct', tunnelAddress: '2001:db8::24', tunnelPort: 8388 });
  assert.equal(n3.body.node.tunnel_address, '2001:db8::24');

  // 端口冲突 → 409(用已存在节点的真实端口)
  const conflict = await authPost('/api/nodes', { template: 'http', name: 'x', serverId: relayId, outboundType: 'direct', port: n1Port });
  assert.equal(conflict.status, 409);

  // 编辑:改协议 → 凭据/分享链接变化
  const edit = await authPut(`/api/nodes/${n1Id}`, { name: 'hk1 主力2', protocol: 'trojan' });
  assert.equal(edit.status, 200);
  assert.equal(edit.body.node.protocol, 'trojan');
  assert.ok(edit.body.node.share_link.startsWith('trojan://'));
  assert.equal(edit.body.node.enabled, 1);

  // 启停
  const off = await authPut(`/api/nodes/${n1Id}`, { enabled: false });
  assert.equal(off.body.node.enabled, 0);

  // 订阅(UA 分派):v2rayN → base64;sing-box → json
  setSetting(db, 'sub_slug', 'myslug');
  const subB64off = await request(app).get('/sub/myslug').set('User-Agent', 'v2rayN/7.0');
  assert.ok(!Buffer.from(subB64off.text, 'base64').toString('utf8').includes('trojan://')); // 停用后从订阅剔除

  await authPut(`/api/nodes/${n1Id}`, { enabled: true });
  const subB64 = await request(app).get('/sub/myslug').set('User-Agent', 'v2rayN/7.0');
  assert.equal(subB64.status, 200);
  const decoded = Buffer.from(subB64.text, 'base64').toString('utf8');
  assert.ok(decoded.includes('trojan://')); // 启用节点有分享链接
  assert.ok(!decoded.includes('socks://')); // socks 无分享链接
  const subJson = await request(app).get('/sub/myslug').set('User-Agent', 'SingBox/1.11 (Android)');
  assert.equal(subJson.status, 200);
  assert.equal(subJson.headers['content-type'], 'application/json; charset=utf-8');
  assert.ok(subJson.body.outbounds.some((o) => o.type === 'socks'));
  assert.ok(!subJson.body.outbounds.some((o) => o.tag === 'v6隧道')); // 隧道不参与订阅

  // 被动检查
  const check = await authPost('/api/servers/check');
  assert.equal(check.status, 200);
  const hk1 = check.body.find((s) => s.id === relayId);
  assert.equal(hk1.ping_status, 'online');
  assert.equal(hk1.singbox_version, '1.11.4');

  // 服务器被节点引用 → 删除 409
  const del = await authDel(`/api/servers/${relayId}`);
  assert.equal(del.status, 409);

  // 删除节点后服务器可删
  await authDel(`/api/nodes/${n1Id}`);
  await authDel(`/api/nodes/${n2.body.node.id}`);
  await authDel(`/api/nodes/${n3.body.node.id}`);
  await authDel(`/api/nodes/${nAuth.body.node.id}`);
  const del2 = await authDel(`/api/servers/${relayId}`);
  assert.equal(del2.status, 200);
});

test('snis CRUD + settings slug + 401 guard', async () => {
  const { app, db } = await makeApp();
  const token = await login(app);
  const auth = (r) => r.set('Authorization', `Bearer ${token}`);

  // 未登录 401
  assert.equal((await request(app).get('/api/servers')).status, 401);

  // snis
  const add = await auth(request(app).post('/api/snis').send({ domain: 'cdn.example.com', note: '测试' }));
  assert.equal(add.status, 200);
  assert.equal(add.body.builtin, 0);
  const dup = await auth(request(app).post('/api/snis').send({ domain: 'cdn.example.com' }));
  assert.equal(dup.status, 409);
  const bad = await auth(request(app).post('/api/snis').send({ domain: 'not-a-domain' }));
  assert.equal(bad.status, 400);
  await auth(request(app).put(`/api/snis/${add.body.id}`).send({ note: '测试更新' }));
  assert.equal(db.prepare('SELECT note FROM sni_library WHERE id=?').get(add.body.id).note, '测试更新');
  await auth(request(app).delete(`/api/snis/${add.body.id}`));
  assert.equal(db.prepare('SELECT COUNT(*) c FROM sni_library WHERE id=?').get(add.body.id).c, 0);

  // settings:首次 GET 自动生成 slug;POST 重置
  const s1 = await auth(request(app).get('/api/settings'));
  assert.ok(s1.body.subSlug.length >= 6);
  assert.ok(s1.body.subUrl.startsWith('/sub/'));
  const s2 = await auth(request(app).post('/api/settings').send({ subSlug: 'new-slug_1' }));
  assert.equal(s2.body.subSlug, 'new-slug_1');
  assert.equal(db.prepare('SELECT value FROM settings WHERE key=?').get('sub_slug').value, 'new-slug_1');
  const badSlug = await auth(request(app).post('/api/settings').send({ subSlug: 'bad slug!' }));
  assert.equal(badSlug.status, 400);
});

test('sub with unknown slug → 404', async () => {
  const { app } = await makeApp();
  const res = await request(app).get('/sub/does-not-exist');
  assert.equal(res.status, 404);
});
