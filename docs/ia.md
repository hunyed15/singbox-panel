# 信息架构 — SingBox 个人中转面板前端(节点模型版)

> 状态:已确认 <2026-08-11>(确认门 1 + 范围重开确认:节点模型/模板制/agent 控制/双格式订阅)
> 后端:antd(用户指定)· 技术栈:React + TS + Vite + antd 6.6.0 + react-router-dom + @ant-design/icons
> 目标平台:桌面浏览器为主

## 0. 关键决策记录

| 决策 | 结论 |
|---|---|
| 前端框架 | React + antd(替代 PRD 的 Vue3+Element Plus,用户指定) |
| **节点模型** | 「链路」泛化为「节点(入站)」:server 上可建任意协议入站;每条节点 = 入站(协议/端口/凭据/TLS/传输)+ 出口(直连 或 经中转机→落地机) |
| **协议模板(傻瓜式)** | **8 个模板**:VLESS+Reality / VMess+WS+TLS / Trojan+TLS / Shadowsocks-2022 / Hysteria / SOCKS / HTTP / **隧道(端口转发)**;模板 = 协议+传输+TLS 组合,创建只填 名称+机器+出口(隧道填转发目标),其余(端口/凭据/密钥/证书)后端自动生成;「高级设置」可展开 |
| **证书策略** | Reality 借站(零证书)为主,借站域名**可自选**:内置大厂域名库(可加/编辑/删除),新建 VLESS+Reality 节点时下拉选择;VMess/Trojan 默认**面板自动生成自签证书**,「高级设置」可选**自有证书**(对齐 3x-ui/xray-ui,两者均需手动填证书);SOCKS/HTTP 无 TLS |
| **中转能力** | 保留:节点出口可选「直连(direct)」或「relay → 落地机(ss-2022 中转)」;不中转 = 出口选直连 |
| **订阅** | 双格式保留:base64(分享链接列表)+ sing-box JSON,UA 自动判定 + ?format 强制;分享链接按协议扩展(vless:// vmess:// trojan:// ss:// hysteria2://;SOCKS/HTTP 仅走 sing-box JSON) |
| **节点控制** | **V1 仅 SSH**:面板经 SSH 直连各机,推送配置并 reload,执行 安装/重启/卸载(机器端零组件,代码量最小);**Agent(脚本注册)留作后续扩展**,供面板不可达(如 NAT)的机器使用。前端保留 control 字段与安装脚本 UI(mock 可用),后端 V1 不实现 agent 协议 |
| **节点编辑** | V1 支持:名称/备注/启停/端口/出口/SNI/协议(改协议 = 凭据重新生成,提示客户端更新);入口机不可改(迁移=删除重建) |
| **端口** | 创建自动分配(同机唯一)+ 可手动覆盖,后端校验冲突 |
| **监控** | 被动:打开面板/点「检查状态」时按需 SSH 检查,无常驻轮询;检查中按钮 loading |
| **reload 失败** | 自动回滚上一份配置 + 页面明确提示 |
| **订阅范围** | 个人自用;slug 轮换保留(改 slug 旧链接立即失效) |
| 凭据透明 | 节点凭据(UUID/密码/密钥)后端生成并持有,前端只展示后端构建的 `share_link`;`ssh_auth_secret` 只提交不回显 |
| 不引入 | 多用户/计费/流量统计/到期(PRD 排除;xray-ui 的这部分不抄) |
| 图表 | 不需要 |

## 1. 页面清单

| 路由 | 页面 | 原型 | 级别 | 数据实体 | 主要操作 |
|---|---|---|---|---|---|
| /login | 登录 | 认证页 | 展示 | Auth | 登录 |
| / | 重定向 | — | — | — | → /servers |
| /servers | 服务器(含状态与控制) | 列表页 | 功能 | Server | 新增(ssh/agent 字段保留)/ 编辑 / 删除(有节点引用 409)/ 测连通(ssh)/ 安装·重启·卸载 / 检查状态(被动)/ agent:复制安装脚本(后端未实现) |
| /nodes | 节点 | 列表页 | 功能 | NodeInbound / Server | 模板新建 / **编辑** / 启停 / 删除(触发下发)/ 复制分享链接 / Reality 域名库 |
| /subscribe | 订阅 | 表单页 | 功能 | Settings | 复制订阅链接 / 自定义 slug / 格式说明 |

PRD 追溯:§6.1 服务器 → /servers;§6.2 链路 → /nodes(节点模型);§6.3 监控 → /servers 状态列 + agent 心跳;§6.4 订阅 → /subscribe;§6.5 鉴权 → /login。非前端需求:sing-box 配置生成、SSH/agent 下发、探测定时、订阅内容转换、自签证书签发、agent 注册与任务协议。

## 2. 布局骨架(两个)

- Layout A(功能页):Sider 200px 深色导航「服务器 / 节点 / 订阅」+ Header(退出)+ Content padding 24。
- Layout B(登录):居中单卡片,无导航。

## 3. 数据契约(services 唯一来源;mock 与真实 API 同契约)

### 3.1 认证

- `POST /api/auth/login {username,password}` → `{token, username}`;401 全局登出回 /login。token 存 `localStorage.sb_token`。

### 3.2 Server(服务器,含控制方式)

`GET /api/servers` → `Server[]`

| 字段 | 类型 | 说明/展示 |
|---|---|---|
| id / name / host / ssh_port / ssh_user / ssh_auth_type / region | | host 等宽;ssh 凭据只提交不回显 |
| role | 'relay' \| 'landing' | Tag:中转机(蓝)/落地机(绿) |
| control | 'ssh' \| 'agent' | Tag/文本:SSH / Agent |
| ping_status | 'online' \| 'inactive' \| 'offline' \| 'unknown' | Badge:在线(绿)/未激活(灰)/离线(红)/未知(灰) |
| singbox_version / last_seen | | last_seen 相对时间;agent 模式下即心跳时间 |
| agent | `{ token, agent_version, last_heartbeat } \| undefined` | agent 模式才返回;token 供安装脚本使用 |

**创建/更新**:`ServerInput { name, role, control, host?, sshPort?, sshUser?, sshAuthType?, sshAuthSecret?, region }`——`control='agent'` 时 ssh 字段可不填(机器自行注册)。`POST/PUT /api/servers[/:id]` → `Server`。
**删除**:`DELETE /api/servers/:id` → `{ok:true}`;被节点引用 → 409。

**操作端点(SSH 模式;agent 为后续扩展)**:
- `POST /api/servers/check` → `Server[]`(被动检查:SSH 逐个检查各机 sing-box 状态并更新缓存)
- `POST /api/servers/:id/test` → `{ok, message}`
- `POST /api/servers/:id/install` → `{ok, steps?} | {ok:false, error}`(安装 sing-box)
- `POST /api/servers/:id/restart` → 同上(重启 sing-box)
- `POST /api/servers/:id/uninstall` → 同上(卸载)
- `GET /api/servers/:id/install-script` → `{script}`(agent 模式:生成可复制安装脚本,内含注册 token)

**agent 协议(后续扩展,非 V1 契约)**:`POST /api/agent/register`(带 token 注册)、`GET /api/agent/tasks`(轮询任务)、`POST /api/agent/report`(回报心跳/结果)——V1 不实现。

### 3.3 Node(节点 = 入站 + 出口)

`GET /api/nodes` → `NodeItem[]`

| 字段 | 类型 | 说明/展示 |
|---|---|---|
| id / name / note / created_at | | |
| server_id / server_name | | 入口监听机 |
| protocol | 'vless' \| 'vmess' \| 'trojan' \| 'shadowsocks' \| 'hysteria' \| 'socks' \| 'http' | Tag 徽标(色见 §3.6) |
| listen_port | number | 等宽 |
| enabled | 0 \| 1 | Switch |
| tls_mode | 'none' \| 'reality' \| 'tls' | 展示文案:无 / Reality / TLS(自签) |
| transport | 'raw' \| 'ws' | 展示 |
| outbound_type | 'direct' \| 'relay' | 出口:直连 / 中转 |
| landing_server_id / landing_name | | relay 出口时的落地机 |
| sni | string(展示) | Reality 借站域名(公开非机密) |
| share_link | string \| null | 后端构建的分享链接(凭据不进前端);socks/http 为 null → 提示用 sing-box JSON |

**创建(模板制)**:`POST /api/nodes { template, name, serverId, outboundType, landingServerId?, sni?, port? }` → `{ node, deploy }`。`template` ∈ vless-reality / vmess-ws-tls / trojan-tls / ss2022 / hysteria / socks / http / **tunnel / tuic / shadowtls / naive**;端口/凭据/密钥/自签证书由后端生成,**端口可手动覆盖**(同机唯一校验)。
**编辑**:`PUT /api/nodes/:id { name?, note?, enabled?, outboundType?, landingServerId?, sni?, port?, protocol? }` → `{ node, deploy }`;改 protocol = 凭据重新生成(客户端需更新)。**删除**:`DELETE /api/nodes/:id` → `{ok, deploy}`。每次变更触发配置下发,失败自动回滚 + 页面提示。

### 3.4 Settings(订阅)

`GET /api/settings` → `{subSlug, subUrl}`;`POST /api/settings {subSlug}` → 同上(slug 仅 `[a-zA-Z0-9_-]`)。

### 3.5 派生字段

- 节点「在线」= 启用 且 入口机 `ping_status==='online'`(前端派生)。
- 节点「出口」文案:direct → 直连;relay → `→ {landing_name}`。

### 3.6 枚举与文案(唯一来源:`utils/status.ts`)

- ping_status:在线/未激活/离线/未知(Badge success/default/error/default)
- protocol 徽标:VLESS=blue, VMess=geekblue, Trojan=purple, Shadowsocks=green, Hysteria=volcano, SOCKS=orange, HTTP=gold(antd 预设色)
- control:SSH / Agent
- 时间:last_seen/心跳 相对时间;≥7 天显完整日期

### 3.7 Reality 域名库(SNI)

`GET /api/snis` → `SniItem[]`;`POST /api/snis {domain, note}`;`PUT /api/snis/:id {domain?, note?}`;`DELETE /api/snis/:id`(内置可删)。

`SniItem { id, domain, note, builtin }`——内置大厂域名种子 + 用户自定义;新建 VLESS+Reality 节点时 `NodeCreateInput.sni` 取自本库(默认 www.microsoft.com)。

## 4. 预判自写

- 自写 UI 组件:0(模板卡片=Card+Flex 组合;协议徽标=Tag;复制=Typography copyable+按钮;空态=Empty 组合)。
- 自写非 UI:相对时间工具(`Intl.RelativeTimeFormat`)、services/mock、按协议分享链接构建属后端(mock 内置近似实现)。

## 5. 待确认(后续迭代)

1. ~~节点「编辑」~~ 已决:V1 支持(名称/备注/启停/端口/出口/SNI/协议)。
2. VMess/Trojan「自有证书」粘贴 UI 为高级设置,后置到后端阶段(默认自动自签)。
3. agent 协议细节(注册/token/心跳/任务)在后端阶段设计;前端字段已保留。