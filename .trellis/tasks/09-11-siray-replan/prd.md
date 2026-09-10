# Siray-Panel — 双核心( SingBox + Xray )节点管理面板 — 设计文档

日期: 2026-09-11 (第三次修订,基于双核心实际部署反馈重构)
状态: 规划中

## 1. 项目介绍

Siray-Panel (SingBox + Xray 合称) 是一个**个人自用的双核心节点管理面板**:
在一台中心机上部署,通过 SSH 集中管理多台 Linux 服务器上运行的 sing-box 与 Xray-core,
通过 Web 界面完成「服务器管理 → 节点创建 → 配置下发 → 订阅导出」全流程。

### 命名

- **Siray** = Sing-box + Xray 的组合词
- 项目仍用 `singbox-panel` 仓库名,品牌概念升级为 siray-panel

### 定位

个人版的 3x-ui / xray-ui,但:
- 双核心并存,非二选一
- 砍掉商业化逻辑(多用户、计费、套餐、流量统计、到期)
- 单管理员、纯自用
- SSH 直连管理,无需在机器上装 agent(V1)

## 2. 核心架构变化(V2 方向)

### 当前已验证可行

| 能力 | 状态 |
|------|------|
| SingBox 节点管理(11 模板) | ✅ 生产可用 |
| Xray 节点管理(6 模板) | ✅ 生产可用 |
| 双核心同机共存 | ✅ 已验证 |
| SingBox 中转(ss-2022 落地) | ✅ 生产可用 |
| Xray 直连节点 | ✅ 生产可用 |
| 分开订阅 | ✅ 生产可用 |
| 服务器状态检查(双核心) | ✅ 生产可用 |

### 当前问题

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| Xray 中转部署后 xray 进程 crash | xray shadowsocks 入站配置格式踩坑,端口与 sing-box 冲突 | **改为 iptables TCP 端口转发实现中转,入口机不运行核心** |
| 节点改动后需逐个下发 | 目前改动单个节点只触发关联机器 | **添加「一键同步全部配置」按钮** |
| 节点是否可用只能客户端测 | 无面板侧检测 | **添加节点连通性测试(端口可达性/TLS 握手/协议探测)** |
| 部分机器需要 sudo | Oracle 等只有 ubuntu 用户 | ✅ 已有 ssh_sudo 字段,已验证可用 |

## 3. 中转方案重设计: TCP 端口转发

### 当前方案(协议级中转,即将废弃)

```
客户端 → 入口机(核心入站) → ss-2022/AEAD → 落地机(核心入站) → 互联网
```

问题:入口机需要跑核心 + 中转协议,落地机也要跑核心入站,双核心时配置复杂到难以维护。

### 新方案(端口转发中转)

```
客户端 → 入口机(iptables DNAT) ────→ 落地机(核心入站) → 互联网
          ↑ 纯 TCP 转发,无核心         ↑ 节点协议,只跑一个核心
```

**规则示例**:
```bash
# 在入口机上执行:把所有发到 31001 端口的 TCP 流量转到落地机
iptables -t nat -A PREROUTING -p tcp --dport 31001 -j DNAT --to-destination 落地IP:31001
```

### 新方案的巨大优势

| 维度 | 旧方案 | 新方案 |
|------|--------|--------|
| 入口机负担 | 跑核心,占内存/CPU | 零负担,内核级转发 |
| 核心兼容 | 入口机和落地机必须同一种核心 | 任意核心都行,转发不感知协议 |
| 协议支持 | 受限于中转协议的加密方式 | 所有协议全通 |
| 配置复杂度 | 入口+落地双配置 | 只需要落地机有节点配置 |
| 故障排查 | 核心配置对不上就挂 | iptables 规则简单到不行 |

### 中转节点在面板中的形态

不再是「一个协议节点」,而是**一条端口转发规则**:

```
新建中转 → 选入口机 → 选落地机 → 选落地机上的目标节点(端口) → 自动分配入口机端口 → 生成 iptables 规则
```

面板只负责:
1. SSH 到入口机写入 iptables 规则
2. 记录规则到数据库
3. 展示规则列表

## 4. 一键同步部署

### 现状

每个节点改动只部署关联机器,全量多选需要手动触发。

### 目标

**「部署全部配置」按钮**,点击后:

1. 遍历所有服务器
2. 对每台机器:
   - 收集该机器上所有 sing-box 节点(不论启用与否,统一生成)
   - 收集该机器上所有 xray 节点
   - 合并生成 config.json
   - 校验 → 备份 → 原子替换 → reload/restart
3. 返回每台机器的部署结果(成功/失败+错误)

### 位置

服务器页 → 顶部操作栏 → 「部署全部」按钮

## 5. 节点连通性测试

### 目标

在面板上快速判断一个节点是否可用,不依赖客户端。

### 实现方式(V1 简单版)

| 节点类型 | 测试方式 |
|----------|----------|
| TCP 协议(VMess/VLESS/Trojan/SS/HTTP/SOCKS) | `nc -zv 节点IP 端口` 检查端口开放 |
| TLS 协议(VMess+TLS/Trojan+TLS) | `openssl s_client -connect IP:PORT -servername SNI` 检查 TLS 握手 |
| Reality 协议 | 仅端口检测(无法模拟完整握手) |
| 分享链接 | 解析链接后做对应协议的端口检测 |

### 位置

节点页 → 每行末尾 → 「测速」按钮 → 显示延迟 ms / ❌不可达

## 6. SSH 权限管理

### 现状

已有 `ssh_sudo` 字段,部分命令自动加 `sudo -n` 前缀。
命令执行有 30s 超时,大文件下载可能超时。

### 改进方向

| 改进点 | 说明 |
|--------|------|
| 超时可配置 | 安装 xray(大 zip)超时可调大 |
| 命令执行失败提示 | 当前 exit code 无详细错误 |

## 7. 数据模型变更(规划)

### 新表: `port_forwards` (端口转发中转)

```sql
CREATE TABLE IF NOT EXISTS port_forwards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  entry_server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  landing_server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  target_node_type TEXT NOT NULL CHECK(target_node_type IN ('singbox','xray')),
  target_node_id INTEGER NOT NULL,
  entry_port INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE(entry_server_id, entry_port)
);
```

不直接引用 nodes/xray_nodes 的外键(因为两种核心不同表),而是用 `target_node_type + target_node_id` 组合定位。

### 扩展: 节点连通性结果(临时,不落库)

节点测速结果仅运行时返回,不存储历史。

## 8. 不再做的

| 功能 | 原因 |
|------|------|
| Xray 协议级中转(shadowsocks relay outbound) | 端口转发方案更优 |
| Hysteria2/TUIC/ShadowTLS 的 xray 支持 | xray-core 不支持这些协议 |
| 多用户/计费/流量统计 | 面板定位是纯自用 |
| Agent 模式(V1) | 后续扩展,看需求 |
| 客户端路由规则生成(geoip/geosite) | 客户端自己做 |

## 9. 迭代路线图

### V2.0 (本次规划范围)

1. ✅ 落地机 xray 恢复运行(修复 ss inbound 格式)
2. 实现端口转发式中转(iptables DNAT)
3. 一键部署全部按钮
4. 节点连通性测试(端口级)

### V2.1 (后续)

1. 在线测速(真实延迟探测)
2. iptables 规则持久化
3. 防火墙规则管理界面

## 10. 接受标准

- [ ] 落地机 xray 正常运行,所有直连节点连通
- [ ] 端口转发中转:入口机 iptables 规则创建/删除/列表
- [ ]「部署全部」按钮一键下发所有机器配置
- [ ] 节点测速:端口可达/TLS 握手检测
- [ ] 现有 sing-box 功能零回归