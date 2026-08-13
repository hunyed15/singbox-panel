/**
 * 接口层选择:
 * - 默认 mock(后端未就绪时前端可独立开发,同契约)
 * - VITE_USE_MOCK=false 走真实 HTTP 实现(联调)
 * UI 不感知切换;契约差异在实现层消化。
 */
import * as http from './http';
import * as mock from './mock';
import type { ApiModule } from './types';

const useMock = import.meta.env.VITE_USE_MOCK !== 'false';

export const api: ApiModule = useMock ? mock : http;