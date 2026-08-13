/**
 * 配置下发编排:生成 → 校验(sing-box check,失败不触碰现网)→ 备份 → 原子替换 → reload。
 * reload 失败 → 恢复备份 + 再 reload → 返回 rolledBack:true。ssh 由调用方注入(可测试)。
 */

const DEFAULT_TMP = '/tmp/singbox-panel';

export async function deployMachine(ssh, conn, config, { singboxBin, singboxConfig, singboxUnit, tmpDir = DEFAULT_TMP }) {
  const steps = [];
  const json = JSON.stringify(config, null, 2);

  try {
    await ssh.exec(conn, `mkdir -p ${tmpDir}`);
    steps.push('mkdir');

    await ssh.writeFile(conn, `${tmpDir}/config.json`, json);
    steps.push('upload');

    await ssh.exec(conn, `${singboxBin} check -c ${tmpDir}/config.json`);
    steps.push('check');

    await ssh.exec(conn, `cp -f ${singboxConfig} ${singboxConfig}.bak 2>/dev/null || true`);
    steps.push('backup');

    await ssh.exec(conn, `install -m 600 ${tmpDir}/config.json ${singboxConfig}`);
    steps.push('install');
  } catch (err) {
    // 校验/备份/安装阶段失败:现网未动,直接返回失败(不标记回滚)
    return { ok: false, error: err.message, rolledBack: false };
  }

  try {
    await ssh.exec(conn, `systemctl reload ${singboxUnit}`);
    steps.push('reload');
  } catch (err) {
    const msg = err.message || '';
    if (msg.includes('not applicable')) {
      // unit 无 ExecReload(旧机器)→ 配置已 check 通过,restart 应用即可,不算失败
      await ssh.exec(conn, `systemctl restart ${singboxUnit}`);
      steps.push('restart-fallback');
    } else {
      // 真实失败:回滚(恢复备份 + 再 reload,失败不抛出,保留现场)
      await ssh.exec(conn, `cp -f ${singboxConfig}.bak ${singboxConfig} 2>/dev/null || true`);
      await ssh.exec(conn, `systemctl reload ${singboxUnit}`).catch(() => {});
      return { ok: false, error: err.message, rolledBack: true };
    }
  }

  return { ok: true, steps };
}
