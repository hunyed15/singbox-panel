/**
 * 11 模板 → sing-box 入站生成(纯函数)。
 * 依据 docs/backend-design.md §5.1 与 sing-box 官方文档逐字段核对。
 */

function listenBase(node) {
  return { tag: `relay-in-${node.listen_port}`, listen: '::', listen_port: node.listen_port };
}

function tlsSelfSigned(machine) {
  return {
    enabled: true,
    server_name: machine.host,
    certificate_path: machine.certPath,
    key_path: machine.keyPath,
  };
}

export function buildInbound({ node, machine }) {
  const { protocol } = node;
  const listen = listenBase(node);
  switch (protocol) {
    case 'vless':
      return {
        type: 'vless',
        ...listen,
        // 实测:sing-box 1.12/1.13 的 flow=xtls-rprx-vision 与 reality 不兼容(vision 不认 reality 连接包装器),故不带 flow
        users: [{ uuid: node.creds.uuid }],
        tls: {
          enabled: true,
          server_name: node.sni,
          reality: {
            enabled: true,
            handshake: { server: node.sni, server_port: 443 }, // Dial Fields:server_port 而非 port
            private_key: machine.realityPrivateKey,
            short_id: [machine.shortId],
          },
        },
      };
    case 'vmess':
      return {
        type: 'vmess',
        ...listen,
        users: [{ uuid: node.creds.uuid, alterId: 0 }],
        transport: { type: 'ws', path: node.ws_path },
        tls: tlsSelfSigned(machine),
      };
    case 'trojan':
      return {
        type: 'trojan',
        ...listen,
        users: [{ password: node.creds.password }],
        tls: tlsSelfSigned(machine),
      };
    case 'shadowsocks':
      return {
        type: 'shadowsocks',
        ...listen,
        method: node.creds.method,
        password: node.creds.password,
      };
    case 'hysteria':
      return {
        type: 'hysteria2',
        ...listen,
        users: [{ password: node.creds.password }],
        tls: tlsSelfSigned(machine),
      };
    case 'socks':
      return node.creds.username
        ? { type: 'socks', ...listen, users: [{ username: node.creds.username, password: node.creds.password }] }
        : { type: 'socks', ...listen };
    case 'http':
      return node.creds.username
        ? { type: 'http', ...listen, users: [{ username: node.creds.username, password: node.creds.password }] }
        : { type: 'http', ...listen };
    case 'tunnel':
      return {
        type: 'direct',
        ...listen,
        network: 'tcp',
        override_address: node.tunnel_address,
        override_port: node.tunnel_port,
      };
    case 'tuic':
      return {
        type: 'tuic',
        ...listen,
        users: [{ uuid: node.creds.uuid, password: node.creds.password }],
        congestion_control: 'bbr',
        tls: tlsSelfSigned(machine),
      };
    case 'shadowtls':
      return {
        type: 'shadowtls',
        ...listen,
        version: 3,
        users: [{ password: node.creds.password }],
        handshake: { server: node.sni, server_port: 443 },
      };
    case 'naive':
      return {
        type: 'naive',
        ...listen,
        users: [{ username: node.creds.username, password: node.creds.password }],
        tls: tlsSelfSigned(machine),
      };
    default:
      throw new Error(`unknown protocol: ${protocol}`);
  }
}
