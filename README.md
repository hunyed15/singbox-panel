# SingBox 面板

个人自用的 **sing-box 节点管理面板**:在中心机上部署,通过 Web 集中管理多台 Linux 服务器上的 sing-box——建节点、配中转、拉订阅,替代手工 SSH 改 `config.json`。

## 特性

- **模板制建节点(傻瓜式)**:11 种协议模板,端口/凭据/Reality 密钥/自签证书全自动;可选出口「直连」或「中转 → 落地机」
- **完全随机端口**(20000-65000),避免被 GFW 按规律封
- **Reality 借站域名库**:内置大厂域名(✓可用/⚠️不兼容 已实测标注),可增删改
- **SSH/对外地址解耦**:每台机可设 `client_host` 域名;甲骨文等非 root 机器支持「需要 sudo」提权
- **socks/http 可选用户名密码认证**,防开放代理被扫描滥用
- **双格式订阅**:base64(v2rayN)与 sing-box JSON,UA 自动判定;订阅走域名/HTTPS
- **被动监控**:打开面板按需检查各机状态,无常驻轮询
- **单管理员 + JWT**,支持在线修改账号/密码
- **配置下发含回滚**:`sing-box check` 校验 → 原子替换 → reload,失败自动恢复

## 协议支持(实测可用性)

| 协议 | 可用 | 说明 |
|---|---|---|
| VLESS + Reality | ✅ | 借站域名需实测选 ✓ 项 |
| VMess + WS + TLS | ✅ | 自签证书,客户端需允许不安全 |
| Trojan + TLS | ✅ | 同上 |
| Shadowsocks-2022 | ✅ | |
| Hysteria2 / TUIC | ✅ | **需 sing-box 内核客户端**(xray/v2rayN 不支持) |
| SOCKS / HTTP | ✅ | 可配用户名密码 |
| 隧道(端口转发) | ✅ | IPv4/IPv6/域名目标 |
| ShadowTLS / Naive | ⚠️ | 不适合独立节点模型 / 需真实证书 |

## 架构

```
浏览器 ──HTTPS──▶ [面板 Node.js + SQLite + React/antd] ──SSH──▶ 各节点 sing-box
                       │
                       └── /sub/:slug 订阅(客户端拉取)
```

- 面板只生成 `config.json`、SSH 下发、读状态;不承担流量转发
- 中转链路:客户端 → 入口机(VLESS+Reality)→ ss-2022 → 落地机 → 出网

## 技术栈

- 后端:Node.js ≥ 24、Express 5、内置 `node:sqlite`(零原生依赖)、ssh2、JWT/bcrypt
- 前端:React、TypeScript、Vite、antd 6

## 快速开始(在中心机)

```bash
# 一键安装:装 Node 24 → 拉代码 → 装依赖 → 构建前端 → 写 env → systemd 启动
sudo bash deploy/install-panel.sh

# 首次登录密码(ADMIN_PASS 为空时随机生成):
journalctl -u singbox-panel -n 50 | grep bootstrap
```

详细见 [`docs/部署.md`](docs/部署.md)。

## 手动部署

```bash
git clone https://github.com/hunyed15/singbox-panel.git
cd singbox-panel
npm install --workspace server
(cd frontend && npm install && npm run build)
# 配置 /etc/singbox-panel/panel.env(照 .env.example,APP_SECRET 必填)
cp deploy/singbox-panel.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now singbox-panel
```

## 订阅

- 面板「订阅」页复制链接,`?format=singbox` 为 sing-box 原生 JSON
- 推荐客户端:**FlClash / Hiddify**(sing-box 内核,全协议支持);v2rayN 仅支持到 reality/vmess/trojan

## 文档

- [`PRD.md`](PRD.md) — 产品需求
- [`docs/ia.md`](docs/ia.md) — 前端信息架构与数据契约
- [`docs/backend-design.md`](docs/backend-design.md) — 后端设计
- [`docs/mapping.md`](docs/mapping.md) — 组件映射
- [`docs/部署.md`](docs/部署.md) — 部署与运维(含踩坑:借站域名、MTU、sudo、客户端内核)

## 已知限制

- 单管理员、个人自用;无多用户/计费/流量统计
- Agent 模式(机器脚本自动注册)为后续扩展,V1 仅 SSH
- ShadowTLS / Naive 不可用(协议特性所限),模板保留并标注
