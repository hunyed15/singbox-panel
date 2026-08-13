import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 开发代理:前端默认 5173,后端 Express 默认 8081
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8081',
      '/sub': 'http://127.0.0.1:8081',
    },
  },
});