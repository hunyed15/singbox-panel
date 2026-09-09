import express from 'express';
import { ApiError } from '../errors.js';
import { assertPortFree, randomFreePort } from '../ports.js';
import { XRAY_TEMPLATE_META, XRAY_PROTOCOL_DEFAULTS, genXrayNodeCreds, xrayNodeDefaults } from '../xrayconfig/templates.js';
import { buildShareLink } from '../sub.js';
import { deployXrayServer } from '../deployXrayServices.js';

/** 下发该节点涉及的机器 */
async function deployAffectedMachines(db, ssh, crypto, config, serverId) {
  const result = await deployXrayServer(db, ssh, crypto, config, serverId);
  return result;
}

/** 构造 xray 节点响应 */
function nodeItem(row, serverName) {
  return {
    id: row.id,
    name: row.name,
    server_id: row.server_id,
    server_name: serverName,
    protocol: row.protocol,
    listen_port: row.listen_port,
    enabled: row.enabled,
    tls_mode: row.tls_mode,
    transport: row.transport,
    sni: row.sni || undefined,
    ws_path: row.ws_path || undefined,
    flow: row.flow || undefined,
    outbound_type: row.outbound_type,
    landing_server_id: row.landing_server_id ?? undefined,
    tunnel_address: row.tunnel_address || undefined,
    tunnel_port: row.tunnel_port ?? undefined,
    share_link: null,
    note: row.note,
    created_at: row.created_at,
  };
}

/** 构建分享链接所需的 view */
function toView(db, crypto, appSecret, row) {
  const server = db.prepare('SELECT host, client_host FROM servers WHERE id = ?').get(row.server_id);
  if (!server) return null;
  const xrs = db.prepare('SELECT reality_public_key, short_id FROM xray_server_settings WHERE server_id = ?').get(row.server_id);
  return {
    id: row.id,
    name: row.name,
    protocol: row.protocol,
    host: server.client_host || server.host,
    port: row.listen_port,
    sni: row.sni || server.host,
    ws_path: row.ws_path,
    realityPublicKey: xrs?.reality_public_key,
    shortId: xrs?.short_id,
    creds: JSON.parse(crypto.decrypt(appSecret, row.creds_enc)),
  };
}

function load(db, id) {
  const row = db.prepare('SELECT * FROM xray_nodes WHERE id = ?').get(id);
  if (!row) throw new ApiError(404, 'Xray 节点不存在');
  return row;
}

export function makeXrayNodesRouter({ db, crypto, appSecret, ssh, config }) {
  const router = express.Router();

  const SELECT_JOIN = `SELECT n.*, s.name AS server_name
    FROM xray_nodes n
    JOIN servers s ON s.id = n.server_id`;
  const listQuery = `${SELECT_JOIN} ORDER BY n.id`;

  router.get('/', (req, res) => {
    const rows = db.prepare(listQuery).all();
    res.json(rows.map((r) => {
      const n = nodeItem(r, r.server_name);
      const view = toView(db, crypto, appSecret, r);
      n.share_link = view ? buildShareLink(view) : null;
      return n;
    }));
  });

  router.post('/', async (req, res) => {
    const b = req.body || {};
    const { template, name, serverId } = b;
    if (!name || !serverId) throw new ApiError(400, 'name/serverId 必填');
    const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId);
    if (!server) throw new ApiError(400, '入口机不存在');
    const meta = XRAY_TEMPLATE_META[template];
    if (!meta) throw new ApiError(400, '未知模板');

    // 端口分配
    const used = db
      .prepare('SELECT listen_port FROM xray_nodes WHERE server_id = ?')
      .all(serverId)
      .map((r) => r.listen_port);
    // 也排除 sing-box 节点端口避免冲突
    const sbUsed = db
      .prepare('SELECT listen_port FROM nodes WHERE server_id = ?')
      .all(serverId)
      .map((r) => r.listen_port);
    const allUsed = [...used, ...sbUsed];
    const port = b.port ? Number(b.port) : randomFreePort(allUsed);
    if (b.port) assertPortFree(db, serverId, port);

    const flow = meta.protocol === 'vless' ? (b.flow || 'xtls-rprx-vision') : '';
    const creds = genXrayNodeCreds(meta.protocol, flow);
    const { sni, wsPath } = xrayNodeDefaults(meta.protocol, server.client_host || server.host, b.sni);

    const info = db
      .prepare(
        `INSERT INTO xray_nodes (name, server_id, protocol, listen_port, enabled, creds_enc, tls_mode, sni, transport, ws_path, flow, outbound_type, note, created_at)
         VALUES (?,?,?,?,1,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        name,
        serverId,
        meta.protocol,
        port,
        crypto.encrypt(appSecret, JSON.stringify(creds)),
        meta.tlsMode,
        sni,
        meta.transport,
        wsPath,
        flow,
        'direct',
        '',
        new Date().toISOString(),
      );
    const id = info.lastInsertRowid;

    const deploy = await deployAffectedMachines(db, ssh, crypto, config, serverId);
    const row = db.prepare(`${SELECT_JOIN} WHERE n.id = ?`).get(id);
    const n = nodeItem(row, row.server_name);
    n.share_link = buildShareLink(toView(db, crypto, appSecret, row));
    res.json({ node: n, deploy });
  });

  router.put('/:id', async (req, res) => {
    const id = Number(req.params.id);
    const row = load(db, id);
    const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(row.server_id);
    const b = req.body || {};

    let protocol = row.protocol;
    let creds = JSON.parse(crypto.decrypt(appSecret, row.creds_enc));
    let tlsMode = row.tls_mode;
    let transport = row.transport;
    let wsPath = row.ws_path;
    let sni = row.sni;
    let flow = row.flow;

    if (b.protocol && b.protocol !== row.protocol) {
      protocol = b.protocol;
      flow = protocol === 'vless' ? (b.flow || 'xtls-rprx-vision') : '';
      creds = genXrayNodeCreds(protocol, flow);
      const defs = XRAY_PROTOCOL_DEFAULTS[protocol];
      tlsMode = defs.tlsMode;
      transport = defs.transport;
      const defaults = xrayNodeDefaults(protocol, server.client_host || server.host, b.sni);
      sni = defaults.sni;
      wsPath = defaults.wsPath;
    } else if (b.sni !== undefined && protocol === 'vless') {
      sni = b.sni.trim() || sni;
    }

    const port = b.port !== undefined ? Number(b.port) : row.listen_port;
    if (b.port !== undefined) assertPortFree(db, row.server_id, port, id);

    db.prepare(
      `UPDATE xray_nodes SET name=?, protocol=?, listen_port=?, enabled=?, creds_enc=?, tls_mode=?, sni=?, transport=?, ws_path=?, flow=?, note=?
       WHERE id=?`,
    ).run(
      b.name ?? row.name,
      protocol,
      port,
      b.enabled !== undefined ? (b.enabled ? 1 : 0) : row.enabled,
      crypto.encrypt(appSecret, JSON.stringify(creds)),
      tlsMode,
      sni,
      transport,
      wsPath,
      flow,
      b.note ?? row.note,
      id,
    );

    const deploy = await deployAffectedMachines(db, ssh, crypto, config, row.server_id);
    const updated = db.prepare(`${SELECT_JOIN} WHERE n.id = ?`).get(id);
    const n = nodeItem(updated, updated.server_name);
    n.share_link = buildShareLink(toView(db, crypto, appSecret, updated));
    res.json({ node: n, deploy });
  });

  router.delete('/:id', async (req, res) => {
    const id = Number(req.params.id);
    const row = load(db, id);
    db.prepare('DELETE FROM xray_nodes WHERE id = ?').run(id);
    const deploy = await deployAffectedMachines(db, ssh, crypto, config, row.server_id);
    res.json({ ok: true, deploy });
  });

  return router;
}