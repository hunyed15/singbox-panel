import { useState } from 'react';
import { Alert, App, Badge, Button, Flex, Popconfirm, Switch, Table, Tag, Typography } from 'antd';
import { CopyOutlined, DeleteOutlined, EditOutlined, PlusOutlined, SafetyOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { api } from '../services';
import type { DeployResult, NodeItem } from '../services/types';
import { useAsyncData } from '../hooks/useAsyncData';
import { DomainLibraryModal } from '../components/DomainLibraryModal';
import { NodeCreateModal } from '../components/NodeCreateModal';
import { NodeEditModal } from '../components/NodeEditModal';
import { EmptyState } from '../components/EmptyState';
import { isNodeOnline, PROTOCOL_META } from '../utils/status';

/**
 * 节点列表(模板制节点 = 入站 + 出口):
 * 新建(7 协议模板,傻瓜式)、启停、删除、复制分享链接;每次变更触发配置下发,结果必须可见。
 * 节点「在线」为前端派生(启用 且 入口机在线)。
 */
export function NodesPage() {
  const { message } = App.useApp();
  const [createOpen, setCreateOpen] = useState(false);
  const [libOpen, setLibOpen] = useState(false);
  const [editing, setEditing] = useState<NodeItem | null>(null);
  const [deployError, setDeployError] = useState<string | null>(null);

  const { data, loading, error, reload } = useAsyncData(async () => {
    const [nodes, servers, snis] = await Promise.all([
      api.getNodes(),
      api.getServers(),
      api.getSnis(),
    ]);
    return { nodes, servers, snis };
  });

  const nodes = data?.nodes ?? [];
  const servers = data?.servers ?? [];
  const snis = data?.snis ?? [];
  const landings = servers.filter((s) => s.role === 'landing');
  const onlineServerIds = new Set(
    servers.filter((s) => s.ping_status === 'online').map((s) => s.id),
  );

  const showDeploy = (deploy: DeployResult | null) => {
    if (!deploy) return;
    if (deploy.ok) {
      message.success('配置已生成并下发(reload)');
    } else {
      setDeployError(`配置下发失败:${deploy.error}`);
    }
  };

  const handleToggle = async (node: NodeItem, enabled: boolean) => {
    try {
      setDeployError(null);
      const res = await api.updateNode(node.id, { enabled });
      showDeploy(res.deploy);
      reload();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  const handleDelete = async (node: NodeItem) => {
    try {
      setDeployError(null);
      const res = await api.deleteNode(node.id);
      showDeploy(res.deploy);
      message.success(`已删除节点 ${node.name}`);
      reload();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  const handleCopyLink = async (node: NodeItem) => {
    if (!node.share_link) return;
    try {
      await navigator.clipboard.writeText(node.share_link);
      message.success(`已复制 ${node.name} 的分享链接`);
    } catch {
      message.error('复制失败,请手动选择复制');
    }
  };

  const columns: ColumnsType<NodeItem> = [
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
      render: (protocol: NodeItem['protocol']) => (
        <Tag color={PROTOCOL_META[protocol].tagColor}>{PROTOCOL_META[protocol].text}</Tag>
      ),
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
      title: '出口',
      key: 'outbound',
      width: 170,
      render: (_, record) => {
        if (record.protocol === 'tunnel') {
          return record.tunnel_address ? (
            <Typography.Text code>
              {record.tunnel_address}:{record.tunnel_port}
            </Typography.Text>
          ) : (
            <Typography.Text type="secondary">-</Typography.Text>
          );
        }
        return record.outbound_type === 'direct' ? (
          <Typography.Text type="secondary">直连</Typography.Text>
        ) : (
          <Typography.Text>
            中转 <Typography.Text type="secondary">→</Typography.Text> {record.landing_name}
          </Typography.Text>
        );
      },
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
      render: (_, record) => {
        if (record.protocol === 'tunnel') {
          return <Typography.Text type="secondary">端口转发</Typography.Text>;
        }
        return record.share_link ? (
          <Button type="link" icon={<CopyOutlined />} onClick={() => handleCopyLink(record)}>
            复制
          </Button>
        ) : (
          <Typography.Text type="secondary">走订阅</Typography.Text>
        );
      },
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
          节点
        </Typography.Title>
        <Flex gap={8}>
          <Button icon={<SafetyOutlined />} onClick={() => setLibOpen(true)}>
            Reality 域名库
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            新建节点
          </Button>
        </Flex>
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

      <Table<NodeItem>
        rowKey="id"
        columns={columns}
        dataSource={nodes}
        loading={loading}
        pagination={false}
        locale={{
          emptyText: (
            <EmptyState
              description="还没有节点。选择模板一键创建:端口、凭据、Reality 密钥、自签证书全部自动生成。"
              action={
                <Button type="primary" onClick={() => setCreateOpen(true)}>
                  新建节点
                </Button>
              }
            />
          ),
        }}
      />

      <NodeCreateModal
        open={createOpen}
        servers={servers}
        landings={landings}
        snis={snis}
        onClose={() => setCreateOpen(false)}
        onCreated={(result) => {
          setCreateOpen(false);
          showDeploy(result.deploy);
          reload();
        }}
      />

      <NodeEditModal
        open={editing !== null}
        node={editing}
        landings={landings}
        snis={snis}
        onClose={() => setEditing(null)}
        onSaved={(result) => {
          setEditing(null);
          showDeploy(result.deploy);
          reload();
        }}
      />

      <DomainLibraryModal
        open={libOpen}
        snis={snis}
        onClose={() => setLibOpen(false)}
        onChanged={reload}
      />
    </Flex>
  );
}