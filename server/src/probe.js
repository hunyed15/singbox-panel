/**
 * 被动状态检查:对每台机 SSH 执行 sing-box version + systemctl is-active,写回状态。
 * 无后台轮询;由 POST /api/servers/check 触发。并发 ≤3,单台超时由 ssh.exec 控制。
 */

const CONCURRENCY = 3;

export function parseVersion(stdout) {
  const m = stdout.match(/[0-9]+\.[0-9]+(?:\.[0-9]+)?(?:\s+[A-Za-z]+)?/);
  return m ? m[0].trim() : '';
}

export async function checkAllServers(db, ssh, crypto, config, serverRows = null) {
  const list = serverRows || db.prepare('SELECT * FROM servers').all();
  const update = db.prepare(
    'UPDATE servers SET ping_status = ?, singbox_version = ?, last_seen = ? WHERE id = ?',
  );

  const checkOne = async (row) => {
    try {
      const conn = ssh.buildConn(row); // 凭据异常/解密失败也计入 offline,不打断整批
      const ver = await ssh.exec(conn, `${config.singboxBin} version | head -1`);
      const act = await ssh.exec(conn, `systemctl is-active ${config.singboxUnit}`);
      const version = parseVersion(ver.stdout);
      const status = act.stdout.trim() === 'active' ? 'online' : 'inactive';
      update.run(status, version, new Date().toISOString(), row.id);
    } catch {
      update.run('offline', '', new Date().toISOString(), row.id);
    }
  };

  for (let i = 0; i < list.length; i += CONCURRENCY) {
    await Promise.all(list.slice(i, i + CONCURRENCY).map(checkOne));
  }

  return db.prepare('SELECT * FROM servers').all();
}
