import { useState } from 'react';
import { App, Button, Card, Flex, Form, Input, Typography, theme } from 'antd';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../services';
import { setToken } from '../services/auth';

interface LoginFormValues {
  username: string;
  password: string;
}

/** 登录页:居中单卡片,无导航(展示页,仅复用全局 token,不引入新视觉体系) */
export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const [submitting, setSubmitting] = useState(false);
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  const onFinish = async (values: LoginFormValues) => {
    setSubmitting(true);
    try {
      const res = await api.login(values.username, values.password);
      setToken(res.token);
      message.success('登录成功');
      navigate(from, { replace: true });
    } catch (err) {
      message.error(err instanceof Error ? err.message : '登录失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Flex
      justify="center"
      align="center"
      style={{ minHeight: '100vh', background: token.colorBgLayout }}
    >
      <Card style={{ width: 360 }}>
        <Flex vertical gap={24}>
          <Flex vertical gap={4}>
            <Typography.Title level={4} style={{ margin: 0 }}>
              SingBox 面板
            </Typography.Title>
            <Typography.Text type="secondary">个人中转节点管理面板</Typography.Text>
          </Flex>
          <Form<LoginFormValues> layout="vertical" requiredMark={false} onFinish={onFinish}>
            <Form.Item
              name="username"
              label="用户名"
              rules={[{ required: true, message: '请输入用户名' }]}
            >
              <Input autoComplete="username" />
            </Form.Item>
            <Form.Item
              name="password"
              label="密码"
              rules={[{ required: true, message: '请输入密码' }]}
            >
              <Input.Password autoComplete="current-password" />
            </Form.Item>
            <Form.Item style={{ marginBottom: 0 }}>
              <Button type="primary" htmlType="submit" block loading={submitting}>
                登录
              </Button>
            </Form.Item>
          </Form>
        </Flex>
      </Card>
    </Flex>
  );
}