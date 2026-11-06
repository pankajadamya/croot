import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const packageJsonUrl = new URL('./package.json', import.meta.url)
const VERSION_MODULE = 'virtual:app-version'

/**
 * package.json's version as a module (as in Collab): read on each build, so a version bump made
 * while the dev server runs shows after an ordinary reload instead of needing a restart.
 */
function appVersionPlugin(): Plugin {
  const resolvedId = `\0${VERSION_MODULE}`
  return {
    name: 'app-version',
    resolveId: (id) => (id === VERSION_MODULE ? resolvedId : null),
    load(id) {
      if (id !== resolvedId) return null
      const version = JSON.parse(readFileSync(packageJsonUrl, 'utf8')).version
      return `export const appVersion = ${JSON.stringify(version)}\n`
    },
    configureServer(server) {
      const packageJsonPath = fileURLToPath(packageJsonUrl)
      server.watcher.add(packageJsonPath)
      server.watcher.on('change', (changed) => {
        if (changed !== packageJsonPath) return
        const module = server.moduleGraph.getModuleById(resolvedId)
        if (module) server.moduleGraph.invalidateModule(module)
        server.ws.send({ type: 'full-reload' })
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiTarget = env.VITE_API_PROXY_TARGET || `http://localhost:${env.PORT || 6021}`
  return {
    plugins: [react(), appVersionPlugin()],
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
