import { useEffect, useState } from 'react';
import { Alert, App, Button, Card, Flex, Form, Input, Spin, Typography } from 'antd';
import { CopyOutlined, LinkOutlined } from '@ant-design/icons';
import { api } from '../services';
import { useAsyncData } from '../hooks/useAsyncData';

interface SlugFormValues {
  slug: string;
}

/**
 * 订阅页(功能页·表单页原型,设置页场景):
 * 展示订阅链接 + 复制/打开 + 自定义 slug + 各客户端格式说明(覆盖 PRD §6.4)。
 */
export function SubscribePage() {
  const { message } = App.useApp();
  const { data, loading, error, reload } = useAsyncData(api.getSettings);
  const [slug, setSlug] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data) setSlug(data.subSlug);
  }, [data]);

  const fullUrl = `${window.location.origin}/sub/${slug}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(fullUrl);
      message.success('已复制订阅链接');
    } catch {
      message.error('复制失败,请手动选择复制');
    }
  };

  const handleOpen = () => {
    window.open(fullUrl, '_blank', 'noopener');
  };

  const handleSaveSlug = async (values: SlugFormValues) => {
    setSaving(true);
    try {
      const res = await api.setSlug(values.slug);
      setSlug(res.subSlug);
      message.success('已更新订阅链接');
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Flex justify="center" style={{ padding: '48px 0' }}>
        <Spin />
      </Flex>
    );
  }

  return (
    <Flex vertical gap={16}>
      <Typography.Title level={4} style={{ margin: 0 }}>
        订阅
      </Typography.Title>

      {error && (
        <Alert
          type="error"
          showIcon
          message="加载失败"
          description={error}
          action={
            <Button size="small" onClick={reload}>
              重试
            </Button>
          }
        />
      )}

      <Card>
        <Typography.Title level={5}>订阅链接</Typography.Title>
        <Flex vertical gap={12}>
          <Typography.Text code copyable>
            {fullUrl}
          </Typography.Text>
          <Flex gap={8}>
            <Button type="primary" icon={<CopyOutlined />} onClick={handleCopy}>
              复制链接
            </Button>
            <Button icon={<LinkOutlined />} onClick={handleOpen}>
              打开订阅
            </Button>
          </Flex>
        </Flex>
      </Card>

      <Card>
        <Typography.Title level={5}>订阅标识(slug)</Typography.Title>
        <Form<SlugFormValues>
          layout="inline"
          requiredMark={false}
          onFinish={handleSaveSlug}
          initialValues={{ slug }}
        >
          <Form.Item
            name="slug"
            rules={[
              { required: true, message: '请输入 slug' },
              { pattern: /^[a-zA-Z0-9_-]+$/, message: '仅允许字母/数字/下划线/连字符' },
            ]}
            style={{ marginBottom: 0 }}
          >
            <Input style={{ width: 260 }} />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0 }}>
            <Button type="primary" htmlType="submit" loading={saving}>
              保存
            </Button>
          </Form.Item>
        </Form>
        <Typography.Text type="secondary">
          slug 是订阅链接的最后一段(/sub/&lt;slug&gt;)。修改后旧链接立即失效。
        </Typography.Text>
      </Card>

      <Card>
        <Typography.Title level={5}>格式说明</Typography.Title>
        <Alert
          type="info"
          showIcon
          message="客户端按 User-Agent 自动匹配格式,也可用参数强制"
          description={
            <Flex vertical gap={4}>
              <Typography.Text>
                base64:v2rayN / Clash 等客户端,默认命中,或追加 ?format=base64 强制。
              </Typography.Text>
              <Typography.Text>
                sing-box JSON:sing-box / SFA / SFI 客户端,UA 命中自动返回,或追加 ?format=singbox
                强制。
              </Typography.Text>
              <Typography.Text>
                分享链接按协议:vless / vmess / trojan / ss / hysteria2 均支持直接导入;SOCKS /
                HTTP 节点请使用 sing-box JSON 订阅导入。
              </Typography.Text>
              <Typography.Text type="secondary">
                订阅内容 = 当前所有「启用」状态的链路;新建或停用后,客户端重新拉取即生效。
              </Typography.Text>
            </Flex>
          }
        />
      </Card>
    </Flex>
  );
}