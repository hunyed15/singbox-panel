# SingBox 个人中转面板 — 设计文档

日期：2026-08-11
状态：待用户审阅

## 1. 背景与目标

用户有 6 台 Linux 服务器用于科学上网，全部由 v2ray 核心转向 sing-box 核心，并希望搭建一个个人自用的 Web 管理面板，替代手动修改配置：

| 服务器 | 地区 | 角色 |
|---|---|---|
| 1, 2 | 香港 | 中转机（入口，客户端接入点） |
| 3 | 韩国 | 主落地机 |
| 4, 5, 6 | 韩国/日本/美国/香港 | 备用落地机 |

核心诉求：**中转链路**（如 1→3 表示客户端从中转机 1 进入、从落地机 3 出网），类似 [qing-zhou](https://github.com/mllt992/qing-zhou) 的链路能力，但**去掉付费、多用户、订阅计费**等商业化逻辑，纯个人自用。

管理面板部署在一台节点机上（计划为 3 号，可换）。

## 2. 已确认的需求决策

| 决策项 | 结论 |
|---|---|
| 节点控制方式 | 中心面板机通过 **SSH** 连接各落地机，推送 sing-box 配置并 reload；被控机无需额外 agent |
| 技术栈 | 后端 Node.js（Express + ssh2 + better-sqlite3），前端 Vue 3 + Vite |
| 入口协议（客户端→中转机） | **VLESS + Reality**（无证书、抗封锁） |
| 中转链路协议（中转机→落地机） | **shadowsocks-2022**（不过 GFW，简单即可） |
| 链路模型 | 固定入口机（1/2）+ 可选落地机（3/4/5/6），每条链路 = 中转机上独立入站端口 |
| 订阅 | 双格式：base64(v2rayN) + sing-box json，单条订阅链接经 User-Agent 或参数区分 |
| 监控 | 仅状态与在线探测（不采集系统资源） |
| 面板安全 | 单管理员登录 + 建议反代 HTTPS |
| 凭据管理 | 面板自动生成随机端口/密码，入库绑定节点 |
| 迁移 | 全新搭建，弃用旧 v2ray 节点 |

## 3. 架构总览

```
浏览器 (管理员)
    │  HTTPS
    ▼
[面板: Node.js + Vue3 + SQLite]   ← 中心机（3 号或任一台）
    │  SSH (libssh2/ssh2, 私钥认证)
    ├──► [中转机 1/2: sing-box]
    └──► [落地机 3/4/5/6: sing-box]
```

- 面板与 sing-box **允许同机**（中心机同时也是落地机 3）。
- 流量路径：`客户端 ──VLESS+Reality──▶ 中转机 ──ss-2022──▶ 落地机 ──▶ 互联网`。
- 面板只负责生成 `config.json`、SSH 推送、reload、读状态；**不承担流量转发，也不读流量统计**（V1 不做）。

## 4. 核心链路设计

### 4.1 单条链路（1→3）的配置拆分

**中转机 1**：
```jsonc
{
  "inbounds": [
    {
      "type": "vless",
      "listen": "::",
      "port": 31001,            // 该链路独立端口，接口唯一凭据
      "users": [{ "uuid": "...", "flow": "xtls-rprx-vision" }],
      "tls": { "enabled": true, "server_name": "www.microsoft.com",
               "reality": { "enabled": true, "handshake": { "server": "www.microsoft.com", "port": 443 },
                            "private_key": "...", "short_id": ["..."] } }
    }
  ],
  "outbounds": [
    { "type": "direct", "tag": "direct" },
    { "type": "shadowsocks", "tag": "landing-3",            // 中转链路出站
      "server": "1.2.3.4", "server_port": 32001,
      "method": "2022-blake3-aes-128-gcm", "password": "..." }
  ],
  "route": { "rules": [{ "inbound": ["31001"], "outbound": "landing-3" }], "final": "direct" }
}
```

**落地机 3**：
```jsonc
{
  "inbounds": [
    { "type": "shadowsocks", "listen": "::", "port": 32001,   // 一个共享入站
      "method": "2022-blake3-aes-128-gcm", "password": "..." }
  ],
  "outbounds": [{ "type": "direct", "tag": "direct" }],
  "route": { "rules": [], "final": "direct" }
}
```

### 4.2 关键不变式

1. **落地机入站是"共享"的**：多台中转机可同时 detour 到同一落地机同一入站（同样式凭据），落地机只需一份配置。
2. **每链路口径唯一**：一条链路在中转机上占用一个独立入站端口（31001, 31002, ...），凭据（UUID）各自独立，互不影响；客户端连不同端口即选择不同落地。
3. **中转机 reload 而非频繁重启**：入站端口凭据变化 → 面板重新生成整机 config → 原子替换 → `systemctl reload sing-box`（或 SIGHUP）。
4. **Reality 凭据按中转机共享**：一台中转机的所有链路共用同一套 Reality 私钥/short_id（借大站 SNI），端口不同即可，客户端只需区分端口。
5. **拉直原则**：同一服务器同时存在多条链路时，合并进一份 config 一次下发。

## 5. 数据模型（SQLite）

```
servers            # 6 台机器
  id, name, role(relay|landing), host, ssh_port, ssh_user,
  ssh_auth_type(key|password), ssh_auth_secret(加密存储),
  region, ping_status(online|offline|unknown), singbox_version, last_seen

relay_settings      # 中转机专属（role=relay 时必有一条）
  id, server_id, uuid, reality_public_key, reality_private_key, short_id,
  dest_sni,          # 借用的 Reality 目标域名，默认 www.microsoft.com
  port_base          # 链路端口起始（如 31000）

landing_settings    # 落地机专属（role=landing 时必有一条）
  id, server_id, in_port,          # 共享入站端口，如 32001
  method, password                # ss-2022 method + 密码

links              # 链路 = 一个订阅节点
  id, name, relay_server_id, landing_server_id,
  relay_listen_port, enabled,      # 停用则订阅剔除且不生成/不保留入站
  uuid,                            # 独立用户凭据
  note, created_at

settings           # 面板自身配置
  key TEXT PRIMARY KEY, value TEXT  # 订阅 URL slug、面板端口、背书域名等
```

凭据存储：`reality_private_key`、`ssh_auth_secret` 使用 **AES-256-GCM** 加密后入库，主密钥来自环境变量 `APP_SECRET`。

## 6. 功能范围（V1）

### 6.1 服务器管理
- CRUD 六台机器，配置 host / SSH 端口 / 用户 / 认证（私钥内容或密码，均加密存储）。
- 录入角色（relay/landing）并生成对应专属配置凭据。
- SSH 连接/连通性测试按钮。

### 6.2 链路管理
- 创建链路：选入口机（relay）+ 落地机（landing），面板自动分配端口 + UUID，可设名称。
- 链路列表：显示 name、入口→落地、端口、状态（启用/停用）、在线。
- 启停：停用即从中转机 config 移除该入站并从订阅剔除。
- **调用动作**：任一中转机配置变化 → 面板重算该机 config → SSH 推送 → reload；落地机凭据不变则不动。

### 6.3 状态监控（轻量）
- 面板定时（如 60s）对每台机 SSH 执行 `sing-box version` 与 `systemctl is-active sing-box`，获得：在线状态、sing-box 运行状态、版本号、面板最近探测时间。
- 列表页展示，不做系统资源采集。

### 6.4 订阅
- 单条订阅链接：`/sub/<slug>`，`slug` 存 settings。
- 输出格式：默认按 `User-Agent` 判定，v2rayN 系返回 base64 分享链接列表；sing-box 客户端返回 sing-box json 配置模板；支持 `?format=base64|singbox|clash` 强制指定。
- 订阅内容 = 当前所有 `enabled=true` 的链路；建链/停链后客户端重新拉取即生效。
- 客户端看到的每条链路是一条 **`vless+reality` 节点**（指向对应中转机 + 本链路端口），中转链路（ss-2022）对客户端完全透明。

### 6.5 鉴权
- 单管理员账号，启动时初始化（env 或首启表单），密码 bcrypt。
- 登录态 JWT cookie；除 `/sub/<slug>` 与 `/api/health` 外全部 API 需登录。
- 面板建议通过 Nginx/Caddy 反代提供 HTTPS（文档提供示例）。

### 6.6 不做（明确排除）
- 多用户 / 计费 / 套餐 / 流量统计
- 系统资源（CPU/内存/磁盘）监控
- 任意多级串联（仅固定入口→落地两级）
- 客户端侧模板定制（不暴露 Clash 配置模板编辑）
- 节点自动测速（客户端自己做）

## 7. 后端结构（Node.js）

建议目录（Express + ES modules）：
```
server/
  src/index.js            # 入口，装配
  src/config.js           # env 解析
  src/db.js               # SQLite 初始化（better-sqlite3）
  src/auth.js             # JWT + 登录路由
  src/crypto.js           # AES-256-GCM 加解密 + 凭据生成
  src/ssh.js              # ssh2 封装：connect / exec / sftp 写文件
  src/sbconfig/           # sing-box 配置生成（纯函数，可单测）
    index.js  relay.js  landing.js  share.js
  src/deploy.js           # 编排：生成→校验→推送→reload（含失败回滚）
  src/probe.js            # 定时探测循环
  src/sub.js              # 订阅 / 分享链接转换（base64 / singbox json）
  src/routes/             # api.servers / api.links / api.deploy / api.probe / api.sub / auth
  test/
```

前端：Vue 3 + Vite + 简单组件库（Element Plus 或手写），页面：登录、服务器列表、链路列表/新建、订阅页（复制链接+格式切换）、节点状态。

## 8. 部署与安全

- 面板以 systemd 运行在中心机，`APP_SECRET` 从 env 读取。
- SSH：优先使用私钥；生产建议面板对 sing-box 端口的管理通过受限用户（可选，V1 文档给建议即可不强制）。
- 域名绑定：Reality dest_sni 默认 `www.microsoft.com`（可配置）；不需要自有证书。
- 首次登录：创建管理员账号（`--setup` 或首启页面）。
- 提供 `deploy/` 目录：systemd unit、nginx 反代示例、安装笔记。

## 9. 测试策略

- **单元测试**（Jest/vitest）：sbconfig 生成函数——给定服务器/链路数据 → 输出期待中的 config JSON（快照测试关键字段：端口、detour 指向、reality 字段、落地入站样式）。
- **链路路由规则测试**：出口路由（inbound 端口→landing outbound）正确性。
- **订阅转换测试**：base64 与 singbox json 往返一致，UA 与 format 参数分派正确。
- **凭据加解密**：AES-GCM 加解密往返。
- **集成（可选，手动文档）**：本地起 dev 面板 → 连真实机器 → 建链 → 客户端验证连通。

## 10. 风险与开放项

1. **Reload 行为**：sing-box `systemctl reload` 对端口/config 变更的支持需在落地机器实测（文档记录正确 reload 方式）。
2. **Reality 大站借用**：个别大站可能拒绝握手（风险低）；dest_sni 可配置应对。
3. **ss-2022 兼容性**：确认 v2rayN/客户端对 `2022-blake3-aes-128-gcm` 支持（均支持）；若个别客户端不支持则降级为 `aes-128-gcm`。
4. **订阅 base64 vs singbox json 由客户端决定**：文档需写明各客户端该用哪个格式。
5. **面板与落地同机**：中心机 3 号同时是落地，其 config 由面板本机生成后写入本机 sing-box，仍需 SSH 或本地 systemd 调用——V1 统一走 SSH（到本机），避免双路径。

## 11. 交付物

- Node.js 后端（含测试）+ Vue3 前端 + SQLite 迁移。
- 部署文档：`docs/部署.md`（含 systemd、nginx、首次建链步骤、客户端订阅指引）。
- 一键手动初始化脚本：安装 sing-box、面板 systemd、示例 env。