import { useState } from 'react';
import { Alert, App, Badge, Button, Flex, Popconfirm, Switch, Table, Tag, Typography } from 'antd';
import { CopyOutlined, DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { api } from '../services';
import type { DeployResult, Server, XrayNodeItem } from '../services/types';
import { useAsyncData } from '../hooks/useAsyncData';
import { XrayNodeCreateModal } from '../components/XrayNodeCreateModal';
import { XrayNodeEditModal } from '../components/XrayNodeEditModal';
import { EmptyState } from '../components/EmptyState';
import { XRAY_PROTOCOL_META, isNodeOnline } from '../utils/status';

export function XrayNodesPage() {
  const { message } = App.useApp();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<XrayNodeItem | null>(null);
  const [deployError, setDeployError] = useState<string | null>(null);

  const { data, loading, error, reload } = useAsyncData(async () => {
    const [nodes, servers] = await Promise.all([
      api.getXrayNodes(),
      api.getServers(),
    ]);
    return { nodes, servers };
  });

  const nodes = data?.nodes ?? [];
  const servers: Server[] = data?.servers ?? [];
  const onlineServerIds = new Set(
    servers.filter((s) => s.ping_status === 'online').map((s) => s.id),
  );

  const showDeploy = (deploy: DeployResult | null) => {
    if (!deploy) return;
    if (deploy.ok) {
      message.success('Xray 配置已生成并下发(reload)');
    } else {
      setDeployError(`配置下发失败:${deploy.error}`);
    }
  };

  const handleToggle = async (node: XrayNodeItem, enabled: boolean) => {
    try {
      setDeployError(null);
      const res = await api.updateXrayNode(node.id, { enabled });
      showDeploy(res.deploy);
      reload();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  const handleDelete = async (node: XrayNodeItem) => {
    try {
      setDeployError(null);
      const res = await api.deleteXrayNode(node.id);
      showDeploy(res.deploy);
      message.success(`已删除节点 ${node.name}`);
      reload();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  const handleCopyLink = async (node: XrayNodeItem) => {
    if (!node.share_link) return;
    try {
      await navigator.clipboard.writeText(node.share_link);
      message.success(`已复制 ${node.name} 的分享链接`);
    } catch {
      message.error('复制失败,请手动选择复制');
    }
  };

  const columns: ColumnsType<XrayNodeItem> = [
    {
      title: '名称',
      dataIndex: 'name',
      width: 190,
      render: (value: string) => <Typography.Text strong>{value}</Typography.Text>,
    },
    {
      title: '协议',
      dataIndex: 'protocol',
      width: 110,
      render: (protocol: XrayNodeItem['protocol']) => (
        <Tag color={XRAY_PROTOCOL_META[protocol]?.tagColor || 'default'}>{XRAY_PROTOCOL_META[protocol]?.text || protocol}</Tag>
      ),
    },
    {
      title: 'Flow',
      dataIndex: 'flow',
      width: 150,
      render: (value: string | undefined) => value ? <Typography.Text code>{value}</Typography.Text> : <Typography.Text type="secondary">-</Typography.Text>,
    },
    {
      title: '入口机',
      dataIndex: 'server_name',
      width: 100,
      render: (value: string) => <Typography.Text>{value}</Typography.Text>,
    },
    {
      title: '端口',
      dataIndex: 'listen_port',
      width: 90,
      render: (value: number) => <Typography.Text code>{value}</Typography.Text>,
    },
    {
      title: '状态',
      key: 'online',
      width: 90,
      render: (_, record) =>
        isNodeOnline(record, onlineServerIds) ? (
          <Badge status="success" text="可连" />
        ) : (
          <Badge status="default" text="不可用" />
        ),
    },
    {
      title: '启用',
      key: 'enabled',
      width: 70,
      render: (_, record) => (
        <Switch checked={record.enabled === 1} onChange={(checked) => handleToggle(record, checked)} />
      ),
    },
    {
      title: '分享',
      key: 'share',
      width: 100,
      render: (_, record) =>
        record.share_link ? (
          <Button type="link" icon={<CopyOutlined />} onClick={() => handleCopyLink(record)}>
            复制
          </Button>
        ) : (
          <Typography.Text type="secondary">走订阅</Typography.Text>
        ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 150,
      render: (_, record) => (
        <Flex gap={4}>
          <Button type="link" icon={<EditOutlined />} onClick={() => setEditing(record)}>
            编辑
          </Button>
          <Popconfirm
            title={`删除节点 ${record.name}?`}
            description="删除后移除该入站配置,并从订阅剔除。"
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={() => handleDelete(record)}
          >
            <Button type="link" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Flex>
      ),
    },
  ];

  return (
    <Flex vertical gap={16}>
      <Flex justify="space-between" align="center">
        <Typography.Title level={4} style={{ margin: 0 }}>
          Xray 节点
        </Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
          新建 Xray 节点
        </Button>
      </Flex>

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

      {deployError && (
        <Alert
          type="error"
          showIcon
          message="下发失败"
          description={deployError}
          action={
            <Button size="small" onClick={() => setDeployError(null)}>
              关闭
            </Button>
          }
        />
      )}

      <Table<XrayNodeItem>
        rowKey="id"
        columns={columns}
        dataSource={nodes}
        loading={loading}
        pagination={false}
        locale={{
          emptyText: (
            <EmptyState
              description="还没有 Xray 节点。选择模板一键创建:端口、凭据、Reality 密钥、自签证书全部自动生成。"
              action={
                <Button type="primary" onClick={() => setCreateOpen(true)}>
                  新建 Xray 节点
                </Button>
              }
            />
          ),
        }}
      />

      <XrayNodeCreateModal
        open={createOpen}
        servers={servers}
        snis={[]}
        onClose={() => setCreateOpen(false)}
        onCreated={(result) => {
          setCreateOpen(false);
          showDeploy(result.deploy);
          reload();
        }}
      />

      <XrayNodeEditModal
        open={editing !== null}
        node={editing}
        snis={[]}
        onClose={() => setEditing(null)}
        onSaved={(result) => {
          setEditing(null);
          showDeploy(result.deploy);
          reload();
        }}
      />
    </Flex>
  );
}