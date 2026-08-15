import { ApiError } from './errors.js';
import { buildConn } from './ssh.js';
import { buildMachineConfig } from './sbconfig/index.js';
import { genSelfSignedCert } from './sbconfig/cert.js';
import { deployMachine } from './deploy.js';

/** 收集某机器整机配置所需数据(解密凭据) */
export function collectMachineData(db, crypto, appSecret, machineId) {
  const row = db.prepare('SELECT * FROM servers WHERE id = ?').get(machineId);
  if (!row) throw new ApiError(404, '服务器不存在');

  let relaySettings = null;
  let landingSettings = null;
  if (row.role === 'relay') {
    const rs = db.prepare('SELECT * FROM relay_settings WHERE server_id = ?').get(machineId);
    if (rs) {
      relaySettings = {
        realityPrivateKey: crypto.decrypt(appSecret, rs.reality_private_key),
        shortId: rs.short_id,
      };
    }
  } else if (row.role === 'landing') {
    const ls = db.prepare('SELECT * FROM landing_settings WHERE server_id = ?').get(machineId);
    if (ls) {
      landingSettings = {
        in_port: ls.in_port,
        method: ls.method,
        password: crypto.decrypt(appSecret, ls.password),
      };
    }
  }

  // 落地机等也可能直连 vless-reality 节点 → 懒生成 Reality 密钥并持久化(此前只有 relay 机有)
  if (!relaySettings) {
    const hasReality = db
      .prepare("SELECT COUNT(*) c FROM nodes WHERE server_id = ? AND protocol = 'vless' AND enabled = 1")
      .get(machineId).c;
    if (hasReality > 0) {
      const { publicKey, privateKey } = crypto.genRealityKeypair();
      const shortId = crypto.genShortId();
      db.prepare(
        'INSERT OR REPLACE INTO relay_settings (server_id, reality_public_key, reality_private_key, short_id, port_base) VALUES (?,?,?,?,31000)',
      ).run(machineId, publicKey, crypto.encrypt(appSecret, privateKey), shortId);
      relaySettings = { realityPrivateKey: privateKey, shortId };
    }
  }

  const nodes = db
    .prepare('SELECT * FROM nodes WHERE server_id = ?')
    .all(machineId)
    .map((n) => ({
      id: n.id,
      name: n.name,
      listen_port: n.listen_port,
      protocol: n.protocol,
      enabled: n.enabled,
      creds: JSON.parse(crypto.decrypt(appSecret, n.creds_enc)),
      tls_mode: n.tls_mode,
      sni: n.sni,
      transport: n.transport,
      ws_path: n.ws_path,
      outbound_type: n.outbound_type,
      landing_server_id: n.landing_server_id,
      tunnel_address: n.tunnel_address,
      tunnel_port: n.tunnel_port,
    }));

  const landings = {};
  const landingIds = [...new Set(nodes.map((n) => n.landing_server_id).filter(Boolean))];
  for (const id of landingIds) {
    const ls = db.prepare('SELECT * FROM landing_settings WHERE server_id = ?').get(id);
    const srv = db.prepare('SELECT host, client_host FROM servers WHERE id = ?').get(id);
    if (ls && srv) {
      landings[id] = {
        host: srv.client_host || srv.host,
        in_port: ls.in_port,
        method: ls.method,
        password: crypto.decrypt(appSecret, ls.password),
      };
    }
  }

  const machine = {
    id: row.id,
    name: row.name,
    host: row.client_host || row.host,
    role: row.role,
    certPath: `/etc/sing-box/tls/${row.name}.crt`,
    keyPath: `/etc/sing-box/tls/${row.name}.key`,
    realityPrivateKey: relaySettings?.realityPrivateKey,
    shortId: relaySettings?.shortId,
  };

  return { machine, relaySettings, landingSettings, nodes, landings };
}

/** 自签 TLS 证书:有 tls 节点时生成并写入机器;返回步骤 */
async function ensureCerts(ssh, conn, machine, nodes) {
  if (!nodes.some((n) => n.tls_mode === 'tls')) return [];
  const { certPem, keyPem } = genSelfSignedCert({
    commonName: machine.name,
    altNames: [machine.name, machine.host],
  });
  await ssh.exec(conn, 'mkdir -p /etc/sing-box/tls');
  await ssh.writeFile(conn, machine.certPath, certPem);
  await ssh.writeFile(conn, machine.keyPath, keyPem);
  return ['cert'];
}

/** 整机下发:收集 → 生成 → 证书 → deployMachine(含回滚) */
export async function deployServer(db, ssh, crypto, config, serverId) {
  const row = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId);
  if (!row) throw new ApiError(404, '服务器不存在');
  if (row.control !== 'ssh') {
    // V1 仅 SSH;agent 模式机器不参与下发
    return { ok: false, error: 'agent 模式暂不支持下发(V1 仅 SSH)' };
  }
  const data = collectMachineData(db, crypto, config.appSecret, serverId);
  const cfg = buildMachineConfig(data);
  const conn = buildConn(row, crypto.decrypt, config.appSecret);

  const steps = await ensureCerts(ssh, conn, data.machine, data.nodes);
  const result = await deployMachine(ssh, conn, cfg, {
    singboxBin: config.singboxBin,
    singboxConfig: config.singboxConfig,
    singboxUnit: config.singboxUnit,
  });
  if (result.ok) result.steps = [...steps, ...result.steps];
  return result;
}
