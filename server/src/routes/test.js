import express from 'express';
import { execSync } from 'node:child_process';
import { ApiError } from '../errors.js';

export function makeTestRouter() {
  const router = express.Router();

  /** 节点连通性测试(从面板本机执行 nc/openssl) */
  async function testNode(host, port, protocol, sni) {
    // TCP 端口测试
    try {
      execSync(`nc -zv -w5 ${host} ${port}`, { timeout: 10000, stdio: 'pipe' });
      return { ok: true, latency_ms: 0, detail: 'TCP connected' };
    } catch (e) {
      // nc 失败可能因为没装,用 node 原生 socket
      const msg = e.stderr?.toString() || e.message || '';
      if (msg.includes('succeeded') || msg.includes('Connected')) {
        return { ok: true, latency_ms: 0, detail: 'TCP connected' };
      }
    }

    // 如果 TCP 不通但有 TLS,尝试 openssl
    if ((protocol === 'vless' || protocol === 'vmess' || protocol === 'trojan') && sni) {
      try {
        execSync(
          `echo | openssl s_client -connect ${host}:${port} -servername ${sni} 2>&1 | grep -q 'SSL handshake'`,
          { timeout: 10000, stdio: 'pipe' },
        );
        return { ok: true, detail: 'TLS handshake OK' };
      } catch {
        return { ok: false, detail: 'TCP unreachable, TLS handshake failed' };
      }
    }

    return { ok: false, detail: 'TCP connection refused or timed out' };
  }

  /** 测 SingBox 节点 */
  router.post('/nodes/:id', async (req, res) => {
    const id = Number(req.params.id);
    const row = db.prepare('SELECT * FROM nodes WHERE id = ?').get(id);
    if (!row) throw new ApiError(404, '节点不存在');
    const srv = db.prepare('SELECT host, client_host FROM servers WHERE id = ?').get(row.server_id);
    if (!srv) throw new ApiError(404, '服务器不存在');
    const host = srv.client_host || srv.host;
    const result = await testNode(host, row.listen_port, row.protocol, row.sni);
    res.json(result);
  });

  /** 测 Xray 节点 */
  router.post('/xray-nodes/:id', async (req, res) => {
    const id = Number(req.params.id);
    const row = db.prepare('SELECT * FROM xray_nodes WHERE id = ?').get(id);
    if (!row) throw new ApiError(404, 'Xray 节点不存在');
    const srv = db.prepare('SELECT host, client_host FROM servers WHERE id = ?').get(row.server_id);
    if (!srv) throw new ApiError(404, '服务器不存在');
    const host = srv.client_host || srv.host;
    const result = await testNode(host, row.listen_port, row.protocol, row.sni);
    res.json(result);
  });

  return router;
}