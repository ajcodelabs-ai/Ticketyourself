/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_BACKEND_URL: string
  readonly VITE_PUBLIC_DOMAIN: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}
