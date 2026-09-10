/**
 * Xray 配置下发:生成 → 校验(xray run -test)→ 备份 → 原子替换 → restart。
 * restart 失败 → 恢复备份 + 再 restart → 返回 rolledBack:true。
 * xray 不支持 HUP reload,故用 restart。
 */

const DEFAULT_TMP = '/tmp/xray-panel';

export async function deployXrayMachine(ssh, conn, config, { xrayBin, xrayConfig, xrayUnit, tmpDir = DEFAULT_TMP }) {
  const steps = [];
  const json = JSON.stringify(config, null, 2);

  try {
    await ssh.exec(conn, `mkdir -p ${tmpDir}`);
    steps.push('mkdir');

    await ssh.writeFile(conn, `${tmpDir}/config.json`, json);
    steps.push('upload');

    // xray 校验:试两种参数格工
    try {
      await ssh.exec(conn, `${xrayBin} run -test -c ${tmpDir}/config.json`);
    } catch {
      try {
        await ssh.exec(conn, `${xrayBin} -test -config ${tmpDir}/config.json`);
      } catch (testErr) {
        return { ok: false, error: `check: ${testErr.message}`, rolledBack: false };
      }
    }
    steps.push('check');

    await ssh.exec(conn, `cp -f ${xrayConfig} ${xrayConfig}.bak 2>/dev/null || true`);
    steps.push('backup');

    await ssh.exec(conn, `mkdir -p $(dirname ${xrayConfig})`);
    await ssh.exec(conn, `install -m 600 ${tmpDir}/config.json ${xrayConfig}`);
    steps.push('install');
  } catch (err) {
    return { ok: false, error: err.message, rolledBack: false };
  }

  try {
    await ssh.exec(conn, `systemctl restart ${xrayUnit}`);
    steps.push('restart');
  } catch (err) {
    await ssh.exec(conn, `cp -f ${xrayConfig}.bak ${xrayConfig} 2>/dev/null || true`);
    await ssh.exec(conn, `systemctl restart ${xrayUnit}`).catch(() => {});
    return { ok: false, error: err.message, rolledBack: true };
  }

  return { ok: true, steps };
}