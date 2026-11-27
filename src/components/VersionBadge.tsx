// Etiqueta discreta con la versión de la web y la fecha de armado.
// Los valores los inyecta Vite al armar la web (ver vite.config.ts → define).
export default function VersionBadge() {
  return (
    <div className="mt-2 text-center text-zinc-600 text-[10px] font-mono tracking-wider select-all">
      v{__APP_VERSION__} · {__BUILD_DATE__}
    </div>
  );
}
