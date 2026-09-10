# Siray-Panel V2 技术设计

## 1. 端口转发中转(iptables DNAT)

### 1.1 核心流程

```
用户操作: 新建中转 → 选入口机 → 选落地机 → 选目标节点(端口) → 提交

面板动作:
  1. 分配入口机空闲端口(自动或手动)
  2. SSH 到入口机执行:
     iptables -t nat -A PREROUTING -p tcp --dport {entry_port} \
              -j DNAT --to-destination {landing_host}:{target_port}
     iptables -t nat -A PREROUTING -p udp --dport {entry_port} \
              -j DNAT --to-destination {landing_host}:{target_port}   # 可选,UDP 协议
     iptables -A FORWARD -p tcp -d {landing_host} --dport {target_port} -j ACCEPT
  3. 持久化: iptables-save > /etc/iptables/rules.v4
  4. 写入 port_forwards 表
```

### 1.2 数据模型

```sql
CREATE TABLE IF NOT EXISTS port_forwards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  entry_server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  landing_server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  target_node_type TEXT NOT NULL CHECK(target_node_type IN ('singbox','xray')),
  target_node_id INTEGER NOT NULL,
  entry_port INTEGER NOT NULL,
  target_port INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(entry_server_id, entry_port)
);
```

### 1.3 API 接口

```
GET    /api/port-forwards              → 列表(含入口机名/落地机名/目标节点名)
POST   /api/port-forwards              → 创建(面板 SSH 写 iptables + 持久化)
DELETE /api/port-forwards/:id          → 删除(面板 SSH 删除 iptables 规则)
```

创建请求体:
```json
{
  "name": "CoreNet→Dedirock-VLESS",
  "entryServerId": 3,
  "landingServerId": 1,
  "targetNodeType": "xray",
  "targetNodeId": 75,
  "entryPort": 31001
}
```

### 1.4 前端

**新页面: 中转规则**
- 表头: 名称 / 入口机 / 入口端口 / 落地机 / 目标节点 / 状态(启用/停用)
- 新建弹窗: 选入口机→选落地机→选目标节点(展示该机所有节点,标注核心类型)→选/填端口
- 删除: 确认二次,SSH 删除 iptables 规则

### 1.5 安全与持久化

- iptables 规则重启后消失,需要在入口机安装 `iptables-persistent`
- 面板在创建规则后自动执行 `iptables-save > /etc/iptables/rules.v4`
- 错误处理: SSH 写规则失败 → 回滚(不加规则) → 返回失败

### 1.6 注意事项

- IPv6 机器: 用 `ip6tables` 代替 `iptables`
- 同时支持 TCP+UDP 转发(可选,默认仅 TCP)
- 入口机需要开启 `net.ipv4.ip_forward=1`

---

## 2. 一键部署全部配置

### 2.1 流程

```
点击「部署全部」→ 后端:
  1. 查询所有 control='ssh' 的服务器
  2. 并行(并发 ≤3)对每台机器:
     a. 收集该机 sing-box 节点
     b. 收集该机 xray 节点
     c. 生成 sing-box config.json
     d. 生成 xray config.json
     e. 分别部署(校验→备份→替换→reload)
     f. 记录结果
  3. 返回每台机器的部署结果
```

### 2.2 API

```
POST /api/deploy/all → { results: [{ serverId, serverName, singbox: {ok,error}, xray: {ok,error} }] }
```

### 2.3 前端

- 服务器页顶部「部署全部」按钮
- 点击后显示进度: `正在部署 CoreNet... sing-box ✅ xray ✅`
- 完成后展示结果汇总

---

## 3. 节点连通性测试

### 3.1 测试逻辑

```
后端收到测试请求 → 从面板所在机器执行:
  1. 解析目标节点信息(host, port, protocol)
  2. TCP 端口测试:
     nc -zv -w5 {host} {port}
  3. TLS 协议(如适用,增加 TLS 握手检测):
     openssl s_client -connect {host}:{port} -servername {sni} -tlsextdebug 2>&1 | grep -q 'SSL handshake'
  4. 返回结果: { ok, latency_ms, detail }
```

### 3.2 API

```
POST /api/nodes/:id/test  → 测试 sing-box 节点(需 type=singbox)
POST /api/xray/nodes/:id/test  → 测试 xray 节点
```

响应:
```json
{ "ok": true, "latency_ms": 45, "detail": "TCP connected, TLS handshake OK" }
{ "ok": false, "latency_ms": null, "detail": "Connection refused" }
```

### 3.3 前端

- 节点页每行末尾添加「测速」按钮
- 点击后显示旋转动画,完成后显示延迟 ms 或 ❌

---

## 4. 恢复落地机 xray 运行(当前紧急问题)

### 4.1 问题根因

xray 的 shadowsocks 入站配置中使用了 `network: 'tcp,udp'` 字段,
该字段在 xray-core 的 inbound 中不被支持,导致 xray 解析 config 失败而退出。

### 4.2 修复

已修复 `server/src/xrayconfig/inbound.js`:
- 移除 shadowsocks inbound 的 `network` 字段
- 移除 landing inbound 的 `network` 字段

### 4.3 需要执行

1. 重新安装所有机器的 xray(清掉旧 config)
2. 重新部署所有 xray 节点配置

---

## 5. SSH 执行改进

### 5.1 问题

当前 `deployXrayMachine` 中 xray 校验命令(`xray -test`)与部分 xray 版本不兼容,
导致配置部署后 xray crash,但 deploy 返回 OK(因 `systemctl restart` 本身不报错)。

### 5.2 修复

```javascript
// 在 deployXrayMachine 的 restart 步骤后,增加状态检查:
await ssh.exec(conn, `systemctl is-active ${xrayUnit}`);
// 如果返回非 active,视为部署失败
```