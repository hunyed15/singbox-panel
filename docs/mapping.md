# 组件映射表 — antd 后端(节点模型版)

> 状态:已确认 <2026-08-11>(确认门 2 + 范围重开确认)
> 后端:antd 6.6.0;查证方式:官方 `.d.ts`(antd 6.6.0 + @rc-component/{form,menu,select,input,segmented} + icons 6.3.2,缓存 `.antd-facts/`)
> 原则:五档判定顺序不可跳档;自写须书面理由并经确认

## 1. UI 需求 → 组件判定

| # | UI 需求 | 档 | antd 组件 | 依据 |
|---|---|---|---|---|
| 1 | 主应用骨架(Sider 深色导航+Header+Content) | 1 直用 | `Layout`(+`Sider` width/theme)+ `Menu`(`items`/`selectedKeys`/`onClick`)+ `react-router` `Outlet` | 已查证 |
| 2 | 全局主题 + message 上下文 | 1 直用 | root `ConfigProvider`(默认蓝零配置)+ `App` + `App.useApp()` | 已查证;不用 static message |
| 3 | 登录页 | 2 组合 | `Flex` + `Card` + `Form` + `Input`/`Input.Password` + `Button` + `Typography` | 已查证 |
| 4 | 服务器列表 | 1 直用 | `Table`(`rowKey`/`columns`/`loading`/`locale`/`pagination={false}`)+ `Tag`(角色/控制方式)+ `Badge`(状态)+ `Typography.Text code`(host) | 已查证 |
| 5 | 服务器表单(控制方式联动) | 2 组合 | `Modal`(`open`/`destroyOnHidden`/`confirmLoading`/`maskClosable={false}`)+ `Form` + `Select`(角色/认证方式/**控制方式**)+ `Input`/`Input.TextArea`/`Input.Password`/`InputNumber` | control=agent 时隐藏 ssh 凭据区(条件渲染,非自写组件) |
| 6 | agent 安装脚本弹窗 | 2 组合 | `Modal` + `Typography.Text`(`code`)+ 复制按钮(`navigator.clipboard` + `message`)+ `Alert` 引导 | 复制为浏览器 API |
| 7 | 服务器操作列(测连通/安装/重启/卸载/编辑/删除) | 2 组合 | `Button type="link"` × N + `Popconfirm`(删除)+ `message` 反馈 | 内联按钮,不用未查证的 Dropdown |
| 8 | 节点列表 | 1 直用 | `Table` + `Tag`(协议徽标色)+ `Badge`(派生在线)+ `Switch`(启停)+ `Typography.Text code`(端口) | 已查证 |
| 9 | 节点新建(模板制,傻瓜式) | 2 组合 | `Modal` + 模板卡片区(`Flex` + `Card` + `Typography` + 选中态 `token.colorPrimary` 边框)+ `Form`(`name`/`Select` 机器/`Segmented` 出口)+ `Select`(落地机,relay 时显示)+ 隧道:目标地址/端口(Input + InputNumber)+ Naive 自签警告(`Alert`) | 11 模板;隧道隐藏出口/SNI;ShadowTLS 复用域名库选 SNI |
| 10 | 分享链接复制(单节点) | 2 组合 | `Button`(`copy`)+ `message`;socks/http 无链接时 `Tooltip`/文案提示走订阅 | 复制为浏览器 API |
| 11 | 订阅页 | 2 组合 | `Card` 分区 + `Typography.Text`(`code`/`copyable`)+ `Form`(slug 校验 `pattern`)+ `Alert type="info"` 格式说明 | 已查证 |
| 12 | 三态 | 1 直用 | loading=`Table loading`/`Spin`;空=`Table locale.emptyText` + `EmptyState`(Empty+Text+Button 组合,antd6 Empty 无 props);错误=`Alert`+重试 | 已查证 |
| 13 | 相对时间 | 5 自写(工具函数) | `Intl.RelativeTimeFormat` | antd 无此能力;非 UI 组件 |
| 14 | services/mock | 5 自写(非组件) | `types.ts` 唯一契约 + mock/http 双实现 | 接口层先行规则 |
| 15 | Reality 域名库管理 | 2 组合 | `Modal` + 顶部新增 `Form`(域名+备注)+ `Table` 行内编辑(编辑态切换 Input,非自写组件)+ `Popconfirm` 删除 + `Tag`(内置) | 行内编辑=状态切换组件组合;域名校验规则 `pattern` |
| 16 | Reality 节点 SNI 选择 | 1 直用 | `Form.Item tooltip` + `Select`(域名库 options)+ 仅 vless-reality 模板显示 | 条件渲染;默认 www.microsoft.com |
| 17 | 节点编辑弹窗 | 2 组合 | `Modal` + 复用模板表单(协议 `Select` + 端口 `InputNumber` + 启停 `Switch` + 出口 `Segmented` + SNI `Select` + 隧道目标)+ 协议变更 `Alert` 警告 | 改协议=重生成凭据提示;入口机只读不可改;⚠️ 未用 allowClear(未查证) |
| 18 | 端口手动指定 | 1 直用 | `Form.Item` + `InputNumber`(创建留空=自动,编辑必填)| 后端同机唯一校验 |
| 19 | 被动状态检查 | 1 直用 | `Button loading`(检查中)+ `POST /api/servers/check` → 更新缓存后 reload | 无常驻轮询;打开面板自动查一次 |

## 2. 结论

- 自写 UI 组件 **0 个**;自写仅 2 项非 UI(相对时间、services 层),均已书面理由。
- 模板卡片选中态用 `token.colorPrimary` 边框(引用 token,不写色值)。

## 3. 已查证组件清单(antd 6.6.0;查过的不重查)

Alert / App(+useApp) / Badge(status) / Button / Card / ConfigProvider / Empty(⚠️ 无 props) / Flex / Form(+useForm/useWatch/FormItem/FormRule/validateFields) / Input(+Password/TextArea) / InputNumber / Layout(+Sider) / Menu(+rc items/selectedKeys/onClick/theme) / Modal(open/destroyOnHidden/okButtonProps…) / Popconfirm / Segmented(options/value/onChange/block,rc 继承) / Select(options/value/onChange) / Space / Spin / Switch / Table(ColumnsType/locale.emptyText/pagination=false) / Tag(color 预设色) / Tooltip / Typography(BlockProps: code/type/copyable/strong) / message(MessageInstance)
图标(已证存在):Plus·Edit·Delete·Reload·Copy·Logout·Link·Api·Sync(Outlined)

**未确认 → 绕开**:Select 的 placeholder/allowClear/loading;Empty 的 description/image;Dropdown 的 items/menu(未用);Modal 旧 prop destroyOnClose(用 destroyOnHidden)。

## 4. 待确认

1. ~~节点「编辑」~~ 已决:V1 支持(见 #17)。
2. VMess/Trojan「自有证书」粘贴 UI(高级设置)后置到后端阶段。
3. agent 协议细节后端阶段设计;前端字段保留。