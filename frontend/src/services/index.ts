/**
 * 接口层选择:
 * - 默认走真实 HTTP(生产必须);仅前端开发、后端未就绪时显式设 VITE_USE_MOCK=true 用内存 mock
 * - 联调/换实现都在此开关;UI 不感知
 */
import * as http from './http';
import * as mock from './mock';
import type { ApiModule } from './types';

const useMock = import.meta.env.VITE_USE_MOCK === 'true';

export const api: ApiModule = useMock ? mock : http;