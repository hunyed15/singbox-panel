import { useEffect, useState } from 'react';
import {
  Alert,
  App,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  Segmented,
  Select,
  Switch,
  Typography,
} from 'antd';
import { api } from '../services';
import type {
  DeployResult,
  NodeItem,
  NodeProtocol,
  OutboundType,
  Server,
  SniItem,
} from '../services/types';
import { PROTOCOL_META } from '../utils/status';

interface NodeEditModalProps {
  open: boolean;
  node: NodeItem | null;
  landings: Server[];
  snis: SniItem[];
  onClose: () => void;
  onSaved: (result: { node: NodeItem; deploy: DeployResult | null }) => void;
}

interface FormValues {
  protocol: NodeProtocol;
  name: string;
  note: string;
  enabled: boolean;
  port: number;
  outboundType: OutboundType;
  landingServerId?: number;
  sni?: string;
  tunnelAddress?: string;
  tunnelPort?: number;
}

const PROTOCOL_OPTIONS = (Object.keys(PROTOCOL_META) as NodeProtocol[]).map((p) => ({
  value: p,
  label: PROTOCOL_META[p].text,
}));

const OUTBOUND_OPTIONS = [
  { label: '直连', value: 'direct' },
  { label: '中转', value: 'relay' },
];

/**
 * 节点编辑:名称/备注/启停/端口/出口/SNI/协议。
 * 改协议 = 凭据自动重新生成(后端),客户端需更新;入口机不可改(迁移=删除重建)。
 */
export function NodeEditModal({ open, node, landings, snis, onClose, onSaved }: NodeEditModalProps) {
  const [form] = Form.useForm<FormValues>();
  const { message } = App.useApp();
  const [saving, setSaving] = useState(false);
  const protocol = Form.useWatch('protocol', form) ?? node?.protocol;
  const outboundType = Form.useWatch('outboundType', form) ?? node?.outbound_type;

  const landingOptions = landings.map((s) => ({ value: s.id, label: `${s.name} · ${s.host}` }));
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
      outboundType: node.outbound_type,
      landingServerId: node.landing_server_id,
      sni: node.sni,
      tunnelAddress: node.tunnel_address,
      tunnelPort: node.tunnel_port,
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
      const isTunnel = values.protocol === 'tunnel';
      const result = await api.updateNode(node.id, {
        name: values.name,
        note: values.note,
        enabled: values.enabled,
        port: Number(values.port),
        outboundType: isTunnel ? 'direct' : values.outboundType,
        landingServerId:
          !isTunnel && values.outboundType === 'relay'
            ? Number(values.landingServerId)
            : undefined,
        protocol: values.protocol,
        sni:
          !isTunnel && (values.protocol === 'vless' || values.protocol === 'shadowtls')
            ? values.sni
            : undefined,
        tunnelAddress: isTunnel ? values.tunnelAddress : undefined,
        tunnelPort: isTunnel && values.tunnelPort ? Number(values.tunnelPort) : undefined,
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
      title={`编辑节点 — ${node?.name ?? ''}`}
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
            description="保存后将重新生成凭据(UUID/密码),客户端需更新分享链接或重新拉取订阅。"
            style={{ marginBottom: 16 }}
          />
        )}
        <Flex gap={16}>
          <Form.Item
            name="name"
            label="名称"
            rules={[{ required: true, message: '请输入名称' }]}
            style={{ flex: 1 }}
          >
            <Input />
          </Form.Item>
          <Form.Item name="note" label="备注" style={{ flex: 1 }}>
            <Input />
          </Form.Item>
        </Flex>
        <Flex gap={16}>
          <Form.Item
            name="port"
            label="端口"
            rules={[{ required: true, message: '请输入端口' }]}
            style={{ flex: 1 }}
          >
            <InputNumber style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="enabled" label="启用" valuePropName="checked" style={{ flex: 1 }}>
            <Switch />
          </Form.Item>
        </Flex>
        {protocol !== 'tunnel' && (
          <Form.Item name="outboundType" label="出口">
            <Segmented options={OUTBOUND_OPTIONS} block />
          </Form.Item>
        )}
        {protocol === 'tunnel' && (
          <>
            <Form.Item
              name="tunnelAddress"
              label="转发目标地址(IPv4 / IPv6 / 域名)"
              rules={[{ required: true, message: '请输入目标地址' }]}
            >
              <Input placeholder="2001:db8::1 或 1.2.3.4 或 example.com" />
            </Form.Item>
            <Form.Item
              name="tunnelPort"
              label="转发目标端口"
              rules={[{ required: true, message: '请输入目标端口' }]}
            >
              <InputNumber style={{ width: '100%' }} />
            </Form.Item>
          </>
        )}
        {protocol !== 'tunnel' && outboundType === 'relay' && (
          <Form.Item
            name="landingServerId"
            label="中转落地机(客户端经入口机 → 该落地机出网)"
            rules={[{ required: true, message: '请选择落地机' }]}
          >
            <Select options={landingOptions} />
          </Form.Item>
        )}
        {protocol === 'naive' && (
          <Alert
            type="warning"
            showIcon
            message="Naive 需要真实 TLS 证书才有抗封锁价值"
            description="面板将生成自签证书,客户端需开启「允许不安全连接」。建议未来为 Naive 配置真实证书或 CDN。"
            style={{ marginBottom: 16 }}
          />
        )}
        {(protocol === 'vless' || protocol === 'shadowtls') && (
          <Form.Item
            name="sni"
            label={
              protocol === 'vless' ? 'Reality 借站域名(SNI)' : 'ShadowTLS 握手借站域名(SNI)'
            }
          >
            <Select options={sniOptions} />
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
}