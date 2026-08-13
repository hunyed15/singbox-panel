/**
 * 中转出站 + 路由规则 + 落地机共享 ss 入站(纯函数)。
 */

export function buildRelayOutbound({ nodeId, landing }) {
  return {
    type: 'shadowsocks',
    tag: `landing-${nodeId}`,
    server: landing.host,
    server_port: landing.in_port,
    method: landing.method,
    password: landing.password,
  };
}

export function buildRelayRule({ port, nodeId }) {
  return { inbound: [String(port)], outbound: `landing-${nodeId}` };
}

export function buildLandingInbound({ landing }) {
  return {
    type: 'shadowsocks',
    tag: `landing-in-${landing.in_port}`,
    listen: '::',
    listen_port: landing.in_port,
    method: landing.method,
    password: landing.password,
  };
}
