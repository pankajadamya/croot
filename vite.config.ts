import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiTarget = env.VITE_API_PROXY_TARGET || `http://localhost:${env.PORT || 6021}`
  return {
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      port: Number(env.WEB_PORT) || 6020,
      strictPort: true,
      allowedHosts: true,
      proxy: {
        '^/api(/|$)': { target: apiTarget },
        '^/media(/|$)': { target: apiTarget },
        '^/health(/|$)': { target: apiTarget },
      },
    },
  }
})
