import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  App,
  Badge,
  Button,
  Flex,
  Popconfirm,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { ApiOutlined, CopyOutlined, DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { api } from '../services';
import type { Server } from '../services/types';
import { useAsyncData } from '../hooks/useAsyncData';
import { ServerFormModal } from '../components/ServerFormModal';
import { InstallScriptModal } from '../components/InstallScriptModal';
import { EmptyState } from '../components/EmptyState';
import { formatRelativeTime } from '../utils/format';
import { CONTROL_META, ROLE_META, SERVER_STATUS_META } from '../utils/status';

const CONTROL_LABEL: Record<'install' | 'restart' | 'uninstall', string> = {
  install: '安装',
  restart: '重启',
  uninstall: '卸载',
};

/**
 * 服务器列表:CRUD + 状态列 + 控制列(安装/重启/卸载 sing-box,agent 模式另有安装脚本)。
 * 覆盖 PRD §6.1/§6.3 与 Q1「完全体」控制能力。
 */
export function ServersPage() {
  const { data, loading, error, reload } = useAsyncData(api.getServers);
  const { message } = App.useApp();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Server | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [scriptModal, setScriptModal] = useState<{ server: Server; script: string } | null>(null);
  const checkedOnce = useRef(false);

  const servers = data ?? [];

  // 被动监控:打开面板时按需检查一次(不常驻轮询)
  useEffect(() => {
    if (checkedOnce.current) return;
    checkedOnce.current = true;
    setChecking(true);
    api
      .checkServers()
      .catch(() => undefined)
      .finally(() => {
        setChecking(false);
        reload();
      });
  }, [reload]);

  const handleCheck = async () => {
    setChecking(true);
    try {
      await api.checkServers();
      message.success('状态已更新');
      reload();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '检查失败');
    } finally {
      setChecking(false);
    }
  };

  const openCreate = () => {
    setEditing(null);
    setCreateOpen(true);
  };
  const openEdit = (record: Server) => {
    setEditing(record);
    setCreateOpen(true);
  };
  const closeModal = () => setCreateOpen(false);

  const handleTest = async (record: Server) => {
    setBusy(`test:${record.id}`);
    try {
      const res = await api.testServer(record.id);
      if (res.ok) {
        message.success(`${record.name} SSH 连接正常`);
      } else {
        message.error(`${record.name} 连接失败:${res.message ?? '未知原因'}`);
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : '测试失败');
    } finally {
      setBusy(null);
    }
  };

  const handleControl = async (
    action: 'install' | 'restart' | 'uninstall',
    record: Server,
  ) => {
    setBusy(`${action}:${record.id}`);
    try {
      const res =
        action === 'install'
          ? await api.installServer(record.id)
          : action === 'restart'
            ? await api.restartServer(record.id)
            : await api.uninstallServer(record.id);
      if ('error' in res) {
        message.error(`${CONTROL_LABEL[action]}失败:${res.error}`);
      } else {
        message.success(`${CONTROL_LABEL[action]} sing-box 成功`);
        reload();
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : '操作失败');
    } finally {
      setBusy(null);
    }
  };

  const handleScript = async (record: Server) => {
    setBusy(`script:${record.id}`);
    try {
      const res = await api.getInstallScript(record.id);
      setScriptModal({ server: record, script: res.script });
    } catch (err) {
      message.error(err instanceof Error ? err.message : '获取脚本失败');
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async (record: Server) => {
    try {
      await api.deleteServer(record.id);
      message.success(`已删除 ${record.name}`);
      reload();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  const columns: ColumnsType<Server> = [
    {
      title: '名称',
      dataIndex: 'name',
      width: 130,
      render: (value: string) => <Typography.Text strong>{value}</Typography.Text>,
    },
    {
      title: '角色',
      dataIndex: 'role',
      width: 90,
      render: (role: Server['role']) => (
        <Tag color={ROLE_META[role].tagColor}>{ROLE_META[role].text}</Tag>
      ),
    },
    {
      title: '控制',
      dataIndex: 'control',
      width: 90,
      render: (control: Server['control']) => (
        <Tag color={CONTROL_META[control].tagColor}>{CONTROL_META[control].text}</Tag>
      ),
    },
    {
      title: '地区',
      dataIndex: 'region',
      width: 70,
      render: (value: string) => <Typography.Text type="secondary">{value || '-'}</Typography.Text>,
    },
    {
      title: 'Host',
      dataIndex: 'host',
      render: (_: unknown, record) => (
        <Tooltip
          title={
            record.control === 'agent'
              ? 'agent 模式,地址由机器注册时上报'
              : `${record.ssh_user}@${record.host}:${record.ssh_port}(${record.ssh_auth_type === 'key' ? '私钥' : '密码'})`
          }
        >
          <Typography.Text code>{record.host || '-'}</Typography.Text>
        </Tooltip>
      ),
    },
    {
      title: '状态',
      dataIndex: 'ping_status',
      width: 90,
      render: (status: Server['ping_status']) => {
        const meta = SERVER_STATUS_META[status];
        return <Badge status={meta.status} text={meta.text} />;
      },
    },
    {
      title: 'sing-box',
      dataIndex: 'singbox_version',
      width: 90,
      render: (value: string) => <Typography.Text type="secondary">{value || '-'}</Typography.Text>,
    },
    {
      title: '最近探测/心跳',
      dataIndex: 'last_seen',
      width: 130,
      render: (value: string | null) => (
        <Typography.Text type="secondary">{formatRelativeTime(value)}</Typography.Text>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 420,
      render: (_, record) => {
        const agent = record.control === 'agent';
        return (
          <Space>
            {agent && (
              <Button
                type="link"
                icon={<CopyOutlined />}
                loading={busy === `script:${record.id}`}
                onClick={() => handleScript(record)}
              >
                安装脚本
              </Button>
            )}
            <Button
              type="link"
              loading={busy === `install:${record.id}`}
              onClick={() => handleControl('install', record)}
            >
              安装
            </Button>
            <Button
              type="link"
              loading={busy === `restart:${record.id}`}
              onClick={() => handleControl('restart', record)}
            >
              重启
            </Button>
            <Button
              type="link"
              loading={busy === `uninstall:${record.id}`}
              onClick={() => handleControl('uninstall', record)}
            >
              卸载
            </Button>
            {!agent && (
              <Button
                type="link"
                icon={<ApiOutlined />}
                loading={busy === `test:${record.id}`}
                onClick={() => handleTest(record)}
              >
                测连通
              </Button>
            )}
            <Button type="link" icon={<EditOutlined />} onClick={() => openEdit(record)}>
              编辑
            </Button>
            <Popconfirm
              title={`删除服务器 ${record.name}?`}
              description="同时移除其上节点配置;被节点引用时后端将拒绝删除。"
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={() => handleDelete(record)}
            >
              <Button type="link" danger icon={<DeleteOutlined />}>
                删除
              </Button>
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  return (
    <Flex vertical gap={16}>
      <Flex justify="space-between" align="center">
        <Typography.Title level={4} style={{ margin: 0 }}>
          服务器
        </Typography.Title>
        <Flex gap={8}>
          <Button
            icon={<ReloadOutlined />}
            loading={checking}
            onClick={handleCheck}
          >
            检查状态
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新增服务器
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

      <Table<Server>
        rowKey="id"
        columns={columns}
        dataSource={servers}
        loading={loading}
        pagination={false}
        locale={{
          emptyText: (
            <EmptyState
              description="还没有服务器。Agent 模式:创建后复制安装脚本到机器执行即自动上线;SSH 模式:填写凭据由面板直连。"
              action={
                <Button type="primary" onClick={openCreate}>
                  录入服务器
                </Button>
              }
            />
          ),
        }}
      />

      <ServerFormModal
        open={createOpen}
        record={editing}
        onClose={closeModal}
        onSaved={() => {
          closeModal();
          reload();
        }}
      />

      <InstallScriptModal
        open={scriptModal !== null}
        serverName={scriptModal?.server.name ?? ''}
        script={scriptModal?.script ?? ''}
        onClose={() => setScriptModal(null)}
      />
    </Flex>
  );
}