import { buildInbound } from './inbound.js';
import { buildRelayOutbound, buildRelayRule, buildLandingInbound } from './relay.js';

/**
 * 整机配置装配(拉直原则):聚合该机 enabled 节点 → 入站;relay 节点 → ss 出站 + rule;
 * role=landing → 追加共享 ss 入站;final=direct。
 * 纯函数:入参均为解密后的数据。
 */
export function buildMachineConfig({ machine, relaySettings, landingSettings, nodes, landings }) {
  const active = nodes.filter((n) => n.enabled === 1);

  const inbounds = active.map((n) => buildInbound({ node: n, machine }));
  const outbounds = [{ type: 'direct', tag: 'direct' }];
  const rules = [];

  for (const n of active) {
    if (n.outbound_type !== 'relay' || !n.landing_server_id) continue;
    const landing = landings[n.landing_server_id];
    if (!landing) continue;
    outbounds.push(buildRelayOutbound({ nodeId: n.id, landing }));
    rules.push(buildRelayRule({ port: n.listen_port, nodeId: n.id }));
  }

  if (machine.role === 'landing' && landingSettings) {
    inbounds.push(buildLandingInbound({ landing: landingSettings }));
  }

  return {
    log: { level: 'info', timestamp: true },
    inbounds,
    outbounds,
    route: { rules, final: 'direct' },
  };
}
