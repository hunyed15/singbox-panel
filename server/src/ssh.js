import { Client } from 'ssh2';

/** 按服务器行组装 ssh2 连接参数(凭据解密后使用);sudo 标记随 conn 传递 */
export function buildConn(serverRow, decrypt, appSecret) {
  const base = {
    host: serverRow.host,
    port: serverRow.ssh_port || 22,
    username: serverRow.ssh_user || 'root',
    sudo: serverRow.ssh_sudo === 1 || serverRow.ssh_sudo === true,
  };
  const secret = decrypt(appSecret, serverRow.ssh_auth_secret);
  if (serverRow.ssh_auth_type === 'password') {
    return { ...base, password: secret };
  }
  return { ...base, privateKey: secret };
}

/** 构造执行命令:conn.sudo 时整条包进 root shell(sudo -n sh -c),变量赋值/&& 链/单引号都能正确提权 */
export function buildExecCmd(conn, cmd) {
  if (!conn.sudo) return cmd;
  return `sudo -n -- sh -c '${cmd.replace(/'/g, `'\\''`)}'`;
}

/** 远程执行命令;exit code 非 0 或超时 → reject。conn.sudo 时命令经 sudo -n 执行。 */
export function exec(conn, cmd, timeoutMs = 30000) {
  const finalCmd = buildExecCmd(conn, cmd);
  return new Promise((resolve, reject) => {
    const c = new Client();
    let settled = false;
    const finish = (fn, ...args) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      c.end();
      fn(...args);
    };
    const timer = setTimeout(() => finish(reject, new Error(`ssh exec timeout: ${finalCmd}`)), timeoutMs);

    c.on('ready', () => {
      c.exec(finalCmd, (err, stream) => {
        if (err) return finish(reject, err);
        let stdout = '';
        let stderr = '';
        stream.on('data', (d) => (stdout += d.toString()));
        stream.stderr.on('data', (d) => (stderr += d.toString()));
        stream.on('close', (code) => {
          if (code !== 0) return finish(reject, new Error(stderr.trim() || `exit code ${code}`));
          finish(resolve, { stdout, stderr });
        });
      });
    });
    c.on('error', (err) => finish(reject, err));
    c.connect(conn);
  });
}

/** 经 sftp 写文件(覆盖)。conn.sudo 时:暂存到 /tmp 后 sudo install 到目标(普通用户写不了 /etc) */
export function writeFile(conn, remotePath, content) {
  if (conn.sudo) {
    const name = remotePath.split('/').pop() || `f${Date.now()}`;
    const stage = `/tmp/panel-stage-${process.pid}-${Date.now()}-${name}`;
    return sftpWrite(conn, stage, content).then(() =>
      exec(conn, `install -m 600 '${stage}' '${remotePath}' && rm -f '${stage}'`),
    );
  }
  return sftpWrite(conn, remotePath, content);
}

function sftpWrite(conn, remotePath, content) {
  return new Promise((resolve, reject) => {
    const c = new Client();
    let settled = false;
    const finish = (fn, ...args) => {
      if (settled) return;
      settled = true;
      c.end();
      fn(...args);
    };
    c.on('ready', () => {
      c.sftp((err, sftp) => {
        if (err) return finish(reject, err);
        const ws = sftp.createWriteStream(remotePath);
        ws.on('error', (e) => finish(reject, e));
        ws.on('close', () => finish(resolve));
        ws.end(content);
      });
    });
    c.on('error', (err) => finish(reject, err));
    c.connect(conn);
  });
}

/** SSH 连通性测试(echo ok);exec 可注入以便测试 */
export async function testConnection(conn, execFn = exec) {
  try {
    const r = await execFn(conn, 'echo ok', 15000);
    return { ok: r.stdout.trim() === 'ok', message: JSON.stringify(r) };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

export const ssh = { buildConn, exec, writeFile, testConnection };
