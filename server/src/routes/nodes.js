import express from 'express';
import { ApiError } from '../errors.js';
import { assertPortFree, nextFreePort } from '../ports.js';
import { TEMPLATE_META, PROTOCOL_DEFAULTS, genNodeCreds, nodeDefaults } from '../templates.js';
import { buildShareLink } from '../sub.js';
import { deployServer } from '../deployServices.js';

/** 构造 NodeItem(share_link 由后端构建,凭据不进响应) */
function nodeItem(row, serverName, landingName, view) {
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
    outbound_type: row.outbound_type,
    landing_server_id: row.landing_server_id ?? undefined,
    landing_name: landingName || undefined,
    tunnel_address: row.tunnel_address || undefined,
    tunnel_port: row.tunnel_port ?? undefined,
    share_link: view ? buildShareLink(view) : null,
    note: row.note,
    created_at: row.created_at,
  };
}

/** 构建分享链接所需的 view(含 Reality 公钥) */
function toView(db, crypto, appSecret, row) {
  const server = db.prepare('SELECT host FROM servers WHERE id = ?').get(row.server_id);
  if (!server) return null;
  const rs = db.prepare('SELECT reality_public_key, short_id FROM relay_settings WHERE server_id = ?').get(row.server_id);
  return {
    id: row.id,
    name: row.name,
    protocol: row.protocol,
    host: server.host,
    port: row.listen_port,
    sni: row.sni || server.host,
    ws_path: row.ws_path,
    realityPublicKey: rs?.reality_public_key,
    shortId: rs?.short_id,
    creds: JSON.parse(crypto.decrypt(appSecret, row.creds_enc)),
  };
}

function load(db, id) {
  const row = db.prepare('SELECT * FROM nodes WHERE id = ?').get(id);
  if (!row) throw new ApiError(404, '节点不存在');
  return row;
}

export function makeNodesRouter({ db, crypto, appSecret, ssh, config }) {
  const router = express.Router();

  const SELECT_JOIN = `SELECT n.*, s.name AS server_name, g.name AS landing_name
    FROM nodes n
    JOIN servers s ON s.id = n.server_id
    LEFT JOIN servers g ON g.id = n.landing_server_id`;
  const listQuery = `${SELECT_JOIN} ORDER BY n.id`;

  router.get('/', (req, res) => {
    const rows = db.prepare(listQuery).all();
    res.json(rows.map((r) => nodeItem(r, r.server_name, r.landing_name, toView(db, crypto, appSecret, r))));
  });

  router.post('/', async (req, res) => {
    const b = req.body || {};
    const { template, name, serverId, outboundType = 'direct' } = b;
    if (!name || !serverId) throw new ApiError(400, 'name/serverId 必填');
    const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId);
    if (!server) throw new ApiError(400, '入口机不存在');
    const meta = TEMPLATE_META[template];
    if (!meta) throw new ApiError(400, '未知模板');

    let landingId = null;
    if (outboundType === 'relay') {
      const landing = db.prepare('SELECT id, role FROM servers WHERE id = ?').get(b.landingServerId);
      if (!landing || landing.role !== 'landing') throw new ApiError(400, '中转出口需要选择落地机');
      landingId = landing.id;
    }

    // 端口:手动或自动
    const used = db
      .prepare('SELECT listen_port FROM nodes WHERE server_id = ?')
      .all(serverId)
      .map((r) => r.listen_port);
    const rs = db.prepare('SELECT port_base FROM relay_settings WHERE server_id = ?').get(serverId);
    const base = (rs && rs.port_base) || 31000;
    const port = b.port ? Number(b.port) : nextFreePort(used, base + 1);
    if (b.port) assertPortFree(db, serverId, port);

    const creds = genNodeCreds(meta.protocol);
    const { sni, wsPath } = nodeDefaults(meta.protocol, server.host, b.sni);

    let tunnelAddress = '';
    let tunnelPort = null;
    if (meta.protocol === 'tunnel') {
      if (!b.tunnelAddress || !b.tunnelPort) throw new ApiError(400, '隧道节点需要填写转发目标地址与端口');
      tunnelAddress = String(b.tunnelAddress).trim();
      tunnelPort = Number(b.tunnelPort);
    }

    const info = db
      .prepare(
        `INSERT INTO nodes (name, server_id, protocol, listen_port, enabled, creds_enc, tls_mode, sni, transport, ws_path, outbound_type, landing_server_id, tunnel_address, tunnel_port, note, created_at)
         VALUES (?,?,?,?,1,?,?,?,?,?,?,?,?,?,?,?)`,
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
        outboundType,
        landingId,
        tunnelAddress,
        tunnelPort,
        '',
        new Date().toISOString(),
      );
    const id = info.lastInsertRowid;

    const deploy = await deployServer(db, ssh, crypto, config, serverId);
    const row = db.prepare(`${SELECT_JOIN} WHERE n.id = ?`).get(id);
    res.json({ node: nodeItem(row, row.server_name, row.landing_name, toView(db, crypto, appSecret, row)), deploy });
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

    if (b.protocol && b.protocol !== row.protocol) {
      protocol = b.protocol;
      creds = genNodeCreds(protocol);
      const defs = PROTOCOL_DEFAULTS[protocol];
      tlsMode = defs.tlsMode;
      transport = defs.transport;
      const defaults = nodeDefaults(protocol, server.host, b.sni);
      sni = defaults.sni;
      wsPath = defaults.wsPath;
    } else if (b.sni !== undefined && (protocol === 'vless' || protocol === 'shadowtls')) {
      sni = b.sni.trim() || sni;
    }

    const outboundType = b.outboundType ?? row.outbound_type;
    let landingId = row.landing_server_id;
    if (b.outboundType === 'direct') landingId = null;
    if (b.landingServerId !== undefined) {
      if (outboundType === 'direct') throw new ApiError(400, '直连节点无需落地机');
      const landing = db.prepare('SELECT id, role FROM servers WHERE id = ?').get(b.landingServerId);
      if (!landing || landing.role !== 'landing') throw new ApiError(400, '落地机非法');
      landingId = landing.id;
    }

    const port = b.port !== undefined ? Number(b.port) : row.listen_port;
    if (b.port !== undefined) assertPortFree(db, row.server_id, port, id);

    const tunnelAddress = b.tunnelAddress !== undefined ? String(b.tunnelAddress).trim() : row.tunnel_address;
    const tunnelPort = b.tunnelPort !== undefined ? Number(b.tunnelPort) : row.tunnel_port;

    db.prepare(
      `UPDATE nodes SET name=?, protocol=?, listen_port=?, enabled=?, creds_enc=?, tls_mode=?, sni=?, transport=?, ws_path=?, outbound_type=?, landing_server_id=?, tunnel_address=?, tunnel_port=?, note=?
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
      outboundType,
      landingId,
      tunnelAddress,
      tunnelPort,
      b.note ?? row.note,
      id,
    );

    const deploy = await deployServer(db, ssh, crypto, config, row.server_id);
    const updated = db.prepare(`${SELECT_JOIN} WHERE n.id = ?`).get(id);
    res.json({ node: nodeItem(updated, updated.server_name, updated.landing_name, toView(db, crypto, appSecret, updated)), deploy });
  });

  router.delete('/:id', async (req, res) => {
    const id = Number(req.params.id);
    const row = load(db, id);
    db.prepare('DELETE FROM nodes WHERE id = ?').run(id);
    const deploy = await deployServer(db, ssh, crypto, config, row.server_id);
    res.json({ ok: true, deploy });
  });

  return router;
}
