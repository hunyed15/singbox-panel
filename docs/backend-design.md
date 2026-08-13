# SingBox 面板 — 后端设计文档

> 状态:设计稿(待评审)
> 日期:2026-08-11
> 依据:PRD.md(第二次修订版,节点模型)+ docs/ia.md(前端契约,双端共用)
> 说明:本文档取代 `docs/superpowers/plans/2026-08-11-singbox-panel.md`(旧链路模型,Vue 前端,已废弃)
> 技术栈:Node.js ≥ 20,Express 5, better-sqlite3, ssh2, jsonwebtoken, bcryptjs, node:test

## 1. 目标与范围

- **单管理员个人面板**:管理 6 台 Linux 机器上的 sing-box,通过 Web 完成 服务器 → 节点(11 模板)→ 配置下发 → 订阅 全流程。
- **V1 控制方式仅 SSH**(agent 留作扩展,DB 预留 `control` 字段与 token,后端不实现 agent 协议)。
- **被动监控**:无后台轮询;`POST /api/servers/check` 按需检查。
- **不做**:多用户/计费/流量统计/到期;多级串联;客户端侧模板编辑;自动测速。
- 前置:目标机已装 sing-box(面板可 安装/重启/卸载,见 §7)。

## 2. 架构总览

```
浏览器 ──HTTPS──▶ [Express 面板(8081) ── SQLite]
                     │
                     ├─ ssh2 ──▶ 各目标机(sing-box: 生成 config → 原子替换 → reload)
                     │
                     └─ /sub/:slug 订阅(公网,无需登录)
```

- 面板只生成 `config.json`、SSH 下发、读状态;不承担流量转发、不读流量统计。
- 允许面板与 sing-box 同机(中心机=落地机 3,V1 统一走 SSH 到本机)。

## 3. 数据模型(SQLite,better-sqlite3)

```sql
CREATE TABLE IF NOT EXISTS servers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('relay','landing')),
  control TEXT NOT NULL DEFAULT 'ssh' CHECK(control IN ('ssh','agent')),  -- agent 预留
  host TEXT NOT NULL DEFAULT '',
  ssh_port INTEGER NOT NULL DEFAULT 22,
  ssh_user TEXT NOT NULL DEFAULT 'root',
  ssh_auth_type TEXT NOT NULL DEFAULT 'key' CHECK(ssh_auth_type IN ('key','password')),
  ssh_auth_secret TEXT NOT NULL DEFAULT '',          -- AES-256-GCM 加密;agent 模式可为空
  region TEXT NOT NULL DEFAULT '',
  ping_status TEXT NOT NULL DEFAULT 'unknown' CHECK(ping_status IN ('online','inactive','offline','unknown')),
  singbox_version TEXT NOT NULL DEFAULT '',
  last_seen TEXT
);

-- 中转机机器级凭据(role=relay 时自动生成,vless-reality 节点共享)
CREATE TABLE IF NOT EXISTS relay_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER NOT NULL UNIQUE REFERENCES servers(id) ON DELETE CASCADE,
  reality_public_key TEXT NOT NULL,                  -- 明文(base64url)
  reality_private_key TEXT NOT NULL,                 -- 加密
  short_id TEXT NOT NULL,
  port_base INTEGER NOT NULL DEFAULT 31000
);

-- 落地机共享 ss-2022 入站(role=landing 时自动生成,中转出口的基础设施,非客户端节点)
CREATE TABLE IF NOT EXISTS landing_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER NOT NULL UNIQUE REFERENCES servers(id) ON DELETE CASCADE,
  in_port INTEGER NOT NULL,
  method TEXT NOT NULL DEFAULT '2022-blake3-aes-128-gcm',
  password TEXT NOT NULL                              -- 加密
);

CREATE TABLE IF NOT EXISTS nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  protocol TEXT NOT NULL,   -- vless|vmess|trojan|shadowsocks|hysteria|socks|http|tunnel|tuic|shadowtls|naive
  listen_port INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  creds_enc TEXT NOT NULL DEFAULT '',   -- JSON 加密 {uuid?,password?,method?,username?}
  tls_mode TEXT NOT NULL DEFAULT 'none' CHECK(tls_mode IN ('none','reality','tls','shadowtls')),
  sni TEXT NOT NULL DEFAULT '',         -- Reality/ShadowTLS 借站域名
  transport TEXT NOT NULL DEFAULT 'raw' CHECK(transport IN ('raw','ws')),
  ws_path TEXT NOT NULL DEFAULT '',
  outbound_type TEXT NOT NULL DEFAULT 'direct' CHECK(outbound_type IN ('direct','relay')),
  landing_server_id INTEGER REFERENCES servers(id),  -- relay 出口的落地机
  tunnel_address TEXT NOT NULL DEFAULT '',           -- 隧道转发目标
  tunnel_port INTEGER,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE(server_id, listen_port)        -- 端口同机唯一(手动覆盖也受此约束)
);

CREATE TABLE IF NOT EXISTS sni_library (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT NOT NULL UNIQUE,
  note TEXT NOT NULL DEFAULT '',
  builtin INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

端口分配:`nodes.listen_port` 同机唯一(UNIQUE 约束兜底);创建时自动分配(`port_base + 1` 起找第一个空闲),手动覆盖时由后端校验同机冲突 → 409。

## 4. API 契约(与前端 `docs/ia.md` 一致)

统一:除 `/api/health`、`/sub/:slug` 外全部需 `Authorization: Bearer <token>`;错误体 `{ error: string }`;401 由前端全局登出。

### 4.1 认证
| 方法 | 路径 | 请求 | 成功 | 失败 |
|---|---|---|---|---|
| POST | /api/auth/login | `{username,password}` | `{token,username}` | 401 |
| GET | /api/auth/me | — | `{username}` | 401 |

### 4.2 服务器
| 方法 | 路径 | 请求 | 成功 |
|---|---|---|---|
| GET | /api/servers | — | `Server[]`(含 role_value 摘要,不含加密字段) |
| POST | /api/servers | `ServerInput` | `Server`(自动生成 relay/landing_settings) |
| PUT | /api/servers/:id | `Partial<ServerInput>`(sshAuthSecret 缺省/空=不改) | `Server` |
| DELETE | /api/servers/:id | — | `{ok:true}`;被节点引用 → 409 |
| POST | /api/servers/check | — | `Server[]`(被动检查全部,见 §8) |
| POST | /api/servers/:id/test | — | `{ok,message}`(SSH 连通) |
| POST | /api/servers/:id/install | — | `ControlResult` |
| POST | /api/servers/:id/restart | — | `ControlResult` |
| POST | /api/servers/:id/uninstall | — | `ControlResult` |

`ServerInput { name, role, control, region, host?, sshPort?, sshUser?, sshAuthType?, sshAuthSecret? }`(control=agent 时 ssh 字段可不填;后端 V1 仅 ssh 生效)。

`ControlResult = { ok:true, steps?:string[] } | { ok:false, error:string }`。

### 4.3 节点
| 方法 | 路径 | 请求 | 成功 |
|---|---|---|---|
| GET | /api/nodes | — | `NodeItem[]` |
| POST | /api/nodes | `NodeCreateInput` | `{ node, deploy }` |
| PUT | /api/nodes/:id | `NodePatch` | `{ node, deploy }` |
| DELETE | /api/nodes/:id | — | `{ ok:true, deploy }` |

`NodeCreateInput { template(11 种), name, serverId, outboundType, landingServerId?, sni?, port?, tunnelAddress?, tunnelPort? }`
`NodePatch { name?, note?, enabled?, outboundType?, landingServerId?, sni?, port?, protocol?, tunnelAddress?, tunnelPort? }`
`NodeItem { id,name,server_id,server_name,protocol,listen_port,enabled,tls_mode,transport,sni,outbound_type,landing_server_id,landing_name,tunnel_address,tunnel_port,share_link,note,created_at }`(凭据不进响应;share_link 由后端构建)
`DeployResult = { ok:true, steps?:string[] } | { ok:false, error:string, rolledBack:true }`

节点变更(创建/启停/编辑/删除)→ 触发该入口机整机配置重算 + 下发;失败自动回滚。

### 4.4 域名库 / 设置 / 公共
| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST | /api/snis | 列表 / 新增 `{domain,note}`(409 重复,格式校验) |
| PUT/DELETE | /api/snis/:id | 编辑 / 删除(内置可删) |
| GET/POST | /api/settings | 订阅配置 `{subSlug,subUrl}`;POST `{subSlug}` 改 slug(仅 `[a-zA-Z0-9_-]`) |
| GET | /api/health | `{ok,version}` |
| GET | /sub/:slug | 订阅内容(见 §6);slug 不匹配 404 |

## 5. sing-box 配置生成(`server/src/sbconfig/`,纯函数可单测)

### 5.1 模板 → 入站形态(每节点一个入站)

| 模板 | 入站 | 凭据 | TLS/传输 |
|---|---|---|---|
| vless-reality | `vless` users[{uuid,flow:"xtls-rprx-vision"}] | uuid(节点级) | tls.enabled + reality{handshake:{server:sni,port:443}, private_key, short_id} |
| vmess-ws-tls | `vmess` users[{uuid,alterId:0}] | uuid | transport ws{path:ws_path} + tls{certificate_path,key_path} |
| trojan-tls | `trojan` users[{password}] | password | tls{certificate_path,key_path} |
| ss2022 | `shadowsocks` method/password | password | 无 |
| hysteria | `hysteria2` users[{password}] | password | tls{certificate_path,key_path} |
| socks | `socks` | 无 | 无 |
| http | `http` | 无 | 无 |
| tunnel | `direct` network:"tcp" override_address/override_port | 无 | 无 |
| tuic | `tuic` users[{uuid,password}] congestion_control:"bbr" | uuid+password | tls{certificate_path,key_path} |
| shadowtls | `shadowtls` version:3 users[{password}] handshake:{server:sni,server_port:443} | password | 无(借站伪装) |
| naive | `naive` users[{username,password}] | username+password | tls{certificate_path,key_path} |

### 5.2 整机装配(buildMachineConfig,拉直原则)

对每台机器聚合其 `enabled=1` 节点:

1. **客户端节点入站**:按 §5.1 逐个生成(`listen:"::", listen_port, tag: relay-in-<port>`)。自签 TLS 模板共用该机证书 `certificate_path/key_path`(见 §5.4)。
2. **中转出口**(outbound_type=relay 的节点):每个节点一个 `shadowsocks` outbound(tag `landing-<nodeId>`,指向落地机 host:landing_settings.in_port/method/password),route rules `{inbound:["<port>"], outbound:"landing-<nodeId>"}`。
3. **落地机共享入站**(role=landing):`shadowsocks` 入站(in_port, method, password)——中转的基础设施,不占用 nodes。

> 为什么叫「共享」:它是**中转机 → 落地机**之间的内部跳板(ss-2022),不是给客户端连的,所以不进「节点」页、也不进订阅;多台中转机的多个 relay 节点可 detour 到同一落地机的同一个 ss 入站(同一份配置一次下发)。只有 relay 出口的节点才需要它。
4. **直连节点**:仅入站,无出站关联;route final 兜底 `direct`。
5. `outbounds: [direct, ...landing-outbounds]`,`route: { rules, final:"direct" }`,`log:{level:"info",timestamp:true}`。

### 5.3 Reality 密钥(机器级共享)

- relay 机器创建时自动生成 relay_settings(x25519 keypair + short_id + port_base),所有 vless-reality 节点共享;借站 SNI 各节点可选(来自域名库)。

### 5.4 自签证书(cert.js)

- 每台机器生成一次:ECDSA P-256,CN/SAN=机器 host,有效期 10 年;PEM cert + key。
- 下发时写入机器 `/etc/sing-box/tls/<name>.crt|.key`,config 引用 `certificate_path/key_path`(sing-box TLS 字段已核实)。
- 客户端连接需「允许自签/允许不安全连接」(VMess/Trojan/Hysteria2/TUIC/Naive 模板与订阅文案引导)。

### 5.5 端口

- 入口机节点端口:`relay_settings.port_base`(默认 31000)起第一个空闲;落地机共享 ss 入站 `landing_settings.in_port`(32000+id)。手动覆盖节点端口 → 后端校验 `UNIQUE(server_id,listen_port)` → 冲突 409。

## 6. 订阅(`server/src/sub.js`)

- 内容 = 所有 `enabled=1` 且 **protocol != 'tunnel'** 的节点。
- `pickFormat(query, ua)`:query.format(base64|singbox)优先;UA 含 `sing-box|singbox|SFI|SFA|SFM` → singbox;否则 base64。
- **base64**:每行一个分享链接,仅含可生成链接的协议(vless/vmess/trojan/shadowsocks/hysteria2/tuic);socks/http/shadowtls/naive 跳过。
- **singbox json**:mixed 入站 `127.0.0.1:2080` + 各节点客户端出站(vless/vmess/trojan/shadowsocks/hysteria2/socks/http/tuic/shadowtls/naive)+ selector `auto` + direct;`route.final="auto"`。自签 TLS 出站带 `insecure:true`。
- 分享链接格式:
  - vless:`vless://uuid@host:port?encryption=none&security=reality&sni=..&fp=chrome&pbk=..&sid=..&type=tcp&flow=xtls-rprx-vision#name`
  - vmess:base64(v2 JSON,ws+tls)
  - trojan:`trojan://pass@host:port?security=tls&sni=..&allowInsecure=1#name`
  - ss:`ss://base64url(method:pass)@host:port#name`
  - hysteria2:`hysteria2://pass@host:port?sni=..&insecure=1#name`
  - tuic:`tuic://uuid:pass@host:port?congestion_control=bbr&sni=..&allow_insecure=1#name`

## 7. SSH 与下发(`ssh.js` / `deploy.js`)

- `buildConn(server, decrypt)` → ssh2 参数(私钥/密码);`exec(conn, cmd, timeout)`;`writeFile(conn, path, content)`(sftp)。
- 控制命令:
  - install:下载 sing-box 官方 release tarball(下载基地址可用 `SINGBOX_DOWNLOAD_BASE` 覆盖为 gh-proxy 等镜像,默认官方)→ `/usr/local/bin/sing-box` + 写 systemd unit(`/etc/systemd/system/sing-box.service`)+ enable;逐步上报 steps。失败不破坏现有环境(先 `sing-box version` 探测已装则跳过)。
  - restart:`systemctl restart sing-box`;uninstall:`systemctl disable --now sing-box` + 删 unit/二进制。
  - test:`echo ok` + `sing-box version`。
- **deployMachine**(节点/服务器变更触发):
  1. 生成该机 config → sftp 写 `/tmp/singbox-panel/config.json`
  2. ssh `sing-box check -c /tmp/...`(失败中止,不触碰现网)
  3. 备份 `cp config.json config.json.bak`
  4. 原子替换 `install -m 600`
  5. `systemctl reload sing-box`
  6. 失败 → 恢复 .bak + 再 reload → 返回 `{ok:false, error, rolledBack:true}`

## 8. 被动状态检查(`probe.js`)

- `POST /api/servers/check`:对每台机 ssh 执行 `sing-box version | head -1` 与 `systemctl is-active sing-box`(超时 15s,并发上限 3);写回 ping_status(online/inactive/offline)、singbox_version、last_seen;失败 → offline。返回更新后列表。
- 语义:online=is-active active;inactive=可连但服务未运行;offline=SSH 不可达;unknown=从未检查。

## 9. 认证与安全

- bcryptjs(10 rounds)+ JWT HS256(7d,`Authorization: Bearer`);requireAuth 中间件;401 统一 `{error}`。
- bootstrap:users 为空时用 `ADMIN_USER/ADMIN_PASS` 或随机密码(打印一次)。
- `APP_SECRET` 必填(缺失拒绝启动):AES-256-GCM 加密 ssh_auth_secret、landing password、reality 私钥、节点 creds_enc。
- 凭据生成:crypto.randomUUID;ss 密码 16B base64;x25519 keypair(JWK x/d base64url);short_id 16 hex;自签 ECDSA 证书。
- 订阅 slug 即密钥:改 slug 旧链接立即失效(防公网扫描)。
- 生产建议:nginx/caddy 反代 HTTPS(示例见部署文档)。

## 10. 目录结构

```
server/
  package.json            # type: module
  src/
    index.js              # 装配 + 静态托管(frontend/dist)+ bootstrap
    config.js             # env 解析(APP_SECRET 必填)
    db.js                 # schema + accessors(getSetting/setSetting/ensureAdmin)
    auth.js               # bcrypt/jwt/requireAuth/login router
    crypto.js             # AES-GCM + 凭据/证书生成
    ssh.js                # ssh2 封装(exec/sftp/test)
    ports.js              # 端口分配与冲突校验
    sbconfig/
      index.js            # buildMachineConfig(整机装配)
      inbound.js          # 11 模板入站生成
      relay.js            # 中转 outbound + route rules
      landing.js          # 落地机共享 ss 入站
      cert.js             # 自签证书生成(PEM)
    deploy.js             # deployMachine(校验→备份→安装→reload→回滚)
    probe.js              # checkServers(被动检查)
    sub.js                # 分享链接 + singbox json + UA 分派
    routes/               # auth / servers / nodes / snis / settings
  test/                   # node:test
```

## 11. 测试策略

- **单元(node:test)**:sbconfig 按 11 模板快照关键字段(入站形态/端口/reality/证书路径/route 指向);sub 分享链接与 singbox json 往返;crypto 加解密往返 + 凭据生成;db schema/约束(UNIQUE 端口);端口分配。
- **集成(supertest)**:真实 `initDb(':memory:')` → 登录 → 建服务器(relay/landing 自动生成机器凭据)→ 建各模板节点 → 编辑/启停 → 订阅 UA 分派;deploy 用 fake ssh 验证回滚路径。
- **手动**:本地起面板 → SSH 连真实机 → 建节点 → 客户端验证;`sing-box check` 对多协议入站的兼容性实测。

## 12. 部署要点

- systemd unit(`EnvironmentFile=/etc/singbox-panel/panel.env`)+ nginx 反代示例 + 安装脚本(装 Node/建目录/写 env/systemd)。
- 环境变量:`APP_SECRET`(必填)、`PANEL_LISTEN`、`PANEL_DB`、`ADMIN_USER/ADMIN_PASS`、`JWT_SECRET`、`SINGBOX_BIN/CONFIG/UNIT`、`SINGBOX_DOWNLOAD_BASE`(默认官方 release,可切 gh-proxy 镜像)、`CHECK_TIMEOUT_MS`、`DEPLOY_TIMEOUT_MS`。
- 面板静态托管 `frontend/dist`(SPA fallback)。

## 13. 后续扩展(不在 V1)

- **agent 协议**:注册(token)/心跳/任务轮询/回报;servers.control 与 DB 已预留。
- **自有证书 UI**:VMess/Trojan/TUIC/Hysteria2/Naive 高级设置粘贴证书(后端字段 certificate/key 内联已兼容)。
- Naive 建议配真实证书/CDN(自签仅演示)。
