import { useEffect, useState } from 'react';
import { Alert, App, Flex, Form, Input, InputNumber, Modal, Select, Switch } from 'antd';
import { api } from '../services';
import type { ControlMode, Server, ServerInput, ServerRole, SshAuthType } from '../services/types';

interface ServerFormModalProps {
  open: boolean;
  record: Server | null;
  onClose: () => void;
  onSaved: () => void;
}

interface FormValues {
  name: string;
  role: ServerRole;
  control: ControlMode;
  region: string;
  host: string;
  clientHost: string;
  sshPort: number;
  sshUser: string;
  sshAuthType: SshAuthType;
  sshAuthSecret: string;
  sshSudo: boolean;
}

const ROLE_OPTIONS = [
  { value: 'relay' as const, label: '中转机' },
  { value: 'landing' as const, label: '落地机' },
];

const CONTROL_OPTIONS = [
  { value: 'agent' as const, label: 'Agent(脚本注册,无需 SSH)' },
  { value: 'ssh' as const, label: 'SSH(面板直连)' },
];

const AUTH_OPTIONS = [
  { value: 'key' as const, label: 'SSH 私钥' },
  { value: 'password' as const, label: 'SSH 密码' },
];

/**
 * 服务器新增/编辑弹窗。
 * 控制方式联动:agent = 机器跑安装脚本自动注册;ssh = 面板直连(需凭据,不回显,留空不修改)。
 */
export function ServerFormModal({ open, record, onClose, onSaved }: ServerFormModalProps) {
  const [form] = Form.useForm<FormValues>();
  const { message } = App.useApp();
  const [saving, setSaving] = useState(false);
  const control = Form.useWatch('control', form) ?? ('agent' as ControlMode);
  const authType = Form.useWatch('sshAuthType', form) ?? ('key' as SshAuthType);
  const isEdit = record !== null;

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    if (record) {
      form.setFieldsValue({
        name: record.name,
        role: record.role,
        control: record.control,
        region: record.region,
        host: record.host,
        clientHost: record.client_host ?? '',
        sshPort: record.ssh_port,
        sshUser: record.ssh_user,
        sshAuthType: record.ssh_auth_type,
        sshAuthSecret: '',
        sshSudo: record.ssh_sudo === 1,
      });
    } else {
      form.setFieldsValue({
        name: '',
        role: 'relay',
        control: 'agent',
        region: '',
        host: '',
        clientHost: '',
        sshPort: 22,
        sshUser: 'root',
        sshAuthType: 'key',
        sshAuthSecret: '',
        sshSudo: false,
      });
    }
  }, [open, record, form]);

  const handleOk = async () => {
    let values: FormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSaving(true);
    try {
      const base: ServerInput = {
        name: values.name,
        role: values.role,
        control: values.control,
        region: values.region,
      };
      if (values.control === 'ssh') {
        base.host = values.host;
        base.clientHost = values.clientHost;
        base.sshPort = Number(values.sshPort);
        base.sshUser = values.sshUser;
        base.sshAuthType = values.sshAuthType;
        base.sshAuthSecret = values.sshAuthSecret;
        base.sshSudo = values.sshSudo;
      }
      if (isEdit) {
        const secret = values.sshAuthSecret?.trim();
        await api.updateServer(
          record.id,
          secret ? { ...base, sshAuthSecret: secret } : base,
        );
      } else {
        await api.createServer(base);
      }
      message.success(isEdit ? '已保存' : '已创建');
      onSaved();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={isEdit ? '编辑服务器' : '新增服务器'}
      okText={isEdit ? '保存' : '创建'}
      cancelText="取消"
      width={560}
      confirmLoading={saving}
      maskClosable={false}
      destroyOnHidden
      onOk={handleOk}
      onCancel={onClose}
    >
      <Form form={form} layout="vertical" requiredMark={false}>
        <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
          <Input placeholder="HK1" />
        </Form.Item>
        <Flex gap={16}>
          <Form.Item
            name="role"
            label="角色"
            rules={[{ required: true, message: '请选择角色' }]}
            style={{ flex: 1 }}
          >
            <Select options={ROLE_OPTIONS} />
          </Form.Item>
          <Form.Item
            name="region"
            label="地区"
            rules={[{ required: true, message: '请输入地区' }]}
            style={{ flex: 1 }}
          >
            <Input placeholder="HK / KR / JP / US" />
          </Form.Item>
        </Flex>
        <Form.Item name="control" label="控制方式" rules={[{ required: true }]}>
          <Select options={CONTROL_OPTIONS} />
        </Form.Item>

        {control === 'agent' ? (
          <Alert
            type="info"
            showIcon
            message="Agent 模式"
            description="创建后回到服务器列表,点击「安装脚本」复制到目标机器执行,机器会自动注册上线;面板可执行 安装/重启/卸载 sing-box。无需面板能连到机器。"
          />
        ) : (
          <>
            <Form.Item
              name="host"
              label="主机地址"
              rules={[{ required: true, message: '请输入主机地址' }]}
            >
              <Input placeholder="1.2.3.4" />
            </Form.Item>
            <Form.Item
              name="clientHost"
              label="对外地址(可选)"
              tooltip="客户端/其他机器连接用的地址;SSH 目标与对外地址不同时填(如面板本机=127.0.0.1 但对外是公网 IP);留空=用主机地址"
            >
              <Input placeholder="留空则用主机地址" />
            </Form.Item>
            <Flex gap={16}>
              <Form.Item
                name="sshPort"
                label="SSH 端口"
                rules={[{ required: true, message: '请输入端口' }]}
                style={{ flex: 1 }}
              >
                <InputNumber placeholder="22" style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item
                name="sshUser"
                label="SSH 用户"
                rules={[{ required: true, message: '请输入用户' }]}
                style={{ flex: 1 }}
              >
                <Input placeholder="root" />
              </Form.Item>
            </Flex>
            <Form.Item name="sshAuthType" label="认证方式" rules={[{ required: true }]}>
              <Select options={AUTH_OPTIONS} />
            </Form.Item>
            <Form.Item name="sshSudo" label="需要 sudo" valuePropName="checked" tooltip="甲骨文等机器默认用户非 root(如 opc/ubuntu),命令需 sudo 提权;勾选后所有命令经 sudo -n 执行(需该用户免密 sudo)">
              <Switch />
            </Form.Item>
            <Form.Item
              name="sshAuthSecret"
              label={authType === 'key' ? '私钥内容' : 'SSH 密码'}
              rules={
                isEdit
                  ? []
                  : [
                      {
                        required: true,
                        message: authType === 'key' ? '请粘贴私钥内容' : '请输入 SSH 密码',
                      },
                    ]
              }
            >
              {authType === 'key' ? (
                <Input.TextArea
                  rows={5}
                  placeholder={isEdit ? '私钥内容(留空表示不修改)' : '粘贴 SSH 私钥原文'}
                />
              ) : (
                <Input.Password placeholder={isEdit ? '密码(留空表示不修改)' : 'SSH 登录密码'} />
              )}
            </Form.Item>
          </>
        )}
      </Form>
    </Modal>
  );
}