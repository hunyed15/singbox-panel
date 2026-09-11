import express from 'express';
import { ApiError } from '../errors.js';
import { buildConn } from '../ssh.js';

/** 在入口机写入转发规则:优先 iptables,降级到 socat */
async function applyPortForward(ssh, conn, entryPort, landingHost, targetPort, remove) {
  // 先检查 iptables 是否可用
  let useIptables = false;
  try {
    const chk = await ssh.exec(conn, `command -v iptables >/dev/null 2>&1 && echo YES || echo NO`);
    useIptables = chk.stdout.trim() === 'YES';
  } catch { useIptables = false; }

  if (useIptables) {
    const action = remove ? '-D' : '-A';
    const cmds = [
      `iptables -t nat ${action} PREROUTING -p tcp --dport ${entryPort} -j DNAT --to-destination ${landingHost}:${targetPort}`,
      `iptables ${action} FORWARD -p tcp -d ${landingHost} --dport ${targetPort} -j ACCEPT`,
    ];
    for (const cmd of cmds) await ssh.exec(conn, cmd);
    await ssh.exec(conn, `(command -v iptables-save >/dev/null && iptables-save > /etc/iptables/rules.v4 2>/dev/null) || true`);
  } else {
    // 降级到 socat
    const pidFile = `/tmp/socat-fwd-${entryPort}.pid`;
    if (remove) {
      await ssh.exec(conn, `kill $(cat ${pidFile} 2>/dev/null) 2>/dev/null; rm -f ${pidFile}; true`);
    } else {
      // 装 socat
      await ssh.exec(conn, `(command -v socat >/dev/null || (apt-get update -qq && apt-get install -y -qq socat) || (yum install -y -q socat) || true)`);
      await ssh.exec(conn, `nohup socat TCP-LISTEN:${entryPort},fork,reuseaddr TCP:${landingHost}:${targetPort} &>/dev/null & echo \\$! > ${pidFile}`);
    }
  }
}

export function makePortForwardsRouter({ db, ssh, crypto, appSecret }) {
  const router = express.Router();

  /** 构建转发规则返回项 */
  function item(row) {
    const entry = db.prepare('SELECT name FROM servers WHERE id = ?').get(row.entry_server_id);
    const landing = db.prepare('SELECT name FROM servers WHERE id = ?').get(row.landing_server_id);
    let targetName = '';
    if (row.target_node_type === 'singbox') {
      const nd = db.prepare('SELECT name FROM nodes WHERE id = ?').get(row.target_node_id);
      targetName = nd?.name || '(deleted)';
    } else {
      const nd = db.prepare('SELECT name FROM xray_nodes WHERE id = ?').get(row.target_node_id);
      targetName = nd?.name || '(deleted)';
    }
    return {
      id: row.id,
      name: row.name,
      entry_server_id: row.entry_server_id,
      entry_server_name: entry?.name || '(deleted)',
      landing_server_id: row.landing_server_id,
      landing_server_name: landing?.name || '(deleted)',
      target_node_type: row.target_node_type,
      target_node_id: row.target_node_id,
      target_node_name: targetName,
      entry_port: row.entry_port,
      target_port: row.target_port,
      enabled: row.enabled,
      note: row.note,
      created_at: row.created_at,
    };
  }

  router.get('/', (req, res) => {
    const rows = db.prepare('SELECT * FROM port_forwards ORDER BY id').all();
    res.json(rows.map(item));
  });

  router.post('/', async (req, res) => {
    const b = req.body || {};
    const { name, entryServerId, landingServerId, targetNodeType, targetNodeId, entryPort, targetPort } = b;
    if (!name || !entryServerId || !landingServerId || !targetNodeType || !targetNodeId || !targetPort) {
      throw new ApiError(400, 'name/entryServerId/landingServerId/targetNodeType/targetNodeId/targetPort 必填');
    }
    const entry = db.prepare('SELECT * FROM servers WHERE id = ?').get(entryServerId);
    if (!entry) throw new ApiError(400, '入口机不存在');
    const landing = db.prepare('SELECT * FROM servers WHERE id = ?').get(landingServerId);
    if (!landing) throw new ApiError(400, '落地机不存在');

    // 验证目标节点存在
    if (targetNodeType === 'singbox') {
      if (!db.prepare('SELECT id FROM nodes WHERE id = ?').get(targetNodeId)) {
        throw new ApiError(400, '目标 SingBox 节点不存在');
      }
    } else {
      if (!db.prepare('SELECT id FROM xray_nodes WHERE id = ?').get(targetNodeId)) {
        throw new ApiError(400, '目标 Xray 节点不存在');
      }
    }

    const port = entryPort || (20000 + Math.floor(Math.random() * 40000));

    // SSH 到入口机写 iptables 规则
    const conn = buildConn(entry, crypto.decrypt, appSecret);
    const landingHost = landing.client_host || landing.host;
    try {
      await applyPortForward(ssh, conn, port, landingHost, targetPort, false);
    } catch (err) {
      throw new ApiError(500, `转发规则写入失败: ${err.message}`);
    }

    const info = db.prepare(
      `INSERT INTO port_forwards (name, entry_server_id, landing_server_id, target_node_type, target_node_id, entry_port, target_port, note, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    ).run(name, entryServerId, landingServerId, targetNodeType, targetNodeId, port, targetPort, b.note || '', new Date().toISOString());

    res.json({ port_forward: item(db.prepare('SELECT * FROM port_forwards WHERE id = ?').get(info.lastInsertRowid)) });
  });

  router.delete('/:id', async (req, res) => {
    const id = Number(req.params.id);
    const row = db.prepare('SELECT * FROM port_forwards WHERE id = ?').get(id);
    if (!row) throw new ApiError(404, '转发规则不存在');

    const entry = db.prepare('SELECT * FROM servers WHERE id = ?').get(row.entry_server_id);
    if (entry) {
      const landing = db.prepare('SELECT host, client_host FROM servers WHERE id = ?').get(row.landing_server_id);
      if (landing) {
        const conn = buildConn(entry, crypto.decrypt, appSecret);
        const landingHost = landing.client_host || landing.host;
        try {
          await applyPortForward(ssh, conn, row.entry_port, landingHost, row.target_port, true);
        } catch (err) {
          // 删除规则失败不阻断,记录即可
          console.error(`[port-forward] delete iptables rule #${id} failed:`, err.message);
        }
      }
    }

    db.prepare('DELETE FROM port_forwards WHERE id = ?').run(id);
    res.json({ ok: true });
  });

  return router;
}