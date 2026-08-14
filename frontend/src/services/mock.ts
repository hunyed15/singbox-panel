import { ApiError } from './errors';
import type {
  ApiModule,
  ControlResult,
  DeployResult,
  InstallScriptResult,
  LoginResult,
  NodeCreateInput,
  NodeItem,
  NodePatch,
  NodeProtocol,
  NodeTemplate,
  Server,
  ServerInput,
  Settings,
  SniItem,
  TestResult,
} from './types';

/**
 * Mock 实现:与真实 HTTP 实现同契约(联调只换 services/index.ts 的选择)。
 * 数据为 PRD 规划的 6 台机器 + 跨协议示例节点,非装饰性假数据。
 * 分享链接与 sing-box 订阅内容为「客户端形态」的近似实现(真实构建在后端)。
 */

const LATENCY_MS = 300;
const delay = (ms: number = LATENCY_MS) => new Promise((resolve) => setTimeout(resolve, ms));

const iso = (minutesAgo: number): string =>
  new Date(Date.now() - minutesAgo * 60_000).toISOString();

// ---- 随机凭据生成(mock 用;生产由后端 crypto 生成) ----
const randBytes = (n: number): Uint8Array => {
  const arr = new Uint8Array(n);
  crypto.getRandomValues(arr);
  return arr;
};
const toBase64 = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes));
const bytesToBase64Url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const toBase64Url = (s: string): string =>
  btoa(String.fromCharCode(...new TextEncoder().encode(s)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const randHex = (n: number): string =>
  Array.from(randBytes(n), (b) => b.toString(16).padStart(2, '0')).join('');
const randPassword = (): string => toBase64(randBytes(16));
const uuid = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });

interface MockCreds {
  uuid?: string;
  flow?: string;
  username?: string;
  password?: string;
  method?: string;
  sni?: string;
  wsPath?: string;
  publicKey?: string;
  shortId?: string;
}

// ---- Reality 域名库(内置大厂域名,可编辑可删除) ----
const SNI_SEED: Array<[string, string]> = [
  ['www.microsoft.com', '微软官网'],
  ['www.apple.com', 'Apple 官网'],
  ['dl.google.com', 'Google 下载'],
  ['www.cloudflare.com', 'Cloudflare'],
  ['gateway.icloud.com', 'iCloud'],
  ['www.bing.com', 'Bing'],
  ['www.amazon.com', 'Amazon'],
  ['www.yahoo.com', 'Yahoo'],
];
let snis: SniItem[] = SNI_SEED.map(([domain, note], i) => ({
  id: i + 1,
  domain,
  note,
  builtin: true,
}));
let nextSniId = 100;

const DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

let servers: Server[] = [
  {
    id: 1,
    name: 'HK1',
    role: 'relay',
    control: 'agent',
    host: '203.0.113.11',
    ssh_port: 22,
    ssh_user: 'root',
    ssh_auth_type: 'key',
    region: 'HK',
    ping_status: 'online',
    singbox_version: '1.11.4',
    last_seen: iso(1),
    agent: { token: 'tok-hk1-4f7a', agent_version: '1.0.0', last_heartbeat: iso(1) },
  },
  {
    id: 2,
    name: 'HK2',
    role: 'relay',
    control: 'ssh',
    host: '203.0.113.12',
    ssh_port: 22,
    ssh_user: 'root',
    ssh_auth_type: 'key',
    region: 'HK',
    ping_status: 'online',
    singbox_version: '1.11.4',
    last_seen: iso(1),
  },
  {
    id: 3,
    name: 'KR3',
    role: 'landing',
    control: 'ssh',
    host: '203.0.113.23',
    ssh_port: 22,
    ssh_user: 'root',
    ssh_auth_type: 'key',
    region: 'KR',
    ping_status: 'online',
    singbox_version: '1.11.3',
    last_seen: iso(2),
  },
  {
    id: 4,
    name: 'KR4',
    role: 'landing',
    control: 'agent',
    host: '203.0.113.24',
    ssh_port: 22,
    ssh_user: 'root',
    ssh_auth_type: 'key',
    region: 'KR',
    ping_status: 'inactive',
    singbox_version: '',
    last_seen: iso(30),
    agent: { token: 'tok-kr4-9b2c', agent_version: '1.0.0', last_heartbeat: iso(30) },
  },
  {
    id: 5,
    name: 'JP5',
    role: 'landing',
    control: 'ssh',
    host: '203.0.113.35',
    ssh_port: 22,
    ssh_user: 'root',
    ssh_auth_type: 'password',
    region: 'JP',
    ping_status: 'offline',
    singbox_version: '',
    last_seen: iso(300),
  },
  {
    id: 6,
    name: 'US6',
    role: 'landing',
    control: 'ssh',
    host: '203.0.113.46',
    ssh_port: 22,
    ssh_user: 'root',
    ssh_auth_type: 'key',
    region: 'US',
    ping_status: 'unknown',
    singbox_version: '',
    last_seen: null,
  },
];

const credsById = new Map<number, MockCreds>();

function makeCreds(protocol: NodeProtocol, server: Server, sniOverride?: string): MockCreds {
  const creds: MockCreds = { sni: 'www.microsoft.com' };
  if (protocol === 'vless') {
    creds.uuid = uuid();
    creds.flow = 'xtls-rprx-vision';
    creds.publicKey = bytesToBase64Url(randBytes(32));
    creds.shortId = randHex(8);
    creds.sni = sniOverride?.trim() || 'www.microsoft.com';
  } else if (protocol === 'vmess') {
    creds.uuid = uuid();
    creds.wsPath = `/ws-${randHex(4)}`;
    creds.sni = server.host;
  } else if (protocol === 'trojan') {
    creds.password = randPassword();
    creds.sni = server.host;
  } else if (protocol === 'shadowsocks') {
    creds.method = '2022-blake3-aes-128-gcm';
    creds.password = randPassword();
  } else if (protocol === 'hysteria') {
    creds.password = randPassword();
    creds.sni = server.host;
  } else if (protocol === 'tuic') {
    creds.uuid = uuid();
    creds.password = randPassword();
    creds.sni = server.host;
  } else if (protocol === 'shadowtls') {
    creds.password = randPassword();
    creds.sni = 'www.google.com';
  } else if (protocol === 'naive') {
    creds.username = randHex(4);
    creds.password = randPassword();
    creds.sni = server.host;
  }
  return creds;
}

const PROTOCOL_DEFAULTS: Record<
  NodeProtocol,
  { tlsMode: NodeItem['tls_mode']; transport: NodeItem['transport'] }
> = {
  vless: { tlsMode: 'reality', transport: 'raw' },
  vmess: { tlsMode: 'tls', transport: 'ws' },
  trojan: { tlsMode: 'tls', transport: 'raw' },
  shadowsocks: { tlsMode: 'none', transport: 'raw' },
  hysteria: { tlsMode: 'tls', transport: 'raw' },
  socks: { tlsMode: 'none', transport: 'raw' },
  http: { tlsMode: 'none', transport: 'raw' },
  tunnel: { tlsMode: 'none', transport: 'raw' },
  tuic: { tlsMode: 'tls', transport: 'raw' },
  shadowtls: { tlsMode: 'shadowtls', transport: 'raw' },
  naive: { tlsMode: 'tls', transport: 'raw' },
};

const nodeSeed = (
  id: number,
  name: string,
  serverId: number,
  protocol: NodeProtocol,
  listenPort: number,
  enabled: 0 | 1,
  tlsMode: NodeItem['tls_mode'],
  transport: NodeItem['transport'],
  outboundType: NodeItem['outbound_type'],
  landingId: number | undefined,
  note: string,
  minutesAgo: number,
  tunnelAddress?: string,
  tunnelPort?: number,
): NodeItem => {
  const server = servers.find((s) => s.id === serverId)!;
  const creds = makeCreds(protocol, server);
  credsById.set(id, creds);
  const landing = landingId ? servers.find((s) => s.id === landingId) : undefined;
  return {
    id,
    name,
    server_id: serverId,
    server_name: server.name,
    protocol,
    listen_port: listenPort,
    enabled,
    tls_mode: tlsMode,
    transport,
    sni: creds.sni,
    outbound_type: outboundType,
    landing_server_id: landingId,
    landing_name: landing?.name,
    tunnel_address: tunnelAddress,
    tunnel_port: tunnelPort,
    share_link: buildShareLink(name, server, listenPort, protocol, creds),
    note,
    created_at: iso(minutesAgo),
  };
};

let nodes: NodeItem[] = [
  nodeSeed(1, 'HK1 主力', 1, 'vless', 31001, 1, 'reality', 'raw', 'relay', 3, '主用链路', 60 * 24 * 2),
  nodeSeed(2, 'HK2 兼容', 2, 'vmess', 21001, 1, 'tls', 'ws', 'direct', undefined, '', 60 * 24),
  nodeSeed(3, 'KR3 直连', 3, 'trojan', 44001, 1, 'tls', 'raw', 'direct', undefined, '', 60 * 20),
  nodeSeed(4, 'HK2 极简', 2, 'shadowsocks', 8388, 1, 'none', 'raw', 'direct', undefined, '', 60 * 6),
  nodeSeed(5, 'HK1 高速', 1, 'hysteria', 36712, 1, 'tls', 'raw', 'relay', 4, 'UDP', 60 * 3),
  nodeSeed(6, 'HK2 SOCKS', 2, 'socks', 1080, 1, 'none', 'raw', 'direct', undefined, '', 60 * 2),
  nodeSeed(7, 'KR3 HTTP', 3, 'http', 8080, 0, 'none', 'raw', 'direct', undefined, '停用示例', 60),
  nodeSeed(8, 'HK1 IPv6 隧道', 1, 'tunnel', 32001, 1, 'none', 'raw', 'direct', undefined, '转发到 KR4 IPv6', 60, '2001:db8::24', 8388),
];

let subSlug = 'singbox';
let nextServerId = 100;
let nextNodeId = 100;

const okDeploy = (): DeployResult => ({
  ok: true,
  steps: ['生成配置', '下发', 'sing-box reload'],
});

function findServer(id: number): Server {
  const row = servers.find((s) => s.id === id);
  if (!row) throw new ApiError(404, '服务器不存在');
  return row;
}

function nextFreePort(serverId: number): number {
  const base = 21000 + serverId * 100;
  const used = nodes.filter((n) => n.server_id === serverId).map((n) => n.listen_port);
  let port = base;
  while (used.includes(port)) port += 1;
  return port;
}

// ---- 分享链接构建(客户端形态近似;真实构建在后端 share 模块) ----
function buildShareLink(
  name: string,
  server: Server,
  port: number,
  protocol: NodeProtocol,
  creds: MockCreds,
): string | null {
  const enc = encodeURIComponent(name);
  const host = server.host;
  switch (protocol) {
    case 'vless':
      return (
        `vless://${creds.uuid}@${host}:${port}?encryption=none&security=reality` +
        `&sni=${creds.sni}&fp=chrome&pbk=${creds.publicKey}&sid=${creds.shortId}` +
        `&type=tcp#${enc}`
      );
    case 'vmess': {
      const vmess = {
        v: '2',
        ps: name,
        add: host,
        port,
        id: creds.uuid,
        aid: '0',
        scy: 'auto',
        net: 'ws',
        type: 'none',
        host,
        path: creds.wsPath,
        tls: 'tls',
        sni: creds.sni,
        allowInsecure: '1',
      };
      return `vmess://${toBase64Url(JSON.stringify(vmess))}`;
    }
    case 'trojan':
      return `trojan://${creds.password}@${host}:${port}?security=tls&sni=${creds.sni}&allowInsecure=1#${enc}`;
    case 'shadowsocks':
      return `ss://${toBase64Url(`${creds.method}:${creds.password}`)}@${host}:${port}#${enc}`;
    case 'hysteria':
      return `hysteria2://${creds.password}@${host}:${port}?sni=${creds.sni}&insecure=1#${enc}`;
    case 'tuic':
      return `tuic://${creds.uuid}:${creds.password}@${host}:${port}?congestion_control=bbr&sni=${creds.sni}&allow_insecure=1#${enc}`;
    case 'shadowtls':
    case 'naive':
    case 'socks':
    case 'http':
    case 'tunnel':
      return null; // 无标准分享链接(ShadowTLS/Naive 走 sing-box JSON 订阅;SOCKS/HTTP 亦同;隧道不参与订阅)
  }
}

// ---- 认证 ----
export const login = async (
  username: string,
  password: string,
): Promise<LoginResult> => {
  await delay(500);
  if (!username.trim() || !password.trim()) {
    throw new ApiError(401, '用户名或密码错误');
  }
  return { token: `mock-token-${username}-${Date.now()}`, username };
};

// ---- 服务器 ----
export const getServers = async (): Promise<Server[]> => {
  await delay();
  return servers;
};

export const createServer = async (payload: ServerInput): Promise<Server> => {
  await delay();
  const { name, role, control, region } = payload;
  if (!name || !['relay', 'landing'].includes(role)) {
    throw new ApiError(400, 'name/role 必填');
  }
  if (control === 'ssh' && (!payload.host || !payload.sshAuthSecret)) {
    throw new ApiError(400, 'SSH 模式需要主机地址与认证凭据');
  }
  const id = nextServerId++;
  const row: Server = {
    id,
    name,
    role,
    control,
    host: payload.host ?? '',
    ssh_port: payload.sshPort ?? 22,
    ssh_user: payload.sshUser ?? 'root',
    ssh_auth_type: payload.sshAuthType ?? 'key',
    region,
    ping_status: 'unknown',
    singbox_version: '',
    last_seen: null,
    agent:
      control === 'agent'
        ? { token: `tok-${name.toLowerCase()}-${randHex(4)}`, agent_version: '', last_heartbeat: null }
        : undefined,
  };
  servers = [...servers, row];
  return row;
};

export const updateServer = async (
  id: number,
  payload: Partial<ServerInput>,
): Promise<Server> => {
  await delay();
  const row = findServer(id);
  const next: Server = {
    ...row,
    name: payload.name ?? row.name,
    role: payload.role ?? row.role,
    control: payload.control ?? row.control,
    region: payload.region ?? row.region,
    host: payload.host ?? row.host,
    ssh_port: payload.sshPort ?? row.ssh_port,
    ssh_user: payload.sshUser ?? row.ssh_user,
    ssh_auth_type: payload.sshAuthType ?? row.ssh_auth_type,
  };
  servers = servers.map((s) => (s.id === id ? next : s));
  return next;
};

export const deleteServer = async (id: number): Promise<{ ok: true }> => {
  await delay();
  const used = nodes.some((n) => n.server_id === id || n.landing_server_id === id);
  if (used) {
    throw new ApiError(409, '该服务器正被节点引用,请先删除相关节点');
  }
  servers = servers.filter((s) => s.id !== id);
  return { ok: true };
};

export const checkServers = async (): Promise<Server[]> => {
  await delay(1200);
  servers = servers.map((s) => ({
    ...s,
    // 被动检查:离线保持离线(可真实复现),其余按在线处理
    ping_status: s.ping_status === 'offline' ? 'offline' : 'online',
    singbox_version: s.singbox_version || '1.11.4',
    last_seen: iso(0),
  }));
  return servers;
};

export const testServer = async (id: number): Promise<TestResult> => {
  await delay(900);
  const row = findServer(id);
  if (row.control === 'agent') {
    return { ok: false, message: 'agent 模式无需 SSH 测试,状态来自心跳' };
  }
  return { ok: true, message: 'SSH 连接与命令执行正常' };
};

const controlStep = (server: Server, action: string): ControlResult => {
  if (server.control === 'agent') {
    return { ok: true, steps: [`已下发任务给 agent(${server.agent?.token ?? ''})`, action, '等待回报'] };
  }
  return { ok: true, steps: ['SSH 连接', action, '完成'] };
};

export const installServer = async (id: number): Promise<ControlResult> => {
  await delay(1200);
  const row = findServer(id);
  servers = servers.map((s) =>
    s.id === id ? { ...s, singbox_version: '1.11.4', ping_status: 'online', last_seen: iso(0) } : s,
  );
  return controlStep(row, '安装 sing-box 1.11.4');
};

export const restartServer = async (id: number): Promise<ControlResult> => {
  await delay(800);
  const row = findServer(id);
  servers = servers.map((s) =>
    s.id === id ? { ...s, ping_status: 'online', last_seen: iso(0) } : s,
  );
  return controlStep(row, '重启 sing-box');
};

export const uninstallServer = async (id: number): Promise<ControlResult> => {
  await delay(1200);
  const row = findServer(id);
  servers = servers.map((s) =>
    s.id === id ? { ...s, singbox_version: '', ping_status: 'inactive', last_seen: iso(0) } : s,
  );
  return controlStep(row, '卸载 sing-box');
};

export const getInstallScript = async (id: number): Promise<InstallScriptResult> => {
  await delay();
  const row = findServer(id);
  if (row.control !== 'agent' || !row.agent) {
    throw new ApiError(400, '仅 agent 模式服务器可生成安装脚本');
  }
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://panel:8081';
  const script = `#!/usr/bin/env bash
# SingBox 面板 agent 安装脚本 — 服务器「${row.name}」
# 在目标机器上以 root 执行,完成后将自动注册到面板并上线
set -euo pipefail
PANEL_URL="${origin}"
TOKEN="${row.agent.token}"
echo "==> 1/3 下载 agent"
curl -fsSL -o /usr/local/bin/sb-agent "\${PANEL_URL}/agent/install.sh" || true
echo "==> 2/3 注册到面板"
curl -fsSL -X POST "\${PANEL_URL}/api/agent/register" \\
  -H "Content-Type: application/json" \\
  -d "{\\"token\\":\\"\${TOKEN}\\",\\"host\\":\\"$(hostname -I | awk '{print $1}')\\"}"
echo "==> 3/3 安装 sing-box(面板后续可执行 安装/重启/卸载)"
curl -fsSL -X POST "\${PANEL_URL}/api/agent/tasks" -H "Content-Type: application/json" -d '{}' >/dev/null || true
echo "完成。机器已注册,可在面板查看状态。"`;
  return { script };
};

// ---- 节点 ----
export const getNodes = async (): Promise<NodeItem[]> => {
  await delay();
  return nodes;
};

const TEMPLATE_META: Record<
  NodeTemplate,
  { protocol: NodeProtocol; tlsMode: NodeItem['tls_mode']; transport: NodeItem['transport'] }
> = {
  'vless-reality': { protocol: 'vless', tlsMode: 'reality', transport: 'raw' },
  'vmess-ws-tls': { protocol: 'vmess', tlsMode: 'tls', transport: 'ws' },
  'trojan-tls': { protocol: 'trojan', tlsMode: 'tls', transport: 'raw' },
  ss2022: { protocol: 'shadowsocks', tlsMode: 'none', transport: 'raw' },
  hysteria: { protocol: 'hysteria', tlsMode: 'tls', transport: 'raw' },
  socks: { protocol: 'socks', tlsMode: 'none', transport: 'raw' },
  http: { protocol: 'http', tlsMode: 'none', transport: 'raw' },
  tunnel: { protocol: 'tunnel', tlsMode: 'none', transport: 'raw' },
  tuic: { protocol: 'tuic', tlsMode: 'tls', transport: 'raw' },
  shadowtls: { protocol: 'shadowtls', tlsMode: 'shadowtls', transport: 'raw' },
  naive: { protocol: 'naive', tlsMode: 'tls', transport: 'raw' },
};

export const createNode = async (
  payload: NodeCreateInput,
): Promise<{ node: NodeItem; deploy: DeployResult | null }> => {
  await delay();
  const { template, name, serverId, outboundType, landingServerId } = payload;
  if (!name || !serverId) throw new ApiError(400, 'name/serverId 必填');
  const server = findServer(serverId);
  if (outboundType === 'relay') {
    const landing = landingServerId ? findServer(landingServerId) : undefined;
    if (!landing) throw new ApiError(400, '中转出口需要选择落地机');
  }
  let tunnelAddress: string | undefined;
  let tunnelPort: number | undefined;
  if (template === 'tunnel') {
    if (!payload.tunnelAddress || !payload.tunnelPort) {
      throw new ApiError(400, '隧道节点需要填写转发目标地址与端口');
    }
    tunnelAddress = payload.tunnelAddress.trim();
    tunnelPort = Number(payload.tunnelPort);
  }
  const meta = TEMPLATE_META[template];
  const id = nextNodeId++;
  const creds = makeCreds(meta.protocol, server, meta.protocol === 'vless' ? payload.sni : undefined);
  if ((meta.protocol === 'socks' || meta.protocol === 'http') && (payload.authUser || payload.authPassword)) {
    creds.username = payload.authUser;
    creds.password = payload.authPassword;
  }
  credsById.set(id, creds);
  const landing = landingServerId ? servers.find((s) => s.id === landingServerId) : undefined;
  const port = payload.port ? Number(payload.port) : nextFreePort(serverId);
  if (nodes.some((n) => n.server_id === serverId && n.listen_port === port)) {
    throw new ApiError(409, `端口 ${port} 已被该机器上其他节点占用`);
  }
  const node: NodeItem = {
    id,
    name,
    server_id: serverId,
    server_name: server.name,
    protocol: meta.protocol,
    listen_port: port,
    enabled: 1,
    tls_mode: meta.tlsMode,
    transport: meta.transport,
    sni: creds.sni,
    outbound_type: outboundType,
    landing_server_id: landingServerId,
    landing_name: landing?.name,
    tunnel_address: tunnelAddress,
    tunnel_port: tunnelPort,
    share_link: buildShareLink(name, server, port, meta.protocol, creds),
    note: '',
    created_at: iso(0),
  };
  nodes = [...nodes, node];
  return { node, deploy: okDeploy() };
};

export const updateNode = async (
  id: number,
  payload: NodePatch,
): Promise<{ node: NodeItem; deploy: DeployResult | null }> => {
  await delay();
  const row = nodes.find((n) => n.id === id);
  if (!row) throw new ApiError(404, '节点不存在');
  const server = findServer(row.server_id);
  const next: NodeItem = { ...row };

  if (payload.name !== undefined) next.name = payload.name;
  if (payload.note !== undefined) next.note = payload.note;
  if (payload.enabled !== undefined) next.enabled = payload.enabled ? 1 : 0;

  // 出口
  if (payload.outboundType !== undefined) {
    next.outbound_type = payload.outboundType;
    if (payload.outboundType === 'direct') {
      next.landing_server_id = undefined;
      next.landing_name = undefined;
    }
  }
  if (payload.landingServerId !== undefined) {
    if (next.outbound_type === 'direct') {
      throw new ApiError(400, '直连节点无需落地机');
    }
    const landing = findServer(payload.landingServerId);
    next.landing_server_id = landing.id;
    next.landing_name = landing.name;
  }

  // 端口(同机唯一)
  if (payload.port !== undefined) {
    const port = Number(payload.port);
    if (
      nodes.some(
        (n) => n.id !== id && n.server_id === next.server_id && n.listen_port === port,
      )
    ) {
      throw new ApiError(409, `端口 ${port} 已被该机器上其他节点占用`);
    }
    next.listen_port = port;
  }

  // 隧道转发目标
  if (payload.tunnelAddress !== undefined) next.tunnel_address = payload.tunnelAddress.trim();
  if (payload.tunnelPort !== undefined) next.tunnel_port = Number(payload.tunnelPort);

  // 协议(改协议 = 凭据重新生成)
  if (payload.protocol !== undefined && payload.protocol !== row.protocol) {
    next.protocol = payload.protocol;
    next.tls_mode = PROTOCOL_DEFAULTS[payload.protocol].tlsMode;
    next.transport = PROTOCOL_DEFAULTS[payload.protocol].transport;
    credsById.set(id, makeCreds(payload.protocol, server));
  }

  // socks/http 认证
  if ((next.protocol === 'socks' || next.protocol === 'http') && payload.authUser !== undefined) {
    const creds = credsById.get(id) ?? {};
    creds.username = payload.authUser || undefined;
    creds.password = payload.authUser ? payload.authPassword : undefined;
    credsById.set(id, creds);
  }

  // SNI(Reality)
  if (payload.sni !== undefined && next.protocol === 'vless') {
    const creds = credsById.get(id) ?? makeCreds('vless', server);
    creds.sni = payload.sni.trim() || 'www.microsoft.com';
    credsById.set(id, creds);
  }

  // 重建分享链接(凭据不进前端,由后端构建)
  const creds = credsById.get(id) ?? makeCreds(next.protocol, server);
  next.share_link = buildShareLink(next.name, server, next.listen_port, next.protocol, creds);
  next.sni = creds.sni;

  nodes = nodes.map((n) => (n.id === id ? next : n));
  return { node: next, deploy: okDeploy() };
};

export const deleteNode = async (
  id: number,
): Promise<{ ok: true; deploy: DeployResult | null }> => {
  await delay();
  const row = nodes.find((n) => n.id === id);
  if (!row) throw new ApiError(404, '节点不存在');
  nodes = nodes.filter((n) => n.id !== id);
  credsById.delete(id);
  return { ok: true, deploy: okDeploy() };
};

// ---- 订阅 ----
export const getSettings = async (): Promise<Settings> => {
  await delay();
  return { subSlug, subUrl: `/sub/${subSlug}` };
};

export const setSlug = async (slug: string): Promise<Settings> => {
  await delay();
  const cleaned = slug.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!cleaned) throw new ApiError(400, 'slug 仅允许字母/数字/下划线/连字符');
  subSlug = cleaned;
  return { subSlug, subUrl: `/sub/${subSlug}` };
};

// ---- Reality 域名库 ----
export const getSnis = async (): Promise<SniItem[]> => {
  await delay();
  return snis;
};

export const createSni = async (domain: string, note: string): Promise<SniItem> => {
  await delay();
  const d = domain.trim();
  if (!DOMAIN_RE.test(d)) throw new ApiError(400, '域名格式不正确,如 www.example.com');
  if (snis.some((s) => s.domain === d)) throw new ApiError(409, '该域名已存在');
  const row: SniItem = { id: nextSniId++, domain: d, note: note.trim(), builtin: false };
  snis = [...snis, row];
  return row;
};

export const updateSni = async (
  id: number,
  payload: { domain?: string; note?: string },
): Promise<SniItem> => {
  await delay();
  const row = snis.find((s) => s.id === id);
  if (!row) throw new ApiError(404, '域名不存在');
  const domain = payload.domain?.trim() ?? row.domain;
  if (!DOMAIN_RE.test(domain)) throw new ApiError(400, '域名格式不正确');
  if (snis.some((s) => s.domain === domain && s.id !== id)) {
    throw new ApiError(409, '该域名已存在');
  }
  const next: SniItem = { ...row, domain, note: payload.note?.trim() ?? row.note };
  snis = snis.map((s) => (s.id === id ? next : s));
  return next;
};

export const deleteSni = async (id: number): Promise<{ ok: true }> => {
  await delay();
  if (!snis.some((s) => s.id === id)) throw new ApiError(404, '域名不存在');
  snis = snis.filter((s) => s.id !== id);
  return { ok: true };
};

export const api: ApiModule = {
  login,
  getServers,
  createServer,
  updateServer,
  deleteServer,
  checkServers,
  testServer,
  installServer,
  restartServer,
  uninstallServer,
  getInstallScript,
  getNodes,
  createNode,
  updateNode,
  deleteNode,
  getSettings,
  setSlug,
  getSnis,
  createSni,
  updateSni,
  deleteSni,
};