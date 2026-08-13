import express from 'express';
import { ApiError } from '../errors.js';
import { buildConn, testConnection } from '../ssh.js';
import { checkAllServers } from '../probe.js';

const CONTROL_LABEL = { install: '安装', restart: '重启', uninstall: '卸载' };

function archFromUname(out) {
  const m = out.trim();
  const map = { x86_64: 'amd64', aarch64: 'arm64', armv7l: 'armv7', riscv64: 'riscv64' };
  return map[m] || m;
}

const UNIT_FILE = (bin, cfg) => `[Unit]
Description=sing-box
After=network.target

[Service]
Type=simple
ExecStart=${bin} run -c ${cfg}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
`;

export function makeServersRouter({ db, crypto, appSecret, ssh, config }) {
  const router = express.Router();

  const list = () =>
    db
      .prepare('SELECT * FROM servers ORDER BY id')
      .all()
      .map(stripSecret);

  const stripSecret = (row) => {
    const { ssh_auth_secret, ...rest } = row;
    return rest;
  };

  const find = (id) => {
    const row = db.prepare('SELECT * FROM servers WHERE id = ?').get(id);
    return row ? stripSecret(row) : null;
  };

  router.get('/', (req, res) => {
    res.json(list());
  });

  router.post('/', (req, res) => {
    const b = req.body || {};
    const { name, role, control = 'ssh', region = '' } = b;
    if (!name || !['relay', 'landing'].includes(role)) {
      throw new ApiError(400, 'name/role 必填');
    }
    if (control !== 'ssh' && control !== 'agent') throw new ApiError(400, 'control 非法');

    const sshSecret =
      control === 'ssh' ? crypto.encrypt(appSecret, String(b.sshAuthSecret || '')) : '';
    if (control === 'ssh' && (!b.host || !b.sshAuthSecret)) {
      throw new ApiError(400, 'SSH 模式需要 host 与 sshAuthSecret');
    }

    const info = db
      .prepare(
        `INSERT INTO servers (name, role, control, host, ssh_port, ssh_user, ssh_auth_type, ssh_auth_secret, region)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        name,
        role,
        control,
        b.host || '',
        b.sshPort || 22,
        b.sshUser || 'root',
        b.sshAuthType || 'key',
        sshSecret,
        region,
      );
    const id = info.lastInsertRowid;

    if (role === 'relay') {
      const { publicKey, privateKey } = crypto.genRealityKeypair();
      db.prepare(
        `INSERT INTO relay_settings (server_id, reality_public_key, reality_private_key, short_id, port_base)
         VALUES (?,?,?,?,?)`,
      ).run(id, publicKey, crypto.encrypt(appSecret, privateKey), crypto.genShortId(), 31000);
    } else {
      db.prepare(
        `INSERT INTO landing_settings (server_id, in_port, method, password) VALUES (?,?,?,?)`,
      ).run(id, 32000 + Number(id), '2022-blake3-aes-128-gcm', crypto.encrypt(appSecret, crypto.genSsPassword()));
    }

    res.json(find(info.lastInsertRowid));
  });
  router.put('/:id', (req, res) => {
    const id = Number(req.params.id);
    const row = db.prepare('SELECT * FROM servers WHERE id = ?').get(id);
    if (!row) throw new ApiError(404, '服务器不存在');
    const b = req.body || {};

    const nextRole = b.role ?? row.role;
    const control = b.control ?? row.control;
    if (control === 'ssh' && b.sshAuthSecret !== undefined && b.sshAuthSecret !== '') {
      db.prepare('UPDATE servers SET ssh_auth_secret = ? WHERE id = ?').run(
        crypto.encrypt(appSecret, b.sshAuthSecret),
        id,
      );
    }
    db.prepare(
      `UPDATE servers SET name=?, role=?, control=?, host=?, ssh_port=?, ssh_user=?, ssh_auth_type=?, region=?
       WHERE id=?`,
    ).run(
      b.name ?? row.name,
      nextRole,
      control,
      b.host ?? row.host,
      b.sshPort ?? row.ssh_port,
      b.sshUser ?? row.ssh_user,
      b.sshAuthType ?? row.ssh_auth_type,
      b.region ?? row.region,
      id,
    );

    // 角色变更:重建机器级凭据(relay ↔ landing)
    if (nextRole !== row.role) {
      db.prepare('DELETE FROM relay_settings WHERE server_id = ?').run(id);
      db.prepare('DELETE FROM landing_settings WHERE server_id = ?').run(id);
      if (nextRole === 'relay') {
        const { publicKey, privateKey } = crypto.genRealityKeypair();
        db.prepare(
          `INSERT INTO relay_settings (server_id, reality_public_key, reality_private_key, short_id, port_base)
           VALUES (?,?,?,?,?)`,
        ).run(id, publicKey, crypto.encrypt(appSecret, privateKey), crypto.genShortId(), 31000);
      } else {
        db.prepare(
          `INSERT INTO landing_settings (server_id, in_port, method, password) VALUES (?,?,?,?)`,
        ).run(id, 32000 + id, '2022-blake3-aes-128-gcm', crypto.encrypt(appSecret, crypto.genSsPassword()));
      }
    }

    res.json(find(id));
  });

  router.delete('/:id', (req, res) => {
    const id = Number(req.params.id);
    const used = db
      .prepare('SELECT COUNT(*) c FROM nodes WHERE server_id = ? OR landing_server_id = ?')
      .get(id, id).c;
    if (used > 0) throw new ApiError(409, '该服务器正被节点引用,请先删除相关节点');
    db.prepare('DELETE FROM servers WHERE id = ?').run(id);
    res.json({ ok: true });
  });

  router.post('/check', async (req, res) => {
    const rows = await checkAllServers(db, ssh, crypto, config);
    res.json(rows.map(stripSecret));
  });

  router.post('/:id/test', async (req, res) => {
    const id = Number(req.params.id);
    const row = db.prepare('SELECT * FROM servers WHERE id = ?').get(id);
    if (!row) throw new ApiError(404, '服务器不存在');
    if (row.control === 'agent') {
      return res.json({ ok: false, message: 'agent 模式状态来自心跳' });
    }
    const conn = buildConn(row, crypto.decrypt, appSecret);
    res.json(await testConnection(conn, ssh.exec));
  });

  async function controlAction(action, id) {
    const row = db.prepare('SELECT * FROM servers WHERE id = ?').get(id);
    if (!row) throw new ApiError(404, '服务器不存在');
    const conn = buildConn(row, crypto.decrypt, appSecret);
    const steps = [];

    if (action === 'install') {
      const archOut = await ssh.exec(conn, 'uname -m');
      const arch = archFromUname(archOut.stdout);
      const ver = config.singboxVersion;
      const url = `${config.singboxDownloadBase}/v${ver}/sing-box-${ver}-linux-${arch}.tar.gz`;
      steps.push('download', url);
      await ssh.exec(conn, `curl -fsSL -o /tmp/singbox.tar.gz '${url}'`);
      steps.push('extract');
      await ssh.exec(conn, `mkdir -p /tmp/singbox-extract && tar -xzf /tmp/singbox.tar.gz -C /tmp/singbox-extract`);
      await ssh.exec(conn, `install -m 755 /tmp/singbox-extract/sing-box-${ver}-linux-${arch}/sing-box ${config.singboxBin}`);
      steps.push('unit');
      await ssh.exec(conn, 'mkdir -p /etc/systemd/system');
      await ssh.writeFile(conn, `/etc/systemd/system/${config.singboxUnit}.service`, UNIT_FILE(config.singboxBin, config.singboxConfig));
      await ssh.exec(conn, `systemctl daemon-reload && systemctl enable --now ${config.singboxUnit}`);
      steps.push('enable');
    } else if (action === 'restart') {
      await ssh.exec(conn, `systemctl restart ${config.singboxUnit}`);
      steps.push('restart');
    } else {
      await ssh.exec(conn, `systemctl disable --now ${config.singboxUnit}`);
      await ssh.exec(conn, `rm -f /etc/systemd/system/${config.singboxUnit}.service ${config.singboxBin}`);
      await ssh.exec(conn, 'systemctl daemon-reload');
      steps.push('uninstall');
    }
    return { ok: true, steps: [`${CONTROL_LABEL[action]} sing-box`, ...steps] };
  }

  for (const action of ['install', 'restart', 'uninstall']) {
    router.post(`/:id/${action}`, async (req, res) => {
      try {
        res.json(await controlAction(action, Number(req.params.id)));
      } catch (err) {
        res.json({ ok: false, error: err.message });
      }
    });
  }

  return router;
}
