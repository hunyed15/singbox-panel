/**
 * Xray inbound 生成器（纯函数）。
 * 与 sing-box 入站生成器对应，但输出 Xray JSON 格式。
 */

/**
 * 自签 TLS 证书配置(与 sing-box 共用证书文件)
 */
function tlsSettings(machine) {
  return {
    certificates: [
      {
        certificateFile: machine.certPath,
        keyFile: machine.keyPath,
      },
    ],
  };
}

/**
 * 构建 xray inbound 入站配置
 */
export function buildXrayInbound({ node, machine }) {
  const { protocol } = node;
  const base = { tag: `relay-in-${node.listen_port}`, port: node.listen_port, listen: '0.0.0.0' };

  switch (protocol) {
    case 'vless':
      return {
        ...base,
        protocol: 'vless',
        settings: {
          clients: [{ id: node.creds.uuid, flow: node.flow || 'xtls-rprx-vision', encryption: 'none' }],
          decryption: 'none',
        },
        streamSettings: {
          network: 'tcp',
          security: 'reality',
          realitySettings: {
            dest: `${node.sni}:443`,
            serverNames: [node.sni],
            privateKey: machine.realityPrivateKey,
            shortIds: [machine.shortId],
            xver: 0,
          },
        },
        sniffing: { enabled: true, destOverride: ['http', 'tls'] },
      };

    case 'vmess':
      return {
        ...base,
        protocol: 'vmess',
        settings: {
          clients: [{ id: node.creds.uuid, alterId: 0 }],
        },
        streamSettings: {
          network: 'ws',
          wsSettings: { path: node.ws_path || '/' },
          security: 'tls',
          tlsSettings: tlsSettings(machine),
        },
        sniffing: { enabled: true, destOverride: ['http', 'tls'] },
      };

    case 'trojan':
      return {
        ...base,
        protocol: 'trojan',
        settings: {
          clients: [{ password: node.creds.password }],
        },
        streamSettings: {
          network: 'tcp',
          security: 'tls',
          tlsSettings: tlsSettings(machine),
        },
        sniffing: { enabled: true, destOverride: ['http', 'tls'] },
      };

    case 'shadowsocks':
      return {
        ...base,
        protocol: 'shadowsocks',
        settings: {
          method: node.creds.method,
          password: node.creds.password,
        },
      };

    case 'socks':
      return node.creds.username
        ? {
            ...base,
            protocol: 'socks',
            settings: {
              auth: 'password',
              accounts: [{ user: node.creds.username, pass: node.creds.password }],
              udp: true,
            },
          }
        : {
            ...base,
            protocol: 'socks',
            settings: { auth: 'noauth', udp: true },
          };

    case 'http':
      return node.creds.username
        ? {
            ...base,
            protocol: 'http',
            settings: {
              accounts: [{ user: node.creds.username, pass: node.creds.password }],
            },
          }
        : {
            ...base,
            protocol: 'http',
            settings: {},
          };

    default:
      throw new Error(`unknown xray protocol: ${protocol}`);
  }
}

/**
 * Xray 落地机共享 shadowsocks 入站（用于中转链路）
 */
export function buildXrayLandingInbound({ landing }) {
  return {
    tag: `landing-in-${landing.in_port}`,
    port: landing.in_port,
    listen: '0.0.0.0',
    protocol: 'shadowsocks',
    settings: {
      method: landing.method,
      password: landing.password,
    },
  };
}