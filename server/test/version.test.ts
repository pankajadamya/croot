import { readFileSync } from 'node:fs'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { app } from './helpers.js'

const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))

describe('release version', () => {
  it('health checks say which release is serving', async () => {
    expect(version).toMatch(/^\d+\.\d+\.\d+$/)
    const live = await request(app).get('/health/live')
    expect(live.body).toMatchObject({ ok: true, app: 'Croot', version })
    const ready = await request(app).get('/health/ready')
    expect(ready.body).toMatchObject({ ok: true, db: 'up', app: 'Croot', version })
  })

  it('package.json and package-lock.json agree on the version', () => {
    const lock = JSON.parse(readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8'))
    expect([lock.version, lock.packages[''].version]).toEqual([version, version])
  })
})
