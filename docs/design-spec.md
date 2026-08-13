# 设计规范 — antd 后端

> 状态:已确认 <2026-08-11>(确认门 1 通过)
> 后端:antd(用户指定)
> 原则:**选,不是发明**。token 名以 antd 事实源(`node_modules/antd` .d.ts / 官方文档)查证为准,不在本文件发明 token。

## 1. 色彩

- **品牌主色**:**已定 antd 默认蓝**(确认门 1 选 A),零配置,不设 colorPrimary。
  - 备选方向(已否决,记录在案):B. 物料提取(无素材)、C. 中性灰+单强调色。
  - 若未来要换,在全局唯一 root `ConfigProvider theme.token.colorPrimary` 单点落地。
- 其余一切颜色只引用 antd token,规范与实际代码均不出现色值:

| 角色 | token |
|---|---|
| 状态成功(在线/可连) | `colorSuccess` |
| 警告 / 停用 | `colorWarning` |
| 错误(离线/失败) | `colorError` |
| 信息(链路 disabled 等) | `colorInfo` |
| 正文 | `colorText` |
| 次要文案 | `colorTextSecondary` |
| 说明 / 弱化 | `colorTextTertiary`(或 Quaternary) |
| 页面背景 | `colorBgLayout` |
| 卡片/容器背景 | `colorBgContainer` |
| 悬停/弹出背景 | `colorBgElevated` |
| 分隔/边框 | `colorBorder` / `colorBorderSecondary` |

## 2. 字体映射表(全项目唯一,不可新增档位)

| 角色 | 写法 |
|---|---|
| 页面标题 | `<Typography.Title level={4}>` |
| 卡片/区块标题 | `<Typography.Title level={5}>` |
| 正文 | `<Typography.Text>` |
| 辅助/说明文字 | `<Typography.Text type="secondary">` |
| 统计数字(仅仪表盘) | `<Statistic>` |
| 代码/端口/host/凭据 | `<Typography.Text code>` 或 `<code>`(等宽) |

- 字号一律由 antd token(`fontSize` / `fontSizeHeading*`)控制,**代码不写任何 font-size**。
- 界面文案中文简体;技术名词(relay/landing/slug/base64/sing-box)保留英文术语。

## 3. 间距与密度

- 间距 8 基数:布局用 `Row/Col gutter={16}`,元素间用 `Space`(默认 8),区块留白 16/24。
- 页面骨架:`Content padding={24}`;Card 内表单/列表间距用 antd 默认(Form/Table 的 item/行高已由 token 控制,不手写 margin)。
- 密度全局统一:ConfigProvider 不设 `componentSize`(antd 默认 middle),全站一致,不许页面各自为政。

## 4. 主题与暗色

- 全局唯一 root `ConfigProvider`,`theme={{ token, components, algorithm }}`。
- **暗色模式**:V1 **不做**(确认门 1)。未来如需:`theme.algorithm = theme.darkAlgorithm`,运行时切换。
- 禁 `.ant-*` 全局覆写(antd 6 内部类名非稳定 API);样式定制走 token → 组件 `classNames/styles`(antd 6 semantic DOM)→ 继承扩展。

## 5. 图标

- 唯一来源 `@ant-design/icons`,按需 import(`PlusOutlined`、`ReloadOutlined`、`DeleteOutlined`、`EditOutlined`、`LinkOutlined`、`CopyOutlined`、`LogoutOutlined`、`TestOutlined` 等)。
- 禁第三方图标库、界面全程禁 emoji。

## 6. 动效

- 仅用 antd 组件内建动效(Modal/Drawer/Switch/Tooltip 默认过渡);功能页禁装饰性动效,不自定义动画。

## 7. 反 Slop 清单(落地检查项)

- 禁渐变装饰背景(主题 token 之外无任何渐变)。
- 禁"圆角卡片 + 左边框色条"。
- 禁图标堆砌列表、禁装饰性假数据;空数据用 `Empty` + 引导文案(如"还没有服务器,先录入第一台")。
- 禁自由 div + 魔法 margin 拼布局(间距走 token/Space/gutter)。
- 占位符诚实:无 logo/插画 → 用文字品牌名,不画假货。

## 8. 三态约定(每个功能页)

- **loading**:表格首载 `Table loading` / 按钮 `loading`;列表重载不整页闪。
- **空**:`Empty` + 下一步引导文案 + 主操作按钮。
- **错误**:数据加载失败 → 页面级 `Alert`(可重试);操作失败 → `message.error` + 必要时 `Alert` 详情;deploy 失败 → 顶部 Alert(不掩盖,展示 error 文本)。
- **删除/危险操作**:`Popconfirm` 二次确认;服务器删除 409(被链路引用)时 message.error 展示后端 error。

## 9. 质量基准

Linear / Stripe Dashboard 级秩序感:统一页头层级、状态色严格对应、等宽数字对齐全、无视觉噪声。功能页不追求"惊艳"。