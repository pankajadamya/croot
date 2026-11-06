import { readFileSync } from 'node:fs'

/**
 * The release that is running: package.json's version (bumped with every commit, see AGENTS.md) and
 * the git commit it was built from (Coolify passes SOURCE_COMMIT; the Dockerfile stores it as GIT_SHA).
 */
export const appVersion: string = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')).version

const sha = process.env.GIT_SHA
export const appCommit: string | null = sha && sha !== 'unknown' ? sha.slice(0, 12) : null

export const release = { app: 'Croot', version: appVersion, commit: appCommit }
