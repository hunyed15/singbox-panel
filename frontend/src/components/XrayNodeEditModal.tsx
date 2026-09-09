import { useEffect, useState } from 'react';
import { Alert, App, Flex, Form, Input, InputNumber, Modal, Select, Switch, Typography } from 'antd';
import { api } from '../services';
import type { DeployResult, SniItem, XrayNodeItem, XrayNodeProtocol } from '../services/types';
import { XRAY_PROTOCOL_META } from '../utils/status';

interface XrayNodeEditModalProps {
  open: boolean;
  node: XrayNodeItem | null;
  snis: SniItem[];
  onClose: () => void;
  onSaved: (result: { node: XrayNodeItem; deploy: DeployResult | null }) => void;
}

interface FormValues {
  protocol: XrayNodeProtocol;
  name: string;
  note: string;
  enabled: boolean;
  port: number;
  sni?: string;
  flow?: string;
}

const PROTOCOL_OPTIONS = (Object.keys(XRAY_PROTOCOL_META) as XrayNodeProtocol[]).map((p) => ({
  value: p,
  label: XRAY_PROTOCOL_META[p].text,
}));

export function XrayNodeEditModal({ open, node, snis, onClose, onSaved }: XrayNodeEditModalProps) {
  const [form] = Form.useForm<FormValues>();
  const { message } = App.useApp();
  const [saving, setSaving] = useState(false);
  const protocol = Form.useWatch('protocol', form) ?? node?.protocol;

  const sniOptions = snis.map((s) => ({
    value: s.domain,
    label: s.note ? `${s.domain} · ${s.note}` : s.domain,
  }));

  useEffect(() => {
    if (!open || !node) return;
    form.resetFields();
    form.setFieldsValue({
      protocol: node.protocol,
      name: node.name,
      note: node.note,
      enabled: node.enabled === 1,
      port: node.listen_port,
      sni: node.sni,
      flow: node.flow || '',
    });
  }, [open, node, form]);

  const handleOk = async () => {
    if (!node) return;
    let values: FormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSaving(true);
    try {
      const result = await api.updateXrayNode(node.id, {
        name: values.name,
        note: values.note,
        enabled: values.enabled,
        port: Number(values.port),
        protocol: values.protocol,
        sni: values.protocol === 'vless' ? values.sni : undefined,
        flow: values.protocol === 'vless' ? (values.flow || 'xtls-rprx-vision') : undefined,
      });
      onSaved(result);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={`编辑 Xray 节点 — ${node?.name ?? ''}`}
      okText="保存"
      cancelText="取消"
      width={640}
      confirmLoading={saving}
      maskClosable={false}
      destroyOnHidden
      onOk={handleOk}
      onCancel={onClose}
    >
      <Form form={form} layout="vertical" requiredMark={false}>
        <Form.Item label="入口机">
          <Typography.Text>{node?.server_name}</Typography.Text>
        </Form.Item>
        <Form.Item name="protocol" label="协议" rules={[{ required: true }]}>
          <Select options={PROTOCOL_OPTIONS} />
        </Form.Item>
        {protocol && node && protocol !== node.protocol && (
          <Alert
            type="warning"
            showIcon
            message="协议已变更"
            description="保存后将重新生成凭据(UUID/密码),客户端需更新分享链接。"
            style={{ marginBottom: 16 }}
          />
        )}
        <Flex gap={16}>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]} style={{ flex: 1 }}>
            <Input />
          </Form.Item>
          <Form.Item name="note" label="备注" style={{ flex: 1 }}>
            <Input />
          </Form.Item>
        </Flex>
        <Flex gap={16}>
          <Form.Item name="port" label="端口" rules={[{ required: true, message: '请输入端口' }]} style={{ flex: 1 }}>
            <InputNumber style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="enabled" label="启用" valuePropName="checked" style={{ flex: 1 }}>
            <Switch />
          </Form.Item>
        </Flex>
        {protocol === 'vless' && (
          <>
            <Form.Item name="sni" label="Reality 借站域名(SNI)">
              <Select options={sniOptions} />
            </Form.Item>
            <Form.Item name="flow" label="Flow 控制" tooltip="xtls-rprx-vision 为推荐的 VLESS 流控">
              <Input placeholder="xtls-rprx-vision" />
            </Form.Item>
          </>
        )}
      </Form>
    </Modal>
  );
}