# SingBox 面板 — 前端(React + antd)

个人自用 sing-box 中转节点管理面板的前端。设计文档:`docs/ia.md`、`docs/design-spec.md`、`docs/mapping.md`(本仓库根目录)。

## 页面

- `/servers` 服务器:Agent/SSH 双控制方式;安装/重启/卸载 sing-box;Agent 模式生成安装脚本,机器跑完自动上线。
- `/nodes` 节点:7 个协议模板(傻瓜式创建,端口/凭据/密钥/自签证书全自动),出口可选直连或经中转机→落地机;分享链接复制。
- `/subscribe` 订阅:双格式(base64 / sing-box JSON),UA 自动判定,slug 管理。

## 运行

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173(默认 mock 数据,无需后端)
```

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `VITE_USE_MOCK` | `false` | 仅前端开发且后端未就绪时设为 `true` 启用内存 mock;生产构建**必须保持默认**(走真实后端) |

## 与后端联调

- 开发:Vite 已代理 `/api`、`/sub` 到 `http://127.0.0.1:8081`。
- 生产:后端 `express.static` 托管 `frontend/dist`(SPA fallback)。
- 契约:`src/services/types.ts` 是唯一契约源;mock 与 http 实现同契约,切换只改 `src/services/index.ts` 的开关。

## 构建

```bash
npm run build      # tsc --noEmit && vite build,产物在 frontend/dist
```