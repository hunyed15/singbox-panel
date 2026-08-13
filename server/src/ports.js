import { ApiError } from './errors.js';

/** 从 base 起返回第一个未被占用的端口 */
export function nextFreePort(usedPorts, base = 31001) {
  let port = base;
  while (usedPorts.includes(port)) port += 1;
  return port;
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
