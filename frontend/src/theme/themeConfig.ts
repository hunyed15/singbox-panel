import { theme } from 'antd';

/**
 * 全局主题配置(全项目唯一允许出现具体取值的文件)。
 *
 * - 品牌主色 = antd 默认蓝(确认门 1 选 A),零配置,不设 colorPrimary
 * - V1 不做暗色;未来如需切换:algorithm: theme.darkAlgorithm
 * - 页面与组件代码禁止出现色值/字号,一律走 antd token
 */
export const themeConfig = {
  algorithm: theme.defaultAlgorithm,
};