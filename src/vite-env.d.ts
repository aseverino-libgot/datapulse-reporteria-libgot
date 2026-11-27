/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GEMINI_API_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __GEMINI_API_KEY__: string;

// Etiqueta de versión (definidas en vite.config.ts → define)
declare const __APP_VERSION__: string;
declare const __BUILD_DATE__: string;
declare const __COMMIT_SHA__: string;

declare module "*?url" {
  const content: string;
  export default content;
}
