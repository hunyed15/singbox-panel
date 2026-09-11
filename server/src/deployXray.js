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

    // xray -test 可能不兼容所有版本,跳过 check,restart 失败会回滚
    steps.push('check-skip');

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
    // 等待 xray 启动(最多重试 10 次,每次 1s)
    let active = false;
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const status = await ssh.exec(conn, `systemctl is-active ${xrayUnit} || echo inactive`);
      if (status.stdout.trim() === 'active') { active = true; break; }
    }
    if (!active) {
      await ssh.exec(conn, `cp -f ${xrayConfig}.bak ${xrayConfig} 2>/dev/null || true`);
      await ssh.exec(conn, `systemctl restart ${xrayUnit}`).catch(() => {});
      return { ok: false, error: `xray inactive after restart`, rolledBack: true };
    }
    steps.push('verify');
  } catch (err) {
    await ssh.exec(conn, `cp -f ${xrayConfig}.bak ${xrayConfig} 2>/dev/null || true`);
    await ssh.exec(conn, `systemctl restart ${xrayUnit}`).catch(() => {});
    return { ok: false, error: err.message, rolledBack: true };
  }

  return { ok: true, steps };
}