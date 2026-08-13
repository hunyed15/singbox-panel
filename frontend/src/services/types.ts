/**
 * 数据契约唯一来源(与后端 API 对齐,见 docs/ia.md §3)。
 * mock 与真实 HTTP 实现共用本文件类型,联调只换 services/index.ts 的实现选择。
 */

export type ServerRole = 'relay' | 'landing';
export type ControlMode = 'ssh' | 'agent';
export type PingStatus = 'online' | 'inactive' | 'offline' | 'unknown';
export type SshAuthType = 'key' | 'password';

export type NodeProtocol =
  | 'vless'
  | 'vmess'
  | 'trojan'
  | 'shadowsocks'
  | 'hysteria'
  | 'socks'
  | 'http'
  | 'tunnel'
  | 'tuic'
  | 'shadowtls'
  | 'naive';

export type NodeTemplate =
  | 'vless-reality'
  | 'vmess-ws-tls'
  | 'trojan-tls'
  | 'ss2022'
  | 'hysteria'
  | 'socks'
  | 'http'
  | 'tunnel'
  | 'tuic'
  | 'shadowtls'
  | 'naive';

export type TlsMode = 'none' | 'reality' | 'tls' | 'shadowtls';
export type OutboundType = 'direct' | 'relay';

export interface AgentInfo {
  token: string;
  agent_version: string;
  last_heartbeat: string | null;
}

export interface Server {
  id: number;
  name: string;
  role: ServerRole;
  control: ControlMode;
  host: string;
  ssh_port: number;
  ssh_user: string;
  ssh_auth_type: SshAuthType;
  region: string;
  ping_status: PingStatus;
  singbox_version: string;
  last_seen: string | null;
  /** agent 模式才有 */
  agent?: AgentInfo;
}

export interface ServerInput {
  name: string;
  role: ServerRole;
  control: ControlMode;
  region: string;
  /** control='ssh' 时必填;agent 模式由机器自行注册,可不填 */
  host?: string;
  sshPort?: number;
  sshUser?: string;
  sshAuthType?: SshAuthType;
  sshAuthSecret?: string;
}

export interface NodeItem {
  id: number;
  name: string;
  server_id: number;
  server_name: string;
  protocol: NodeProtocol;
  listen_port: number;
  enabled: 0 | 1;
  tls_mode: TlsMode;
  transport: 'raw' | 'ws';
  /** 展示用:Reality 借站域名(公开非机密) */
  sni?: string;
  /** 隧道节点:固定转发目标(IPv4/IPv6/域名) */
  tunnel_address?: string;
  tunnel_port?: number;
  outbound_type: OutboundType;
  landing_server_id?: number;
  landing_name?: string;
  /** 后端构建的分享链接;凭据不进前端。socks/http 无标准分享链接 → null */
  share_link: string | null;
  note: string;
  created_at: string;
}

export interface NodeCreateInput {
  template: NodeTemplate;
  name: string;
  serverId: number;
  outboundType: OutboundType;
  landingServerId?: number;
  /** 仅 vless-reality 模板使用:Reality 借站域名(SNI),来自域名库 */
  sni?: string;
  /** 手动指定端口(留空自动分配,后端校验同机唯一) */
  port?: number;
  /** 隧道模板:固定转发目标 */
  tunnelAddress?: string;
  tunnelPort?: number;
}

export interface SniItem {
  id: number;
  domain: string;
  note: string;
  /** 内置大厂域名,可编辑可删除 */
  builtin: boolean;
}

export interface NodePatch {
  name?: string;
  note?: string;
  enabled?: boolean;
  outboundType?: OutboundType;
  landingServerId?: number;
  sni?: string;
  port?: number;
  /** 改协议 = 凭据自动重新生成,客户端需更新 */
  protocol?: NodeProtocol;
  /** 隧道节点:固定转发目标 */
  tunnelAddress?: string;
  tunnelPort?: number;
}

export type DeployResult =
  | { ok: true; steps?: string[] }
  | { ok: false; error: string };

export type ControlResult =
  | { ok: true; steps?: string[]; message?: string }
  | { ok: false; error: string };

export interface Settings {
  subSlug: string;
  subUrl: string;
}

export interface LoginResult {
  token: string;
  username: string;
}

export interface TestResult {
  ok: boolean;
  message?: string;
}

export interface InstallScriptResult {
  script: string;
}

export interface ApiModule {
  login(username: string, password: string): Promise<LoginResult>;
  getServers(): Promise<Server[]>;
  createServer(payload: ServerInput): Promise<Server>;
  updateServer(id: number, payload: Partial<ServerInput>): Promise<Server>;
  deleteServer(id: number): Promise<{ ok: true }>;
  /** 被动检查:SSH 逐个检查各机 sing-box 状态并更新缓存 */
  checkServers(): Promise<Server[]>;
  testServer(id: number): Promise<TestResult>;
  installServer(id: number): Promise<ControlResult>;
  restartServer(id: number): Promise<ControlResult>;
  uninstallServer(id: number): Promise<ControlResult>;
  getInstallScript(id: number): Promise<InstallScriptResult>;
  getNodes(): Promise<NodeItem[]>;
  createNode(
    payload: NodeCreateInput,
  ): Promise<{ node: NodeItem; deploy: DeployResult | null }>;
  updateNode(
    id: number,
    payload: NodePatch,
  ): Promise<{ node: NodeItem; deploy: DeployResult | null }>;
  deleteNode(id: number): Promise<{ ok: true; deploy: DeployResult | null }>;
  getSettings(): Promise<Settings>;
  setSlug(slug: string): Promise<Settings>;
  getSnis(): Promise<SniItem[]>;
  createSni(domain: string, note: string): Promise<SniItem>;
  updateSni(id: number, payload: { domain?: string; note?: string }): Promise<SniItem>;
  deleteSni(id: number): Promise<{ ok: true }>;
}