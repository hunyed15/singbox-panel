import express from 'express';
import { ApiError } from '../errors.js';
import { buildConn, testConnection } from '../ssh.js';
import { checkAllServers } from '../probe.js';

const CONTROL_LABEL = { install: '安装', restart: '重启', uninstall: '卸载' };
const XRAY_CONTROL_LABEL = { install: '安装 xray', restart: '重启 xray', uninstall: '卸载 xray' };
const FALLBACK_VERSION = '1.13.18';
const XRAY_FALLBACK_VERSION = '24.11.30';

/** 'latest' → 查询 GitHub 最新 release;失败回退固定版本 */
async function resolveSingboxVersion(config) {
  if (config.singboxVersion !== 'latest') return config.singboxVersion;
  try {
    const res = await fetch('https://api.github.com/repos/SagerNet/sing-box/releases/latest', {
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) {
      const data = await res.json();
      const tag = data?.tag_name || '';
      if (/^v?\d+\.\d+\.\d+/.test(tag)) return tag.replace(/^v/, '');
    }
  } catch {
    /* 网络失败走回退 */
  }
  return FALLBACK_VERSION;
}

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
ExecReload=/bin/kill -HUP $MAINPID
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
        `INSERT INTO servers (name, role, control, host, client_host, ssh_port, ssh_user, ssh_auth_type, ssh_auth_secret, ssh_sudo, region)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        name,
        role,
        control,
        b.host || '',
        b.clientHost || '',
        b.sshPort || 22,
        b.sshUser || 'root',
        b.sshAuthType || 'key',
        sshSecret,
        b.sshSudo ? 1 : 0,
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
      `UPDATE servers SET name=?, role=?, control=?, host=?, client_host=?, ssh_port=?, ssh_user=?, ssh_auth_type=?, ssh_sudo=?, region=?
       WHERE id=?`,
    ).run(
      b.name ?? row.name,
      nextRole,
      control,
      b.host ?? row.host,
      b.clientHost !== undefined ? b.clientHost : row.client_host,
      b.sshPort ?? row.ssh_port,
      b.sshUser ?? row.ssh_user,
      b.sshAuthType ?? row.ssh_auth_type,
      b.sshSudo !== undefined ? (b.sshSudo ? 1 : 0) : row.ssh_sudo,
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

async function step(label, fn) {
  try {
    await fn();
  } catch (err) {
    throw new Error(`[${label}] ${err.message}`);
  }
}

  async function controlAction(action, id) {
    const row = db.prepare('SELECT * FROM servers WHERE id = ?').get(id);
    if (!row) throw new ApiError(404, '服务器不存在');
    const conn = buildConn(row, crypto.decrypt, appSecret);
    const steps = [];

    if (action === 'install') {
      let arch;
      await step('架构探测', async () => {
        const archOut = await ssh.exec(conn, 'uname -m');
        arch = archFromUname(archOut.stdout);
      });
      const ver = await resolveSingboxVersion(config);
      const asset = `sing-box-${ver}-linux-${arch}.tar.gz`;
      const url = `${config.singboxDownloadBase}/v${ver}/${asset}`;
      steps.push('download', url);
      await step('下载', async () => {
        const dl = (u) =>
          `rm -f /tmp/singbox.tar.gz; (command -v curl >/dev/null && curl -fsSL -o /tmp/singbox.tar.gz '${u}') || (command -v wget >/dev/null && wget -q -O /tmp/singbox.tar.gz '${u}')`;
        try {
          await ssh.exec(conn, dl(url));
        } catch {
          // GitHub 直连失败 → gh-proxy 镜像兜底
          const mirror = `https://gh-proxy.org/${url}`;
          await ssh.exec(conn, dl(mirror));
        }
      });
      steps.push('extract');
      await step('解压', async () => {
        await ssh.exec(conn, `rm -rf /tmp/singbox-extract && mkdir -p /tmp/singbox-extract && tar -xzf /tmp/singbox.tar.gz -C /tmp/singbox-extract`);
      });
      await step('安装二进制', async () => {
        // find 定位二进制,不依赖解压目录名
        await ssh.exec(
          conn,
          `BIN=$(find /tmp/singbox-extract -type f -name sing-box | head -1) && test -n "$BIN" && install -m 755 "$BIN" ${config.singboxBin}`,
        );
      });
      steps.push('unit');
      await step('写 systemd 单元', async () => {
        await ssh.exec(conn, 'mkdir -p /etc/systemd/system');
        await ssh.writeFile(conn, `/etc/systemd/system/${config.singboxUnit}.service`, UNIT_FILE(config.singboxBin, config.singboxConfig));
      });
      // 最小合法配置,让服务装完即可启动(之后建节点 deploy 会覆盖为真实配置)
      await step('写最小配置', async () => {
        await ssh.exec(conn, 'mkdir -p /etc/sing-box');
        await ssh.writeFile(
          conn,
          config.singboxConfig,
          JSON.stringify(
            {
              log: { level: 'info', timestamp: true },
              inbounds: [],
              outbounds: [{ type: 'direct', tag: 'direct' }],
              route: { final: 'direct' },
            },
            null,
            2,
          ),
        );
      });
      steps.push('enable');
      await step('启动服务', async () => {
        await ssh.exec(conn, `systemctl daemon-reload && systemctl enable --now ${config.singboxUnit}`);
      });
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

  // ---- Xray 生命周期管理 ----
  const XRAY_UNIT_FILE = (bin, cfg) => `[Unit]
Description=Xray
After=network.target

[Service]
Type=simple
ExecStart=${bin} run -c ${cfg}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
`;

  /** 解析 xray 版本号 */
  function parseXrayVersion(stdout) {
    const m = stdout.match(/[0-9]+\.[0-9]+(?:\.[0-9]+)?/);
    return m ? m[0].trim() : '';
  }

  async function resolveXrayVersion(config) {
    if (config.xrayVersion !== 'latest') return config.xrayVersion;
    try {
      const res = await fetch('https://api.github.com/repos/XTLS/Xray-core/releases/latest', {
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) {
        const data = await res.json();
        const tag = data?.tag_name || '';
        if (/^v?\d+\.\d+\.\d+/.test(tag)) return tag.replace(/^v/, '');
      }
    } catch { /* fallback */ }
    return XRAY_FALLBACK_VERSION;
  }

  async function xrayControlAction(action, id) {
    const row = db.prepare('SELECT * FROM servers WHERE id = ?').get(id);
    if (!row) throw new ApiError(404, '服务器不存在');
    const conn = buildConn(row, crypto.decrypt, appSecret);
    const steps = [];

    if (action === 'install') {
      let arch;
      await step('架构探测', async () => {
        const archOut = await ssh.exec(conn, 'uname -m');
        arch = archFromUname(archOut.stdout);
      });
      const ver = await resolveXrayVersion(config);
      const asset = `Xray-linux-${arch}.zip`;
      const url = `${config.xrayDownloadBase}/v${ver}/${asset}`;
      steps.push('download');
      await step('下载', async () => {
        const dl = (u) =>
          `rm -f /tmp/xray.zip; (command -v curl >/dev/null && curl -fsSL -o /tmp/xray.zip '${u}') || (command -v wget >/dev/null && wget -q -O /tmp/xray.zip '${u}')`;
        try {
          await ssh.exec(conn, dl(url));
        } catch {
          const mirror = `https://gh-proxy.org/${url}`;
          await ssh.exec(conn, dl(mirror));
        }
      });
      await step('安装 unzip', async () => {
        await ssh.exec(conn, `(command -v unzip >/dev/null || (apt-get update -qq && apt-get install -y -qq unzip) || (yum install -y -q unzip) || true)`);
      });
      steps.push('extract');
      await step('解压', async () => {
        await ssh.exec(conn, `rm -rf /tmp/xray-extract && mkdir -p /tmp/xray-extract && unzip -o /tmp/xray.zip -d /tmp/xray-extract`);
      });
      await step('安装二进制', async () => {
        await ssh.exec(
          conn,
          `BIN=$(find /tmp/xray-extract -type f -name xray | head -1) && test -n "$BIN" && install -m 755 "$BIN" ${config.xrayBin}`,
        );
      });
      steps.push('unit');
      await step('写 systemd 单元', async () => {
        await ssh.exec(conn, 'mkdir -p /etc/systemd/system');
        await ssh.writeFile(conn, `/etc/systemd/system/${config.xrayUnit}.service`, XRAY_UNIT_FILE(config.xrayBin, config.xrayConfig));
      });
      await step('写最小配置', async () => {
        await ssh.exec(conn, `mkdir -p $(dirname ${config.xrayConfig})`);
        await ssh.writeFile(
          conn,
          config.xrayConfig,
          JSON.stringify(
            {
              log: { loglevel: 'warning' },
              inbounds: [],
              outbounds: [{ protocol: 'freedom', tag: 'direct' }],
              routing: { domainStrategy: 'AsIs', rules: [] },
            },
            null,
            2,
          ),
        );
      });
      steps.push('enable');
      await step('启动服务', async () => {
        await ssh.exec(conn, `systemctl daemon-reload && systemctl enable --now ${config.xrayUnit}`);
      });
      db.prepare('UPDATE servers SET xray_version = ?, xray_ping_status = ? WHERE id = ?').run(ver, 'online', id);
    } else if (action === 'restart') {
      await ssh.exec(conn, `systemctl restart ${config.xrayUnit}`);
      steps.push('restart');
    } else {
      await ssh.exec(conn, `systemctl disable --now ${config.xrayUnit}`);
      await ssh.exec(conn, `rm -f /etc/systemd/system/${config.xrayUnit}.service ${config.xrayBin} ${config.xrayConfig}`);
      await ssh.exec(conn, 'systemctl daemon-reload');
      db.prepare('UPDATE servers SET xray_version = ?, xray_ping_status = ? WHERE id = ?').run('', 'unknown', id);
      steps.push('uninstall');
    }
    return { ok: true, steps: [`${XRAY_CONTROL_LABEL[action]}`, ...steps] };
  }

  for (const action of ['install', 'restart', 'uninstall']) {
    router.post(`/:id/xray-${action}`, async (req, res) => {
      try {
        res.json(await xrayControlAction(action, Number(req.params.id)));
      } catch (err) {
        res.json({ ok: false, error: err.message });
      }
    });
  }

  return router;
}
