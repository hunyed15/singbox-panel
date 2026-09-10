import { ApiError } from './errors.js';
import { buildConn } from './ssh.js';
import { buildXrayConfig } from './xrayconfig/index.js';
import { genSelfSignedCert } from './sbconfig/cert.js';
import { deployXrayMachine } from './deployXray.js';

/** 收集某机器 xray 节点所需数据(解密凭据) */
export function collectXrayMachineData(db, crypto, appSecret, machineId) {
  const row = db.prepare('SELECT * FROM servers WHERE id = ?').get(machineId);
  if (!row) throw new ApiError(404, '服务器不存在');

  // Xray Reality 密钥(懒生成)
  let xrayRelaySettings = db.prepare('SELECT * FROM xray_server_settings WHERE server_id = ?').get(machineId);
  if (!xrayRelaySettings) {
    const hasReality = db
      .prepare("SELECT COUNT(*) c FROM xray_nodes WHERE server_id = ? AND protocol = 'vless' AND enabled = 1")
      .get(machineId).c;
    if (hasReality > 0) {
      const { publicKey, privateKey } = crypto.genRealityKeypair();
      const shortId = crypto.genShortId();
      db.prepare(
        'INSERT OR REPLACE INTO xray_server_settings (server_id, reality_public_key, reality_private_key, short_id, port_base) VALUES (?,?,?,?,41000)',
      ).run(machineId, publicKey, crypto.encrypt(appSecret, privateKey), shortId);
      xrayRelaySettings = { reality_private_key: privateKey, short_id: shortId };
    }
  } else {
    // 已有记录:解密 private key
    if (xrayRelaySettings.reality_private_key) {
      xrayRelaySettings = {
        ...xrayRelaySettings,
        reality_private_key: crypto.decrypt(appSecret, xrayRelaySettings.reality_private_key),
      };
    }
  }

  const nodes = db
    .prepare('SELECT * FROM xray_nodes WHERE server_id = ?')
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
      flow: n.flow,
      outbound_type: n.outbound_type,
      landing_server_id: n.landing_server_id,
      tunnel_address: n.tunnel_address,
      tunnel_port: n.tunnel_port,
    }));

  const landings = {};
  const landingIds = [...new Set(nodes.map((n) => n.landing_server_id).filter(Boolean))];
  for (const id of landingIds) {
    const srv = db.prepare('SELECT host, client_host FROM servers WHERE id = ?').get(id);
    // 用 xray 专用落地端口(与 sing-box 分开,避免端口冲突)
    const xs = db.prepare('SELECT * FROM xray_server_settings WHERE server_id = ?').get(id);
    if (xs && xs.in_port && srv) {
      landings[id] = {
        host: srv.client_host || srv.host,
        in_port: xs.in_port,
        method: xs.in_method || 'aes-128-gcm',
        password: crypto.decrypt(appSecret, xs.in_password_enc),
      };
    }
  }

  // Xray 落地机设置（使用 xray_server_settings 中独立端口，与 sing-box 分开）
  let xrayLandingSettings = null;
  if (row.role === 'landing') {
    // 懒生成 xray 落地机 ss 入站设置
    const xs = db.prepare('SELECT * FROM xray_server_settings WHERE server_id = ?').get(machineId);
    const hasRelayRef = db
      .prepare("SELECT COUNT(*) c FROM xray_nodes WHERE landing_server_id = ? AND enabled = 1 AND outbound_type = 'relay'")
      .get(machineId).c > 0;
    if (hasRelayRef) {
      if (xs && xs.in_port) {
        xrayLandingSettings = {
          in_port: xs.in_port,
          method: xs.in_method || 'aes-128-gcm',
          password: crypto.decrypt(appSecret, xs.in_password_enc),
        };
      } else {
        // 首次:生成独立端口和密码
        const portBase = xs?.port_base || 41000;
        let port = portBase + machineId;
        const sbPort = db.prepare('SELECT in_port FROM landing_settings WHERE server_id = ?').get(machineId);
        if (sbPort && sbPort.in_port === port) port += 100;
        const password = crypto.genSsPassword();
        const enc = crypto.encrypt(appSecret, password);
        if (xs) {
          db.prepare('UPDATE xray_server_settings SET in_port=?, in_method=?, in_password_enc=? WHERE server_id=?')
            .run(port, 'aes-128-gcm', enc, machineId);
        } else {
          db.prepare(
            'INSERT OR REPLACE INTO xray_server_settings (server_id, reality_public_key, reality_private_key, short_id, port_base, in_port, in_method, in_password_enc) VALUES (?,?,?,?,?,?,?,?)',
          ).run(machineId, '', '', '', 41000, port, 'aes-128-gcm', enc);
        }
        xrayLandingSettings = { in_port: port, method: 'aes-128-gcm', password };
      }
    }
  }

  const machine = {
    id: row.id,
    name: row.name,
    host: row.client_host || row.host,
    role: row.role,
    certPath: `/etc/sing-box/tls/${row.name}.crt`,
    keyPath: `/etc/sing-box/tls/${row.name}.key`,
    realityPrivateKey: xrayRelaySettings?.reality_private_key,
    shortId: xrayRelaySettings?.short_id,
    xrayLandingSettings,
  };

  return { machine, nodes, landings };
}

/** 自签 TLS 证书(复用 sing-box 证书路径) */
async function ensureXrayCerts(ssh, conn, machine, nodes) {
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

/** 整机 xray 下发 */
export async function deployXrayServer(db, ssh, crypto, config, serverId) {
  const row = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId);
  if (!row) throw new ApiError(404, '服务器不存在');
  if (row.control !== 'ssh') {
    return { ok: false, error: 'agent 模式暂不支持下发' };
  }
  const hasXrayNodes = db
    .prepare('SELECT COUNT(*) c FROM xray_nodes WHERE server_id = ? AND enabled = 1')
    .get(serverId).c;
  const isLandingRef = db
    .prepare("SELECT COUNT(*) c FROM xray_nodes WHERE landing_server_id = ? AND enabled = 1 AND outbound_type = 'relay'")
    .get(serverId).c;
  if (hasXrayNodes === 0 && isLandingRef === 0) {
    return { ok: true, steps: ['skip'] };
  }

  const data = collectXrayMachineData(db, crypto, config.appSecret, serverId);
  const cfg = buildXrayConfig(data);
  const conn = buildConn(row, crypto.decrypt, config.appSecret);

  const steps = await ensureXrayCerts(ssh, conn, data.machine, data.nodes);
  const result = await deployXrayMachine(ssh, conn, cfg, {
    xrayBin: config.xrayBin,
    xrayConfig: config.xrayConfig,
    xrayUnit: config.xrayUnit,
  });
  if (result.ok) result.steps = [...steps, ...result.steps];
  return result;
}