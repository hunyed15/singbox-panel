import { Client } from 'ssh2';

/** 按服务器行组装 ssh2 连接参数(凭据解密后使用) */
export function buildConn(serverRow, decrypt, appSecret) {
  const base = {
    host: serverRow.host,
    port: serverRow.ssh_port || 22,
    username: serverRow.ssh_user || 'root',
  };
  const secret = decrypt(appSecret, serverRow.ssh_auth_secret);
  if (serverRow.ssh_auth_type === 'password') {
    return { ...base, password: secret };
  }
  return { ...base, privateKey: secret };
}

/** 远程执行命令;exit code 非 0 或超时 → reject。超时由调用方控制(默认 30s)。 */
export function exec(conn, cmd, timeoutMs = 30000) {
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
    const timer = setTimeout(() => finish(reject, new Error(`ssh exec timeout: ${cmd}`)), timeoutMs);

    c.on('ready', () => {
      c.exec(cmd, (err, stream) => {
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

/** 经 sftp 写文件(覆盖) */
export function writeFile(conn, remotePath, content) {
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
