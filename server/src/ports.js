import { ApiError } from './errors.js';

/** 常见代理/Web 端口黑名单(避免明显指纹),其余全随机 */
const AVOID = new Set([
  21, 22, 23, 25, 53, 80, 81, 110, 143, 443, 465, 587, 853, 1080, 1194, 1433, 1521, 3306, 3389,
  5432, 6379, 8080, 8081, 8443, 8888, 9090, 10808, 10809,
]);

/** 从 base 起返回第一个未被占用的端口 */
export function nextFreePort(usedPorts, base = 31001) {
  let port = base;
  while (usedPorts.includes(port)) port += 1;
  return port;
}

/** 完全随机分配端口(默认 20000-65000,避开已用与常见端口);与手动的 base 递增区分 */
export function randomFreePort(usedPorts, min = 20000, max = 65000) {
  const used = new Set(usedPorts);
  for (let i = 0; i < 500; i++) {
    const p = min + Math.floor(Math.random() * (max - min + 1));
    if (!used.has(p) && !AVOID.has(p)) return p;
  }
  for (let p = min; p <= max; p++) {
    if (!used.has(p) && !AVOID.has(p)) return p;
  }
  return min;
}

/** 同机端口唯一校验;excludeNodeId 用于编辑时排除自身 */
export function assertPortFree(db, serverId, port, excludeNodeId = null) {
  const row = db
    .prepare('SELECT id FROM nodes WHERE server_id = ? AND listen_port = ? AND id != ?')
    .get(serverId, port, excludeNodeId ?? -1);
  if (row) {
    throw new ApiError(409, `端口 ${port} 已被该机器上其他节点占用`);
  }
}
