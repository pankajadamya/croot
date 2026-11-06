/// <reference types="vite/client" />

/** package.json's version, read at build time (vite.config.ts: appVersionPlugin). */
declare module 'virtual:app-version' {
  export const appVersion: string
}
