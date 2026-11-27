import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import path from 'path';
import { defineConfig } from 'vite';

// --- Etiqueta de versión de la web ---
// Número de versión: se lee del campo "version" de package.json.
const appVersion: string = JSON.parse(
  readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'),
).version;

// Fecha de armado (build) en formato dd/mm/aaaa, hora de Buenos Aires.
const buildDate = new Intl.DateTimeFormat('es-AR', {
  timeZone: 'America/Argentina/Buenos_Aires',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
}).format(new Date());

// Código corto del commit (7 caracteres). Nunca rompe el build:
// 1) variable de entorno COMMIT_SHA, 2) git, 3) "sin-commit".
function getCommitSha(): string {
  const fromEnv = process.env.COMMIT_SHA?.trim();
  if (fromEnv) return fromEnv.slice(0, 7);
  try {
    return execSync('git rev-parse --short=7 HEAD', {
      stdio: ['ignore', 'pipe', 'ignore'], // silencia los errores de git
    })
      .toString()
      .trim();
  } catch {
    return 'sin-commit';
  }
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __BUILD_DATE__: JSON.stringify(buildDate),
    __COMMIT_SHA__: JSON.stringify(getCommitSha()),
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  server: {
    hmr: process.env.DISABLE_HMR !== 'true',
  },
});
