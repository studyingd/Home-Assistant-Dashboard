import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // 开发时把 /api 和 WebSocket 代理给 Node 后端 5174；业务配置由 PostgreSQL 提供。
    proxy: {
      '/api': {
        target: 'http://localhost:5174',
        ws: true,
      },
    },
  },
})
