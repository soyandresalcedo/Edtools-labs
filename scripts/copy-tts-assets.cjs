/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Copy Kokoro web bundle + onnxruntime-web dist (sin .map) a public/ para
 * import nativo con webpackIgnore: deja de intentar empaquetar new URL(…ort…) en el cliente.
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const outDir = path.join(root, "public", "vendors-tts");

function resolveOrThrow(spec) {
  return require.resolve(spec, { paths: [root] });
}

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function copyDirExcludingMap(srcDir, destDir) {
  for (const name of fs.readdirSync(srcDir)) {
    if (name.endsWith(".map")) continue;
    const s = path.join(srcDir, name);
    const d = path.join(destDir, name);
    const st = fs.statSync(s);
    if (st.isDirectory()) {
      copyDirExcludingMap(s, d);
    } else {
      copyFile(s, d);
    }
  }
}

try {
  const kokoroWeb = path.join(
    path.dirname(resolveOrThrow("kokoro-js")),
    "kokoro.web.js",
  );
  if (!fs.existsSync(kokoroWeb)) {
    throw new Error(`Missing ${kokoroWeb}`);
  }

  const ortEntry = resolveOrThrow("onnxruntime-web");
  const m = ortEntry.match(/^(.*[\\/]onnxruntime-web)[\\/]dist[\\/]/);
  if (!m) {
    throw new Error(
      `Could not find onnx dist folder from entry: ${ortEntry}`,
    );
  }
  const ortDist = path.join(m[1], "dist");
  if (!fs.existsSync(ortDist)) {
    throw new Error(`Missing onnx dist: ${ortDist}`);
  }

  // NOTE: NO `rmSync(outDir)` — la carpeta `public/vendors-tts/models/` es
  // gestionada por `scripts/copy-kokoro-model.cjs` (binarios pesados, ~85 MB).
  // Hacer rm aquí forzaría re-descargar el modelo en cada `pnpm dev`.
  // Las copias de runtime (`kokoro.web.js`, ORT) hacen overwrite igualmente.
  fs.mkdirSync(outDir, { recursive: true });

  copyFile(kokoroWeb, path.join(outDir, "kokoro.web.js"));
  // Mismo directorio que kokoro.web.js: new URL("ort.bundle.min.mjs", import.meta.url)
  copyDirExcludingMap(ortDist, outDir);
  console.log(
    `[copy-tts-assets] → ${path.relative(
      root,
      outDir,
    )} (onnx from ${path.relative(root, ortDist)}, flat)`,
  );
} catch (e) {
  console.error("[copy-tts-assets] failed:", e.message);
  process.exit(1);
}
