# SingBox 面板 后端实施计划(节点模型版)

> **For agentic workers:** 逐任务执行,每任务 失败测试 → 实现 → 通过 → 提交;禁止跳步。
> **状态:计划稿(待执行)**
> 依据:`docs/backend-design.md`(设计)、`docs/ia.md`(契约,与前端共享)、`PRD.md`
> 旧计划 `2026-08-11-singbox-panel.md` 已废弃(旧链路模型)。

**Goal:** 实现 SingBox 面板后端:服务器/节点(11 模板)/域名库/订阅/SSH 控制与下发/被动检查/单管理员鉴权。

**Tech Stack:** Node ≥ 20、Express 5、better-sqlite3、ssh2、jsonwebtoken、bcryptjs、node:test(内置测试器)。

## Global Constraints

- ESM:`server/package.json` 设 `"type": "module"`。
- 数据库:`server/data/panel.db`(路径可被 `PANEL_DB` 覆盖);schema 与 `backend-design.md §3` 一致。
- 凭据一律 AES-256-GCM 加密入库(`crypto.encrypt`),明文只存在于内存。
- `APP_SECRET` 必填,缺失拒绝启动。
- 单管理员:users 表 + bcrypt;JWT HS256 7d,`Authorization: Bearer`。
- 除 `/api/health`、`/sub/:slug` 外全部 API 需登录。
- **V1 仅 SSH 控制**(agent 只留 DB 字段与 `control` 传入,不实现协议)。
- **契约冻结**:请求/响应字段名与 `frontend/src/services/types.ts` 逐字段一致(camelCase 输入 / snake_case 响应,如 `ServerInput.sshPort` ↔ `Server.ssh_port`)。
- 订阅:双格式(base64 / singbox json),UA 自动判定 + `?format=`;隧道节点不参与。
- 节点变更(创建/启停/编辑/删除)→ 触发入口机整机重算 + 下发;失败自动回滚。
- 测试命令:`cd server && npm test`(node --test test/)。
- 不实现:agent 协议、多用户/计费/流量统计、多级串联、客户端模板编辑、自动测速。

---

### Task 1: 脚手架 + 契约冻结 + config

**Files:**
- Create: 根 `package.json`(workspaces:["server"],scripts dev/test/build:frontend)
- Create: `server/package.json`(type:module,dev/test 脚本)
- Create: `server/src/config.js`
- Create: `.gitignore`、`.env.example`
- Read(契约核对): `frontend/src/services/types.ts`、`docs/ia.md §3`

**Interfaces:**
- `loadConfig(env) => { appSecret, jwtSecret, host, port, dbPath, adminUser, adminPass, singboxBin, singboxConfig, singboxUnit, singboxDownloadBase, checkTimeoutMs, deployTimeoutMs }`;缺 `APP_SECRET` 抛错。

- [ ] **Step 1: 契约冻结核对(无代码)**
  逐字段核对前端 `types.ts` 与 `backend-design.md §4`:`ServerInput`(name/role/control/region/host?/sshPort?/sshUser?/sshAuthType?/sshAuthSecret?)、`Server` 响应(ssh_port/ssh_auth_type/ping_status/…)、`NodeCreateInput`(template/name/serverId/outboundType/landingServerId?/sni?/port?/tunnelAddress?/tunnelPort?)、`NodeItem`(snake_case)、`NodePatch`、`DeployResult`、`ControlResult`、`SniItem`、`Settings`、`LoginResult`。发现不一致 → 找用户对齐,不改前端。
- [ ] **Step 2: 写 config 测试** `server/test/config.test.js`:缺 APP_SECRET 抛错;默认值正确;PANEL_LISTEN 拆分 host/port。
- [ ] **Step 3: 跑确认失败**(模块缺失)。
- [ ] **Step 4: 实现 config.js** + 根/server package.json、.env.example(含 `SINGBOX_DOWNLOAD_BASE=...` 注释)。
- [ ] **Step 5: 跑确认通过 + 提交**(`chore: scaffold + env config + contract freeze`)。

---

### Task 2: crypto.js 加解密与凭据生成 + 自签证书

**Files:**
- Create: `server/src/crypto.js`、`server/src/sbconfig/cert.js`
- Test: `server/test/crypto.test.js`

**Interfaces:**
- `encrypt(secret, plaintext) => "ivB64.dataB64"`(AES-256-GCM);`decrypt` 往返、错钥抛错。
- `genUuid()`、`genSsPassword()`(16B base64)、`genShortId()`(16 hex)、`genRealityKeypair()`(x25519 JWK x/d base64url)、`genRandomHex(bytes)`。
- `genSelfSignedCert({ commonName, altNames }) => { certPem, keyPem }`(ECDSA P-256,10 年,SAN)。

- [ ] **Step 1: 写失败测试**:加密往返、错钥抛错、uuid 格式、ss 密码 16B、shortId 16hex、reality keypair 43 字符 base64url、自签证书可用 `crypto.X509Certificate` 解析且 SAN 含 altNames。
- [ ] **Step 2: 跑确认失败。**
- [ ] **Step 3: 实现 crypto.js + cert.js。**
- [ ] **Step 4: 跑确认通过 + 提交**(`feat: crypto + self-signed cert`)。

---

### Task 3: db.js schema + accessors

**Files:**
- Create: `server/src/db.js`
- Test: `server/test/db.test.js`

**Interfaces:**
- `initDb(dbPath) => db`(:memory: 支持;WAL;外键 ON;执行 §3 全量 DDL)。
- `getSetting/setSetting(db, key, value?)`、`ensureAdmin(db, {username, passwordHash})`。

- [ ] **Step 1: 写失败测试**:建表齐全(7 表);settings 往返;ensureAdmin 仅空表播种;FK 级联删除(删 server → 删 nodes/relay_settings/landing_settings);`nodes` 的 `UNIQUE(server_id, listen_port)` 冲突抛错。
- [ ] **Step 2: 跑确认失败。**
- [ ] **Step 3: 实现 db.js**(DDL 照抄 backend-design.md §3)。
- [ ] **Step 4: 装 better-sqlite3 + 跑通过 + 提交**(`feat: sqlite schema + accessors`)。

---

### Task 4: sbconfig/inbound.js — 11 模板入站生成

**Files:**
- Create: `server/src/sbconfig/inbound.js`
- Test: `server/test/sbconfig-inbound.test.js`

**Interfaces:**
- `buildInbound({ node, machine }) => object`,其中 `node` 含 protocol/port/creds(解密后)/sni/transport/wsPath/tlsMode/tunnelAddress/tunnelPort,`machine` 含 host/证书路径/Reality 密钥。
- 覆盖 11 模板,输出与 `backend-design.md §5.1` 表格逐字段一致。

- [ ] **Step 1: 写失败测试(快照断言关键字段)**:每个模板断言 type/listen_port/凭据结构;vless-reality 断言 reality.handshake.server=sni、private_key、short_id;vmess-ws-tls 断言 transport.ws.path + tls.certificate_path;shadowtls 断言 version=3 + handshake;tunnel 断言 type=direct + override_address/port + network=tcp;naive/tuic/hysteria2 断言 users + tls。
- [ ] **Step 2: 跑确认失败。**
- [ ] **Step 3: 实现 inbound.js。**
- [ ] **Step 4: 跑通过 + 提交**(`feat: inbound generators for 11 templates`)。

---

### Task 5: sbconfig/relay.js + landing.js

**Files:**
- Create: `server/src/sbconfig/relay.js`、`server/src/sbconfig/landing.js`
- Test: `server/test/sbconfig-relay.test.js`

**Interfaces:**
- `buildRelayOutbound({ nodeId, landing }) => shadowsocks outbound`(tag `landing-<nodeId>`,server=landing.host,server_port=in_port,method,password)。
- `buildRelayRule({ port, nodeId }) => { inbound:[String(port)], outbound:"landing-<nodeId>" }`。
- `buildLandingInbound({ landing }) => shadowsocks 入站`(in_port/method/password)。

- [ ] **Step 1: 写失败测试**:出站字段、rule 指向、落地入站字段。
- [ ] **Step 2: 跑确认失败。**
- [ ] **Step 3: 实现。**
- [ ] **Step 4: 跑通过 + 提交**(`feat: relay outbound/rule + landing inbound`)。

---

### Task 6: sbconfig/index.js — 整机装配 buildMachineConfig

**Files:**
- Create: `server/src/sbconfig/index.js`
- Test: `server/test/sbconfig-machine.test.js`

**Interfaces:**
- `buildMachineConfig({ machine, relaySettings, landingSettings, nodes, landings }) => config`
  - 每 enabled 节点 → inbound;relay 节点 → 对应 ss outbound + rule;role=landing → 追加共享 ss 入站;final direct;拉直原则(多节点合并一份)。

- [ ] **Step 1: 写失败测试**:混合场景(1 台 relay 机 2 节点[1 relay→A、1 direct]→ 断言 inbounds 数、outbounds 含 landing-A、rules 映射、final);landing 机(共享入站 + 直连节点);无节点机器(仅 landing 共享入站 / relay 空 config 也合法)。
- [ ] **Step 2: 跑确认失败。**
- [ ] **Step 3: 实现。**
- [ ] **Step 4: 跑通过 + 提交**(`feat: machine config assembly`)。

---

### Task 7: ports.js 端口分配

**Files:**
- Create: `server/src/ports.js`
- Test: `server/test/ports.test.js`

**Interfaces:**
- `nextFreePort(usedPorts, base = 31001) => number`(base 起第一个不在 used 的);`assertPortFree(db, serverId, port, excludeNodeId?)` → 冲突抛 ApiError 409。

- [ ] **Step 1: 写失败测试**:连续分配不冲突、手动端口撞车 409、编辑排除自身。
- [ ] **Step 2/3/4: 实现 + 通过 + 提交**(`feat: port allocation`)。

---

### Task 8: sub.js 订阅转换

**Files:**
- Create: `server/src/sub.js`
- Test: `server/test/sub.test.js`

**Interfaces:**
- `collectNodes(db, decrypt) => views[]`(enabled 且非 tunnel,join server host + 解密 creds)。
- `pickFormat(query, ua)`。
- `toBase64(views) => string`(仅 vless/vmess/trojan/ss/hysteria2/tuic 出链接,格式照 §6)。
- `toSingboxConfig(views) => object`(mixed in 127.0.0.1:2080 + 全部协议客户端出站 + selector auto + direct;自签 TLS 出站 insecure:true;shadowtls 出站 {type:"shadowtls",server,server_port,version:3,password,tls:{}})。

- [ ] **Step 1: 写失败测试**:每种协议的链接前缀与关键参数;base64 往返;singbox json 的 outbounds 数量/selector/direct;UA 分派(sing-box/SFI/SFA → singbox;v2rayN/Clash → base64;?format 优先);隧道节点被排除。
- [ ] **Step 2: 跑确认失败。**
- [ ] **Step 3: 实现。**
- [ ] **Step 4: 跑通过 + 提交**(`feat: subscription conversion`)。

---

### Task 9: ssh.js SSH 封装

**Files:**
- Create: `server/src/ssh.js`

**Interfaces:**
- `buildConn(serverRow, decrypt, appSecret) => ssh2 connect 参数`(key/password)。
- `exec(conn, cmd, timeoutMs) => Promise<{stdout, stderr}>`(非 0 exit reject);`writeFile(conn, remotePath, content)`(sftp);`testConnection(conn)`。
- 单元层用注入式 fake(不真连)。

- [ ] **Step 1: 写测试(纯逻辑部分)**:buildConn 按 auth_type 组装;exec/writeFile 的 fake 分支(经依赖注入)。
- [ ] **Step 2/3/4: 实现 + 通过 + 提交**(`feat: ssh2 wrapper`)。

---

### Task 10: deploy.js 下发编排(含回滚)

**Files:**
- Create: `server/src/deploy.js`
- Test: `server/test/deploy.test.js`

**Interfaces:**
- `deployMachine(ssh, conn, config, { singboxBin, singboxConfig, singboxUnit, tmpDir }) => Promise<{ok:true,steps:[]} | {ok:false,error,rolledBack:true}>`
  步骤:mkdir → sftp 写 tmp → `sing-box check -c`(失败中止)→ 备份 → install 原子替换 → `systemctl reload` → 失败恢复 .bak + 再 reload → 返回回滚标记。

- [ ] **Step 1: 写失败测试(fake ssh)**:成功路径步骤序列;check 失败不触碰现网;reload 失败恢复 .bak 并再 reload、返回 rolledBack:true。
- [ ] **Step 2/3/4: 实现 + 通过 + 提交**(`feat: deploy orchestration with rollback`)。

---

### Task 11: probe.js 被动检查

**Files:**
- Create: `server/src/probe.js`
- Test: `server/test/probe.test.js`

**Interfaces:**
- `checkAllServers(db, ssh, crypto, config) => Promise<Server[]>`:并发 ≤3、每台超时 15s;`sing-box version | head -1` + `systemctl is-active`;写回 ping_status/version/last_seen;失败 → offline。

- [ ] **Step 1: 写失败测试(fake ssh)**:online 写入版本;is-active 非 active → inactive;exec 抛错 → offline;版本解析 helper。
- [ ] **Step 2/3/4: 实现 + 通过 + 提交**(`feat: passive status check`)。

---

### Task 12: auth.js 鉴权

**Files:**
- Create: `server/src/auth.js`
- Test: `server/test/auth.test.js`

**Interfaces:**
- `hashPassword/verifyPassword`(bcryptjs);`signToken(jwtSecret, {username, sub})`(7d);`requireAuth(jwtSecret)` 中间件(401 {error});`makeAuthRouter(db, jwtSecret)`(POST /login、GET /me)。

- [ ] **Step 1: 写失败测试**:hash/verify、token 签发与校验、坏 token 401、login 成功/失败。
- [ ] **Step 2/3/4: 实现 + 通过 + 提交**(`feat: jwt auth`)。

---

### Task 13: routes/ 服务器 + 节点 + 域名库 + 设置

**Files:**
- Create: `server/src/routes/servers.js`、`nodes.js`、`snis.js`、`settings.js`
- Create: `server/src/deployServices.js`(deployRelayMachine / deployLandingMachine 复用)
- Test: `server/test/api.test.js`(真实 initDb(':memory:') + supertest)

**Interfaces(照 §4):**
- servers:GET/POST/PUT/DELETE(+409)/check/test/install/restart/uninstall;创建 relay 自动生成 relay_settings、landing 自动生成 landing_settings。
- nodes:GET(拼 server_name/landing_name/share_link)/POST(模板→凭据+端口+入站)/PUT(NodePatch,协议变更重生成凭据+重建 share_link)/DELETE;每次变更调用 deployServices 下发该入口机。
- snis:CRUD(内置可删,域名格式校验,409 重复)。
- settings:GET(无 slug 自动生成)/POST(重置)。

- [ ] **Step 1: 写失败测试(全流程)**:登录 → 建 relay + landing(断言 relay_settings/landing_settings 生成)→ 建各模板节点(端口自动、UUID/密码生成、share_link 形状)→ 编辑(改协议→凭据变、share_link 变)→ 启停/删除(deploy 结果含 steps)→ 服务器删除被节点引用 409 → check 更新状态 → 订阅 UA 分派(supertest 带 UA)→ slug 重置。
- [ ] **Step 2: 跑确认失败。**
- [ ] **Step 3: 实现 routes + deployServices**(fake ssh 注入)。
- [ ] **Step 4: 跑通过 + 提交**(`feat: servers/nodes/snis/settings routes + deploy services`)。

---

### Task 14: index.js 装配 + bootstrap + 静态托管

**Files:**
- Create: `server/src/index.js`
- Test: `server/test/index.test.js`(冒烟)

**Interfaces:**
- `createApp({config}) => {app, db}`:health、auth、servers/nodes/snis/settings、/sub、未匹配 404 JSON;启动时 initDb、ensureAdmin(ADMIN_PASS 或随机打印)、无 sub_slug 生成;`frontend/dist/index.html` 存在 → express.static + SPA fallback。

- [ ] **Step 1: 冒烟测试**:health 200、未知 api 404、auto-seeded admin 登录成功。
- [ ] **Step 2/3/4: 实现 + 通过 + 提交**(`feat: app assembly + bootstrap`)。

---

### Task 15: 部署产物 + 文档

**Files:**
- Create: `deploy/singbox-panel.service`、`deploy/nginx.conf.example`、`deploy/install-panel.sh`、`docs/部署.md`

- [ ] **Step 1: systemd unit**(EnvironmentFile=/etc/singbox-panel/panel.env)。
- [ ] **Step 2: nginx 反代示例**(443 → 8081)。
- [ ] **Step 3: install-panel.sh**:装 Node、clone、npm install、写 env(openssl rand)、systemd、启动。
- [ ] **Step 4: docs/部署.md**:首次登录(随机密码见日志)、录入 6 台机、建节点、订阅客户端指引(含自签证书允许说明、gh-proxy 镜像说明)。
- [ ] **Step 5: 提交**(`docs: deployment artifacts`)。

---

### Task 16: 端到端验收

- [ ] **Step 1: 后端全量测试**:`cd server && npm test` 全绿。
- [ ] **Step 2: 前端构建**:`cd frontend && npm run build`。
- [ ] **Step 3: 本机冒烟**:`APP_SECRET=… ADMIN_PASS=… npm run dev` → health OK。
- [ ] **Step 4: 手动集成清单(写入 docs/部署.md 验收清单)**:登录 → 录入 6 台(1/2 relay,3/4/5/6 landing)→ SSH 实测 → 建 VLESS+Reality(中转→KR3)/ 直连 / 隧道(转发 IPv6)→ `sing-box check` 通过 + reload 生效 → 订阅 v2rayN base64 与 sing-box json 均含节点 → 停用节点 → 订阅剔除 → 客户端实测连通。
- [ ] **Step 5: 提交验收记录**(如有修正)。

---

## 依赖顺序

1→2→3 →(4,5)→6 →7 →8 →(9,10,11,12)→13 →14 →15 →16
(7/8 可并行;9/10/11/12 可并行;13 依赖 4-12;前端已就绪,联调 = `VITE_USE_MOCK=false` + 本后端。)
