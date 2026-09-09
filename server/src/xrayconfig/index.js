/**
 * Xray 整机配置装配。
 * 聚合该机 enabled xray 节点 → 入站; relay 节点 → shadowsocks 出站 + rule。
 * 纯函数:入参均为解密后的数据。
 */

import { buildXrayInbound, buildXrayLandingInbound } from './inbound.js';

/**
 * 构建 Xray shadowsocks 中转出站
 */
function buildXrayRelayOutbound({ nodeId, landing }) {
  return {
    protocol: 'shadowsocks',
    tag: `landing-${nodeId}`,
    settings: {
      servers: [
        {
          address: landing.host,
          port: landing.in_port,
          method: landing.method,
          password: landing.password,
        },
      ],
    },
  };
}

/**
 * 构建 Xray 路由规则（入站 tag → 出站 tag）
 */
function buildXrayRelayRule({ port, nodeId }) {
  return {
    type: 'field',
    inboundTag: [`relay-in-${port}`],
    outboundTag: `landing-${nodeId}`,
  };
}

/**
 * 整机配置装配
 */
export function buildXrayConfig({ machine, nodes, landings }) {
  const active = nodes.filter((n) => n.enabled === 1);

  const inbounds = active.map((n) => buildXrayInbound({ node: n, machine }));
  const outbounds = [{ protocol: 'freedom', tag: 'direct' }];
  const rules = [];

  for (const n of active) {
    if (n.outbound_type !== 'relay' || !n.landing_server_id) continue;
    const landing = landings[n.landing_server_id];
    if (!landing) {
      throw new Error(
        `node #${n.id} (${n.name}) 引用的落地机 #${n.landing_server_id} 不存在或缺少共享入站配置`,
      );
    }
    outbounds.push(buildXrayRelayOutbound({ nodeId: n.id, landing }));
    rules.push(buildXrayRelayRule({ port: n.listen_port, nodeId: n.id }));
  }

  if (machine.role === 'landing' && machine.xrayLandingSettings) {
    inbounds.push(buildXrayLandingInbound({ landing: machine.xrayLandingSettings }));
  }

  return {
    log: { loglevel: 'warning' },
    inbounds,
    outbounds,
    routing: { domainStrategy: 'AsIs', rules },
  };
}