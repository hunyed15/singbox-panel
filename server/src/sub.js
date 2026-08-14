/**
 * 订阅转换:分享链接(base64)+ sing-box JSON + UA/format 分派。
 * 内容 = 启用且非隧道节点。分享链接仅可出链接的协议;
 * 自签 TLS 出站 insecure:true。依据 backend-design.md §6。
 */

import { decrypt } from './crypto.js';

const SINGBOX_UA = /sing-box|singbox|\bSFI\b|\bSFA\b|\bSFM\b/i;

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const b64url = (s) =>
  Buffer.from(s, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

/** 查询启用且非隧道节点,解密凭据,join 服务器 host 与 relay_settings 的 Reality 公钥 */
export function collectNodes(db, appSecret) {
  const rows = db
    .prepare(
      `SELECT n.*, s.host, rs.reality_public_key, rs.short_id
       FROM nodes n
       JOIN servers s ON s.id = n.server_id
       LEFT JOIN relay_settings rs ON rs.server_id = s.id
       WHERE n.enabled = 1 AND n.protocol != 'tunnel'
       ORDER BY n.id`,
    )
    .all();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    protocol: r.protocol,
    host: r.host,
    port: r.listen_port,
    sni: r.sni || r.host,
    ws_path: r.ws_path,
    realityPublicKey: r.reality_public_key,
    shortId: r.short_id,
    creds: JSON.parse(decrypt(appSecret, r.creds_enc)),
  }));
}

export function pickFormat(query, ua) {
  if (query.format === 'base64' || query.format === 'singbox') return query.format;
  return SINGBOX_UA.test(ua || '') ? 'singbox' : 'base64';
}

export function buildShareLink(view) {
  const enc = encodeURIComponent(view.name);
  const { host, port, sni } = view;
  const c = view.creds;
  switch (view.protocol) {
    case 'vless':
      return (
        `vless://${c.uuid}@${host}:${port}?encryption=none&security=reality&sni=${sni}` +
        `&fp=chrome&pbk=${view.realityPublicKey}&sid=${view.shortId}&type=tcp#${enc}`
      );
    case 'vmess': {
      const vmess = {
        v: '2',
        ps: view.name,
        add: host,
        port,
        id: c.uuid,
        aid: '0',
        scy: 'auto',
        net: 'ws',
        type: 'none',
        host,
        path: view.ws_path,
        tls: 'tls',
        sni,
        allowInsecure: '1',
      };
      return `vmess://${b64url(JSON.stringify(vmess))}`;
    }
    case 'trojan':
      return `trojan://${c.password}@${host}:${port}?security=tls&sni=${sni}&allowInsecure=1#${enc}`;
    case 'shadowsocks':
      return `ss://${b64url(`${c.method}:${c.password}`)}@${host}:${port}#${enc}`;
    case 'hysteria':
      return `hysteria2://${c.password}@${host}:${port}?sni=${sni}&insecure=1#${enc}`;
    case 'tuic':
      return `tuic://${c.uuid}:${c.password}@${host}:${port}?congestion_control=bbr&sni=${sni}&allow_insecure=1#${enc}`;
    case 'socks':
    case 'http':
    case 'shadowtls':
    case 'naive':
    case 'tunnel':
      return null;
  }
}

export function toBase64(views) {
  const lines = views.map(buildShareLink).filter(Boolean);
  return Buffer.from(lines.join('\n'), 'utf8').toString('base64');
}

function tlsInsecure(serverName) {
  return { enabled: true, server_name: serverName, insecure: true };
}

function buildClientOutbound(view) {
  const { host, port, sni, ws_path } = view;
  const c = view.creds;
  const tag = view.name;
  switch (view.protocol) {
    case 'vless':
      return {
        type: 'vless',
        tag,
        server: host,
        server_port: port,
        uuid: c.uuid,
        // 不带 flow:实测 vision+reality 在此版本线不兼容
        tls: {
          enabled: true,
          server_name: sni,
          utls: { enabled: true, fingerprint: 'chrome' },
          reality: { enabled: true, public_key: view.realityPublicKey, short_id: view.shortId },
        },
      };
    case 'vmess':
      return {
        type: 'vmess',
        tag,
        server: host,
        server_port: port,
        uuid: c.uuid,
        tls: tlsInsecure(host),
        transport: { type: 'ws', path: ws_path },
      };
    case 'trojan':
      return {
        type: 'trojan',
        tag,
        server: host,
        server_port: port,
        password: c.password,
        tls: tlsInsecure(host),
      };
    case 'shadowsocks':
      return { type: 'shadowsocks', tag, server: host, server_port: port, method: c.method, password: c.password };
    case 'hysteria':
      return { type: 'hysteria2', tag, server: host, server_port: port, password: c.password, tls: tlsInsecure(host) };
    case 'tuic':
      return {
        type: 'tuic',
        tag,
        server: host,
        server_port: port,
        uuid: c.uuid,
        password: c.password,
        congestion_control: 'bbr',
        tls: tlsInsecure(host),
      };
    case 'shadowtls':
      return { type: 'shadowtls', tag, server: host, server_port: port, version: 3, password: c.password, tls: { enabled: true, server_name: sni } };
    case 'naive':
      return { type: 'naive', tag, server: host, server_port: port, username: c.username, password: c.password, tls: tlsInsecure(host) };
    case 'socks':
      return c.username
        ? { type: 'socks', tag, server: host, server_port: port, username: c.username, password: c.password }
        : { type: 'socks', tag, server: host, server_port: port };
    case 'http':
      return c.username
        ? { type: 'http', tag, server: host, server_port: port, username: c.username, password: c.password }
        : { type: 'http', tag, server: host, server_port: port };
    case 'tunnel':
      return null;
  }
}

export function toSingboxConfig(views) {
  const outbounds = views.map(buildClientOutbound).filter(Boolean);
  const selector = {
    type: 'selector',
    tag: 'auto',
    outbounds: outbounds.map((o) => o.tag),
  };
  return {
    log: { level: 'warn', timestamp: true },
    inbounds: [{ type: 'mixed', tag: 'mixed-in', listen: '127.0.0.1', listen_port: 2080 }],
    outbounds: [...outbounds, selector, { type: 'direct', tag: 'direct' }],
    route: { final: 'auto' },
  };
}
