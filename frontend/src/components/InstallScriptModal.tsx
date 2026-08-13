import { useState } from 'react';
import { Alert, App, Button, Flex, Modal, Typography } from 'antd';
import { CopyOutlined } from '@ant-design/icons';

interface InstallScriptModalProps {
  open: boolean;
  serverName: string;
  script: string;
  onClose: () => void;
}

/** agent 安装脚本弹窗:复制脚本到目标机器执行,机器自动注册上线 */
export function InstallScriptModal({ open, serverName, script, onClose }: InstallScriptModalProps) {
  const { message } = App.useApp();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(script);
      setCopied(true);
      message.success('脚本已复制,请到目标机器以 root 执行');
    } catch {
      message.error('复制失败,请手动选择复制');
    }
  };

  return (
    <Modal
      open={open}
      title={`安装脚本 — ${serverName}`}
      okText="关闭"
      cancelText="取消"
      onOk={onClose}
      onCancel={onClose}
      width={640}
    >
      <Flex vertical gap={12}>
        <Alert
          type="info"
          showIcon
          message="在目标机器上以 root 执行下面脚本"
          description="脚本会注册该机器到面板(agent 模式),之后即可在面板执行 安装/重启/卸载 sing-box。凭据由面板自动管理,脚本无需保存。"
        />
        <Flex
          vertical
          style={{ maxHeight: 320, overflow: 'auto' }}
        >
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              margin: 0,
            }}
          >
            {script}
          </pre>
        </Flex>
        <Flex gap={8}>
          <Button type="primary" icon={<CopyOutlined />} onClick={handleCopy}>
            {copied ? '已复制' : '复制脚本'}
          </Button>
          <Typography.Text type="secondary">复制后到机器上执行即可</Typography.Text>
        </Flex>
      </Flex>
    </Modal>
  );
}