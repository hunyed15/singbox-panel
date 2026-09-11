import { useState } from 'react';
import { Alert, App, Button, Flex, Form, Input, InputNumber, Modal, Popconfirm, Select, Table, Typography } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { api } from '../services';
import type { PortForwardItem, Server } from '../services/types';
import { useAsyncData } from '../hooks/useAsyncData';
import { EmptyState } from '../components/EmptyState';

export function PortForwardsPage() {
  const { message } = App.useApp();
  const { data, loading, error, reload } = useAsyncData(async () => {
    const [forwards, servers, nodes, xrayNodes] = await Promise.all([
      api.getPortForwards(),
      api.getServers(),
      api.getNodes(),
      api.getXrayNodes(),
    ]);
    return { forwards, servers, nodes, xrayNodes };
  });
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm();

  const forwards = data?.forwards ?? [];
  const servers = data?.servers ?? [];
  const nodes = data?.nodes ?? [];
  const xrayNodes = data?.xrayNodes ?? [];

  const relayServers = servers.filter((s) => s.role === 'relay');
  const landingServers = servers.filter((s) => s.role === 'landing');

  const serverOptions = (list: Server[]) => list.map((s) => ({ value: s.id, label: `${s.name} (${s.host})` }));
  const allTargets = [
    ...nodes.map((n) => ({ value: `singbox:${n.id}`, label: `[SingBox] ${n.name} port=${n.listen_port}` })),
    ...xrayNodes.map((n) => ({ value: `xray:${n.id}`, label: `[Xray] ${n.name} port=${n.listen_port}` })),
  ];

  const handleCreate = async () => {
    const vals = await form.validateFields().catch(() => null);
    if (!vals) return;
    setCreating(true);
    try {
      const [type, nid] = vals.targetNodeId.split(':');
      await api.createPortForward({
        name: vals.name,
        entryServerId: vals.entryServerId,
        landingServerId: vals.landingServerId,
        targetNodeType: type,
        targetNodeId: Number(nid),
        entryPort: vals.entryPort,
        targetPort: vals.targetPort,
      });
      message.success('中转规则已创建');
      setCreateOpen(false);
      form.resetFields();
      reload();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '创建失败');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (pf: PortForwardItem) => {
    try {
      await api.deletePortForward(pf.id);
      message.success('已删除中转规则');
      reload();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  const columns: ColumnsType<PortForwardItem> = [
    { title: '名称', dataIndex: 'name', width: 180, render: (v) => <Typography.Text strong>{v}</Typography.Text> },
    { title: '入口机', dataIndex: 'entry_server_name', width: 100 },
    { title: '入口端口', dataIndex: 'entry_port', width: 100, render: (v) => <Typography.Text code>{v}</Typography.Text> },
    { title: '落地机', dataIndex: 'landing_server_name', width: 100 },
    { title: '目标节点', dataIndex: 'target_node_name', width: 200 },
    {
      title: '目标端口', key: 'target_port', width: 100, render: (_, r) => <Typography.Text code>{r.target_port}</Typography.Text>,
    },
    {
      title: '操作', key: 'actions', width: 100,
      render: (_, r) => (
        <Popconfirm title={`删除转发规则 ${r.name}?`} okText="删除" cancelText="取消"
          okButtonProps={{ danger: true }} onConfirm={() => handleDelete(r)}>
          <Button type="link" danger icon={<DeleteOutlined />}>删除</Button>
        </Popconfirm>
      ),
    },
  ];

  return (
    <Flex vertical gap={16}>
      <Flex justify="space-between" align="center">
        <Typography.Title level={4} style={{ margin: 0 }}>中转规则</Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>新建中转</Button>
      </Flex>
      {error && <Alert type="error" showIcon message="加载失败" description={error}
        action={<Button size="small" onClick={reload}>重试</Button>} />}
      <Table rowKey="id" columns={columns} dataSource={forwards} loading={loading} pagination={false}
        locale={{ emptyText: <EmptyState description="还没有中转规则。iptables DNAT 转发,入口机零负担。"
          action={<Button type="primary" onClick={() => setCreateOpen(true)}>新建中转</Button>} />}}
      />
      <Modal open={createOpen} title="新建中转规则" okText="创建" onOk={handleCreate}
        onCancel={() => setCreateOpen(false)} confirmLoading={creating} width={560} destroyOnHidden>
        <Form form={form} layout="vertical" requiredMark={false}>
          <Form.Item name="name" label="名称" rules={[{ required: true }]}>
            <Input placeholder="如: CoreNet→Dedirock-VLESS" />
          </Form.Item>
          <Form.Item name="entryServerId" label="入口机" rules={[{ required: true }]}>
            <Select options={serverOptions(relayServers)} />
          </Form.Item>
          <Form.Item name="landingServerId" label="落地机" rules={[{ required: true }]}>
            <Select options={serverOptions(landingServers)} />
          </Form.Item>
          <Form.Item name="targetNodeId" label="目标节点(该落地机上的节点)" rules={[{ required: true }]}>
            <Select options={allTargets} showSearch />
          </Form.Item>
          <Flex gap={16}>
            <Form.Item name="entryPort" label="入口端口(留空自动)" style={{ flex: 1 }}>
              <InputNumber style={{ width: '100%' }} min={20000} max={65000} />
            </Form.Item>
            <Form.Item name="targetPort" label="目标节点端口" rules={[{ required: true }]} style={{ flex: 1 }}>
              <InputNumber style={{ width: '100%' }} />
            </Form.Item>
          </Flex>
        </Form>
      </Modal>
    </Flex>
  );
}