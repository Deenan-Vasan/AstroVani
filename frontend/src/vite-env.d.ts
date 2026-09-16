/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Absolute origin of the AstroVani backend, e.g. https://astrovani.agoraaidemo.in.
   * Leave unset for local development: requests stay relative and the Vite dev
   * server proxies /api to the local backend.
   */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
