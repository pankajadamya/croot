import { spawn, execSync, type ChildProcess } from 'node:child_process'
import { createConnection } from 'node:net'

/**
 * Starts a throwaway in-memory Postgres (PGlite) on 6433 and applies migrations, unless
 * TEST_DATABASE_URL points at a real server (CI can use a Postgres service instead).
 */
let server: ChildProcess | undefined

function waitForPort(port: number, timeoutMs = 30_000) {
  const start = Date.now()
  return new Promise<void>((resolve, reject) => {
    const attempt = () => {
      const socket = createConnection(port, '127.0.0.1')
      socket.once('connect', () => {
        socket.end()
        resolve()
      })
      socket.once('error', () => {
        socket.destroy()
        if (Date.now() - start > timeoutMs) reject(new Error('Test database did not start'))
        else setTimeout(attempt, 250)
      })
    }
    attempt()
  })
}

export async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:6433/postgres?sslmode=disable'
  if (!process.env.TEST_DATABASE_URL) {
    server = spawn('npx', ['pglite-server', '--db=memory://', '--port=6433', '--max-connections=5'], { shell: true, stdio: 'ignore' })
    await waitForPort(6433)
  }
  execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: url }, stdio: 'ignore' })
}

export async function teardown() {
  if (server?.pid) {
    if (process.platform === 'win32') execSync(`taskkill /pid ${server.pid} /T /F`, { stdio: 'ignore' })
    else server.kill('SIGTERM')
  }
}
