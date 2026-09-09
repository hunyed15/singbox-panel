/**
 * Xray 订阅:分享链接(base64)。
 * 与 sing-box 共用 buildShareLink（VLESS/VMess/Trojan/SS 链接格式一致）。
 */

import { decrypt } from './crypto.js';
import { buildShareLink } from './sub.js';

/** 查询启用 xray 节点,解密凭据 */
export function collectXrayNodes(db, appSecret) {
  const rows = db
    .prepare(
      `SELECT n.*, s.host, s.client_host, xs.reality_public_key, xs.short_id
       FROM xray_nodes n
       JOIN servers s ON s.id = n.server_id
       LEFT JOIN xray_server_settings xs ON xs.server_id = s.id
       WHERE n.enabled = 1
       ORDER BY n.id`,
    )
    .all();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    protocol: r.protocol,
    host: r.client_host || r.host,
    port: r.listen_port,
    sni: r.sni || r.host,
    ws_path: r.ws_path,
    realityPublicKey: r.reality_public_key,
    shortId: r.short_id,
    creds: JSON.parse(decrypt(appSecret, r.creds_enc)),
  }));
}

export function toXrayBase64(views) {
  const lines = views.map(buildShareLink).filter(Boolean);
  return Buffer.from(lines.join('\n'), 'utf8').toString('base64');
}