import { Button, Flex, Layout, Menu, Typography, theme } from 'antd';
import { ApiOutlined, LinkOutlined, LogoutOutlined, SyncOutlined } from '@ant-design/icons';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { clearToken } from '../services/auth';

const { Sider, Header, Content } = Layout;

const NAV_ITEMS = [
  { key: '/servers', icon: <ApiOutlined />, label: '服务器' },
  { key: '/nodes', icon: <LinkOutlined />, label: '节点' },
  { key: '/subscribe', icon: <SyncOutlined />, label: '订阅' },
];
const NAV_KEYS = NAV_ITEMS.map((item) => item.key);

/** 主应用布局:Sider 深色导航 + Header + Content(功能页共用,侧边导航分组与顺序在 ia.md 定死) */
export function MainLayout() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { token } = theme.useToken();
  const selectedKey = NAV_KEYS.find((key) => pathname.startsWith(key)) ?? '/servers';

  const handleLogout = () => {
    clearToken();
    navigate('/login', { replace: true });
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider width={200} theme="dark">
        <Flex align="center" style={{ height: 64, padding: '0 16px' }}>
          <Typography.Text strong style={{ color: token.colorTextLightSolid }}>
            SingBox 面板
          </Typography.Text>
        </Flex>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={NAV_ITEMS}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            background: token.colorBgContainer,
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            paddingInline: 24,
          }}
        >
          <Button type="text" icon={<LogoutOutlined />} onClick={handleLogout}>
            退出登录
          </Button>
        </Header>
        <Content style={{ padding: 24 }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}