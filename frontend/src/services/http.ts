import { ApiError } from './errors';
import { clearToken, getToken, setToken } from './auth';
import type {
  AccountPatch,
  ApiModule,
  ControlResult,
  DeployResult,
  InstallScriptResult,
  LoginResult,
  NodeCreateInput,
  NodeItem,
  NodePatch,
  Server,
  ServerInput,
  Settings,
  SniItem,
  TestResult,
} from './types';

async function request<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const token = getToken();
  const res = await fetch(path, {
    method: init.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (res.status === 401) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (body.error !== 'unauthorized') {
      // 业务性 401(如登录凭据错误):按普通错误抛出,不视为会话过期
      throw new ApiError(401, body.error ?? '请求未授权');
    }
    clearToken();
    window.location.assign('/login');
    throw new ApiError(401, '登录已过期,请重新登录');
  }
  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
  } & Record<string, unknown>;
  if (!res.ok) {
    throw new ApiError(res.status, data.error ?? `HTTP ${res.status}`);
  }
  return data as T;
}

export const login = async (
  username: string,
  password: string,
): Promise<LoginResult> => {
  const data = await request<LoginResult>('/api/auth/login', {
    method: 'POST',
    body: { username, password },
  });
  setToken(data.token);
  return data;
};

export const getMe = (): Promise<{ username: string }> => request('/api/auth/me');

export const updateAccount = (payload: AccountPatch): Promise<{ username: string }> =>
  request('/api/auth/account', { method: 'PUT', body: payload });

// ---- 服务器 ----
export const getServers = (): Promise<Server[]> => request<Server[]>('/api/servers');

export const createServer = (payload: ServerInput): Promise<Server> =>
  request<Server>('/api/servers', { method: 'POST', body: payload });

export const updateServer = (id: number, payload: Partial<ServerInput>): Promise<Server> =>
  request<Server>(`/api/servers/${id}`, { method: 'PUT', body: payload });

export const deleteServer = (id: number): Promise<{ ok: true }> =>
  request<{ ok: true }>(`/api/servers/${id}`, { method: 'DELETE' });

export const checkServers = (): Promise<Server[]> =>
  request<Server[]>('/api/servers/check', { method: 'POST' });

export const testServer = (id: number): Promise<TestResult> =>
  request<TestResult>(`/api/servers/${id}/test`, { method: 'POST' });

export const installServer = (id: number): Promise<ControlResult> =>
  request<ControlResult>(`/api/servers/${id}/install`, { method: 'POST' });

export const restartServer = (id: number): Promise<ControlResult> =>
  request<ControlResult>(`/api/servers/${id}/restart`, { method: 'POST' });

export const uninstallServer = (id: number): Promise<ControlResult> =>
  request<ControlResult>(`/api/servers/${id}/uninstall`, { method: 'POST' });

export const getInstallScript = (id: number): Promise<InstallScriptResult> =>
  request<InstallScriptResult>(`/api/servers/${id}/install-script`);

// ---- 节点 ----
export const getNodes = (): Promise<NodeItem[]> => request<NodeItem[]>('/api/nodes');

export const createNode = (
  payload: NodeCreateInput,
): Promise<{ node: NodeItem; deploy: DeployResult | null }> =>
  request<{ node: NodeItem; deploy: DeployResult | null }>('/api/nodes', {
    method: 'POST',
    body: payload,
  });

export const updateNode = (
  id: number,
  payload: NodePatch,
): Promise<{ node: NodeItem; deploy: DeployResult | null }> =>
  request<{ node: NodeItem; deploy: DeployResult | null }>(`/api/nodes/${id}`, {
    method: 'PUT',
    body: payload,
  });

export const deleteNode = (
  id: number,
): Promise<{ ok: true; deploy: DeployResult | null }> =>
  request<{ ok: true; deploy: DeployResult | null }>(`/api/nodes/${id}`, {
    method: 'DELETE',
  });

// ---- 订阅 ----
export const getSettings = (): Promise<Settings> => request<Settings>('/api/settings');

export const setSlug = (slug: string): Promise<Settings> =>
  request<Settings>('/api/settings', { method: 'POST', body: { subSlug: slug } });

// ---- Reality 域名库 ----
export const getSnis = (): Promise<SniItem[]> => request<SniItem[]>('/api/snis');

export const createSni = (domain: string, note: string): Promise<SniItem> =>
  request<SniItem>('/api/snis', { method: 'POST', body: { domain, note } });

export const updateSni = (
  id: number,
  payload: { domain?: string; note?: string },
): Promise<SniItem> =>
  request<SniItem>(`/api/snis/${id}`, { method: 'PUT', body: payload });

export const deleteSni = (id: number): Promise<{ ok: true }> =>
  request<{ ok: true }>(`/api/snis/${id}`, { method: 'DELETE' });

export const api: ApiModule = {
  login,
  getMe,
  updateAccount,
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