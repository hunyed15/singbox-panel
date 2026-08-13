# SingBox 个人中转面板 — 设计文档

日期:2026-08-11(第二次修订)
状态:已按产品讨论更新(节点模型 / 模板制 / 双控制方式 / Reality 域名库)

## 1. 项目介绍

SingBox 面板是一个**个人自用的 sing-box 节点管理面板**:在一台中心机上部署,集中管理多台 Linux 服务器上运行的 sing-box,通过 Web 界面完成「服务器管理 → 节点创建 → 配置下发 → 订阅导出」的全流程,替代手工编辑每台机器的 `config.json` 与 SSH 操作。

项目的形态定位是**个人版的 3x-ui / xray-ui**:

- 保留 3x-ui 系「网页可视化建节点、分享链接、订阅」的核心体验,但砍掉一切商业化逻辑(多用户、计费、套餐、流量统计、到期),单管理员、纯自用;
- 核心引擎是 **sing-box**(而非 xray-core):用户现有 6 台服务器已从 v2ray 转向 sing-box,面板与客户端链路统一在 sing-box 生态;
- 节点创建采用**模板制(傻瓜式)**:不暴露协议参数细节,选一张模板卡片 → 填名称与入口机 → 一键生成(端口、UUID/密码、Reality 密钥、自签证书全部自动),需要时再展开高级设置;
- 支持**中转链路**这一机场级能力:节点可配置「出口」——直连本机,或经中转机(入口)→ 落地机出网,客户端只感知一个普通节点;
- 节点控制 **V1 以 SSH 为主**(面板直连,机器端零组件);Agent 脚本注册留作后续扩展,供面板不可达(如 NAT)的机器使用。面板统一执行 安装/重启/卸载 sing-box 与配置下发。

## 2. 解决的问题

| 痛点 | 本项目的解法 |
|---|---|
| 手工 SSH 编辑每台机器的 sing-box 配置,易错、重复、无法审计 | 面板统一生成配置并原子下发(生成 → 校验 → 推送 → reload,失败回滚) |
| 客户端接入需要中转链路(入口机 → 落地机),手工配 detour/路由极易搞错 | 节点模型内置「出口 = 直连 / 经中转机→落地机」,面板自动生成 route 规则 |
| 不同客户端/网络环境需要不同协议(VLESS+Reality、VMess+TLS、SS、SOCKS…),配置形态五花八门 | 7 个协议模板,选卡片即建即用,端口/凭据/密钥/证书全自动 |
| Reality 借站域名固定写死,某个大站握手失败时无从下手 | 内置大厂域名库(可加/编辑/删除),新建节点时下拉选择 SNI |
| 订阅管理混乱,客户端导入困难 | 单条订阅链接,UA 自动判定 base64 / sing-box JSON,按协议输出分享链接 |
| 机器在 NAT 后面,面板无法通过 SSH 直连 | Agent 模式(后续扩展):机器上执行一次安装脚本即注册上线,无需任何入站端口 |
| 自建节点后凭据散落在各处,无记录 | 凭据(UUID/密码/Reality 密钥/自签证书)由面板生成并加密持有,客户端通过分享链接/订阅获取 |
| 面板本身是攻击面 | 单管理员 JWT 鉴权、凭据 AES-256-GCM 加密入库、建议反代 HTTPS |

## 3. 使用场景

1. **多机机场化管理(核心)**:6 台 VPS(2 台中转机 + 4 台落地机),在面板上建一条「VLESS+Reality 入口 → 中转 → KR3 落地」的节点,复制分享链接给设备,即用即走。
2. **中转链路选择**:客户端连不同端口即选择不同落地(端口即凭据),实现 HK 入口 + 韩/日/美/港多出口;停用某链路即从中转机配置移除并从订阅剔除。
3. **直连节点**:不想绕中转时,在落地机直接建节点、出口选「直连」,客户端直连落地机。
4. **多协议兼容**:主力设备用 VLESS+Reality;老客户端/特殊网络用 VMess+WS+TLS 或 Trojan+TLS;工具脚本/内网代理用 SOCKS/HTTP;弱网友好场景用 Hysteria。
5. **订阅导入**:v2rayN/Clash 拉 base64、sing-box/SFA/SFI 拉 JSON,一条订阅链接通吃;新节点/停用节点客户端重新拉取即生效。
6. **机器上线**:新买 VPS → 面板录入(SSH 模式,V1)→ 一键 安装/重启/卸载 sing-box;面板不可达的机器留待 Agent 扩展。
7. **借站切换**:某个 Reality 大站域名握手失败或不可达,在域名库换一个或新增,重建节点即可。
8. **IPv6 互通**:IPv6-only 机器(VPS/落地机)IPv4 客户端连不上 → 在双栈机器上建「隧道」节点,监听端口转发到 IPv6 目标,客户端连隧道端口即可(如转发到 IPv6 落地机的节点端口或任意服务)。

## 4. 背景与目标(保留)

| 服务器 | 地区 | 角色 |
|---|---|---|
| 1, 2 | 香港 | 中转机(入口,客户端接入点) |
| 3 | 韩国 | 主落地机 |
| 4, 5, 6 | 韩国/日本/美国/香港 | 备用落地机 |

面板部署在一台节点机上(计划为 3 号,可换)。流量路径:`客户端 ──节点协议(VLESS+Reality 等)──▶ 入口机 ──ss-2022──▶ 落地机 ──▶ 互联网`;直连节点则 `客户端 ──节点协议──▶ 落地机 ──▶ 互联网`。

## 5. 已确认的需求决策

| 决策项 | 结论 |
|---|---|
| 节点控制方式 | **V1 仅 SSH**:面板经 SSH 直连各机,推送配置并 reload,执行 安装/重启/卸载(机器端零组件,代码量最小);**Agent(脚本注册)留作后续扩展**——供面板不可达(如 NAT)的机器使用,前端保留控制方式字段,后端 V1 不实现 |
| 技术栈 | 后端 Node.js(Express + ssh2 + better-sqlite3);**前端 React + TypeScript + Vite + antd 6**(替代原定 Vue3+Element Plus) |
| 入口协议(客户端→节点) | **模板制 11 种**:VLESS+Reality / VMess+WS+TLS / Trojan+TLS / Shadowsocks-2022 / Hysteria / SOCKS / HTTP / **隧道(端口转发,sing-box direct 入站,支持 IPv4/IPv6/域名目标)** / **TUIC**(QUIC,自签证书)/ **ShadowTLS**(TLS 伪装借站,复用域名库,零证书)/ **Naive**(HTTP/2+TLS,自签,抗封锁价值有限,文档提示)。参照 3x-ui、qist/xray-ui 的入站体验但傻瓜式;客户端代理节点协议已覆盖主流 |
| 中转链路协议(入口→落地) | shadowsocks-2022(不过 GFW,简单即可) |
| 节点模型 | 每条节点 = 入站(协议/端口/凭据/TLS/传输)+ 出口(直连 direct / 中转 relay→落地机);「链路」概念泛化为节点,直连与中转统一 |
| Reality 借站域名 | **域名库管理**:内置大厂域名种子(微软/Apple/Google/Cloudflare/iCloud/Bing/Amazon/Yahoo),可加/编辑/删除;新建 VLESS+Reality 节点时下拉选择 SNI,默认 www.microsoft.com |
| 证书策略 | Reality 借站(零证书,SNI 自选);VMess/Trojan/TUIC/Naive 默认**面板自动生成自签证书**(客户端允许自签/允许不安全连接),「高级设置」可选**自有证书**(对齐 3x-ui/xray-ui 能力——两者均需手动填证书,比我们更繁琐);ShadowTLS 借站伪装零证书;SOCKS/HTTP 无 TLS |
| 节点编辑 | **V1 支持**:名称/备注/启停/出口(直连/中转+落地机)/SNI/端口/协议;改协议 = 凭据自动重新生成并提示「客户端需更新」 |
| 端口策略 | 创建时**自动分配并展示,可手动覆盖**(后端校验同机唯一),方便对齐已有防火墙规则 |
| 凭据管理 | 面板自动生成随机端口/UUID/密码/Reality 密钥/自签证书,加密入库绑定节点;客户端经分享链接/订阅获取 |
| 订阅 | 双格式:base64(按协议分享链接列表)+ sing-box JSON,UA 自动判定 + ?format 强制;SOCKS/HTTP 节点仅走 sing-box JSON |
| 监控 | **被动**:打开面板/点刷新时按需检查各机 sing-box 状态(SSH exec `sing-box version` + `systemctl is-active`),无常驻轮询;检查中显示「检查中」态,检查完缓存 |
| reload 失败 | **自动回滚**上一份配置 + 页面明确提示「已回滚」(deploy 已有备份能力) |
| 订阅使用范围 | 个人自用,不对外分享;slug 轮换能力保留(改 slug 旧链接立即失效),防公网扫描 |
| 面板安全 | 单管理员登录(JWT)+ 建议反代 HTTPS |
| 不做 | 多用户 / 计费 / 套餐 / 流量统计 / 到期 / 多级串联(仅入口→落地两级) |

## 6. 架构总览

```
浏览器 (管理员)
    │  HTTPS
    ▼
[面板: Node.js + React(antd) + SQLite]   ← 中心机
    ├──► SSH 模式:ssh2 直连各机(公网 VPS)
    └──► (后续扩展)Agent 模式:机器 install.sh 注册 → 轮询任务/回报心跳(NAT 友好)
             ▼
        [各机 sing-box: 生成 config.json → 原子替换 → reload]
```

- 面板只负责生成 `config.json`、下发(SSH exec)、读状态;**不承担流量转发,不读流量统计**。
- 允许面板与 sing-box 同机(中心机同时也是落地机 3,统一走 SSH 到本机,避免双路径)。

## 7. 核心配置设计

### 7.1 单节点(中转示例:VLESS+Reality 入口 → ss-2022 落地)

**入口机**:
```jsonc
{
  "inbounds": [
    { "type": "vless", "listen": "::", "port": 31001,
      "users": [{ "uuid": "...", "flow": "xtls-rprx-vision" }],
      "tls": { "enabled": true, "server_name": "<域名库所选 SNI>",
               "reality": { "enabled": true,
                            "handshake": { "server": "<SNI>", "port": 443 },
                            "private_key": "...", "short_id": ["..."] } } }
  ],
  "outbounds": [
    { "type": "direct", "tag": "direct" },
    { "type": "shadowsocks", "tag": "landing-3", "server": "...", "server_port": 32001,
      "method": "2022-blake3-aes-128-gcm", "password": "..." }
  ],
  "route": { "rules": [{ "inbound": ["31001"], "outbound": "landing-3" }], "final": "direct" }
}
```

**落地机**:一个共享 ss-2022 入站 + direct 出口(与现设计一致,多台中转机可 detour 到同一落地机)。

### 7.2 关键不变式

1. 落地机 ss 入站共享:多台中转机可 detour 同一落地机同一入站,落地机只需一份配置。
2. 每节点端口/凭据唯一:同机多节点各自独立端口与凭据;客户端连不同端口即选择不同节点/出口。
3. 整机 config 原子替换 + reload(而非频繁重启);同机多节点合并进一份 config 一次下发(拉直原则)。
4. Reality 凭据按机器共享:一台机器所有 VLESS+Reality 节点共用一套私钥/short_id(借站 SNI 各自可选),端口不同即可。
5. 直连节点 = 出口 direct,落地机直接暴露客户端协议入站,不走 ss-2022。
6. 自签证书:面板为 VMess/Trojan TLS 生成自签证书并写入配置,客户端「允许自签」即可连接。
7. 端口:创建时自动分配(同机唯一),允许手动覆盖并后端校验冲突。
8. 下发失败:自动回滚上一份配置(bak)+ reload,页面明确提示「已回滚」,不掩盖失败。

## 8. 数据模型(SQLite)

```
servers           # 机器
  id, name, role(relay|landing), control(ssh|agent), host, ssh_port, ssh_user,
  ssh_auth_type(key|password), ssh_auth_secret(加密存储), region,
  ping_status(online|offline|inactive|unknown), singbox_version, last_seen
  # agent 模式:agent_token, agent_version, last_heartbeat

nodes             # 节点 = 入站 + 出口(替代原 links)
  id, name, server_id(入口监听机), protocol(vless|vmess|trojan|shadowsocks|hysteria|socks|http|tunnel),
  listen_port, enabled, uuid/password/method(加密存储), tls_mode(none|reality|tls), sni,
  transport(raw|ws), ws_path, outbound_type(direct|relay), landing_server_id,
  tunnel_address, tunnel_port, note, created_at

sni_library       # Reality 借站域名库
  id, domain, note, builtin

settings          # 面板配置(订阅 slug 等)
users             # 单管理员(bcrypt)
```

凭据存储:节点凭据、`ssh_auth_secret` 用 **AES-256-GCM** 加密入库,主密钥来自 `APP_SECRET`。

## 9. 功能范围

### 9.1 服务器管理
- CRUD,控制方式 **SSH 为主**(配置 host/端口/用户/私钥或密码);Agent 留作后续扩展(前端保留字段,后端 V1 不实现)。
- 面板操作:安装 / 重启 / 卸载 sing-box、SSH 连通性测试、配置下发(均经 SSH exec,失败自动回滚)。
- 状态列:**被动检查**——打开面板/点刷新时按需 SSH 检查(sing-box 版本 + 运行状态),检查中显示「检查中」,检查完缓存;无常驻轮询。

### 9.2 节点管理(模板制)
- 11 个模板(见 §5),创建 = 选模板 + 名称 + 入口机 + 出口(直连/中转)+ (Reality/ShadowTLS 选借站 SNI / 隧道填转发目标);端口/凭据/密钥/自签证书全自动(端口展示可改)。
- 列表:协议徽标、入口机、端口、出口(隧道显示 目标:端口)、在线(派生)、启停、分享链接复制、删除。
- **编辑(V1)**:名称/备注/启停/出口/SNI/端口/协议(改协议 = 凭据重新生成并提示「客户端需更新」)。
- 启停/编辑/删除触发配置下发,结果必须可见(成功/失败不掩盖,失败自动回滚)。
- **隧道节点不参与订阅**(非客户端代理节点,仅端口转发)。

### 9.3 Reality 域名库
- 内置大厂域名 + 用户增删改;新建 VLESS+Reality 节点时下拉选择。

### 9.4 订阅
- 单条链接 `/sub/<slug>`;UA 自动判定 base64 / sing-box JSON,支持 `?format=` 强制。
- 内容 = 所有启用节点;按协议输出分享链接(vless/vmess/trojan/ss/hysteria2),SOCKS/HTTP 仅进 sing-box JSON。

### 9.5 鉴权
- 单管理员,启动时初始化(env 或首启);密码 bcrypt;JWT;除 `/sub/<slug>` 与 `/api/health` 外全部需登录。

### 9.6 不做(明确排除)
- 多用户 / 计费 / 流量统计 / 到期;系统资源监控;多级串联;客户端侧模板定制;节点自动测速。

## 10. 测试策略

- **单元**:配置生成(按协议快照关键字段:入站形态、detour 指向、reality 字段、自签 TLS)、路由规则、分享链接/订阅转换往返、凭据加解密、SNI 库校验。
- **集成(手动)**:本地起面板 → SSH/agent 连真实机 → 建节点 → 客户端验证连通;agent 注册/心跳/任务闭环。

## 11. 风险与开放项

1. **agent(已降级为后续扩展)**:V1 不做;若未来有面板不可达的 NAT 机器,再设计 注册/心跳/任务 协议与 agent 形态(纯 shell vs 单文件二进制)。
2. **Reload 行为**:sing-box `systemctl reload` 对端口/config 变更的支持需实测。
3. **Reality 借站**:个别大站可能拒绝握手;域名库自选应对。
4. **自签证书**:VMess/Trojan 客户端需允许自签,订阅/分享链接文案需引导(参考项目均不自动生成,我们更傻瓜)。
5. **ss-2022 兼容性**:个别客户端不支持则降级 `aes-128-gcm`。
6. **面板与落地同机**:V1 统一走 SSH(到本机)。

## 12. 交付物

- Node.js 后端(含测试)+ React/antd 前端 + SQLite 迁移;前端契约见 `docs/ia.md`、组件映射见 `docs/mapping.md`。
- 部署文档(含 systemd、nginx、首次建节点步骤、客户端订阅/自签证书指引)。
- 一键手动初始化脚本(安装 sing-box、面板 systemd、示例 env;agent 安装脚本由面板生成)。
