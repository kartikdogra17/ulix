/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ULIP_MODE?: 'live' | 'mock'
  readonly VITE_ULIP_PROXY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
