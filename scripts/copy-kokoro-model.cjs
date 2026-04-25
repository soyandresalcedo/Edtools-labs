/**
 * Auto-host del modelo Kokoro (q8) y voces en /public/vendors-tts/models/<modelId>/.
 *
 * - Idempotente: si el archivo existe y su tamaño coincide con el HEAD remoto, lo salta.
 * - Si HEAD falla (sin red) y el archivo está en disco, conserva la copia local.
 * - Archivos opcionales (special_tokens_map.json, etc.) toleran 404 silenciosamente.
 *
 * Source of truth de voces: src/lib/kokoroVoices.json (compartido con el cliente TS).
 */
const fs = require("fs");
const path = require("path");
const { pipeline } = require("stream/promises");
const { Readable } = require("stream");

const root = path.join(__dirname, "..");
const voicesJsonPath = path.join(root, "src", "lib", "kokoroVoices.json");

if (!fs.existsSync(voicesJsonPath)) {
  console.error(`[copy-kokoro-model] missing ${voicesJsonPath}`);
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(voicesJsonPath, "utf8"));
const MODEL_ID = String(config.modelId);
const REVISION = String(config.revision ?? "main");
const VOICES = Array.isArray(config.voices) ? config.voices : [];

if (!MODEL_ID || VOICES.length === 0) {
  console.error("[copy-kokoro-model] kokoroVoices.json: falta modelId o voices[]");
  process.exit(1);
}

const HF_BASE = "https://huggingface.co";
const outRoot = path.join(root, "public", "vendors-tts", "models", MODEL_ID);

// kokoro-js + transformers para dtype="q8" piden el sufijo "_quantized"
// (ver DEFAULT_DTYPE_SUFFIX_MAPPING en @huggingface/transformers).
const REQUIRED_FILES = [
  "config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "onnx/model_quantized.onnx",
  ...VOICES.map((v) => `voices/${v.id}.bin`),
];

// Best-effort: muchos repos los tienen, transformers/AutoTokenizer puede pedirlos.
// Si HF responde 404, los saltamos sin error.
const OPTIONAL_FILES = [
  "special_tokens_map.json",
  "generation_config.json",
  "added_tokens.json",
];

function buildRemoteUrl(filePath) {
  return `${HF_BASE}/${MODEL_ID}/resolve/${REVISION}/${filePath}`;
}

function buildLocalPath(filePath) {
  return path.join(outRoot, filePath);
}

async function getRemoteSize(url) {
  try {
    const res = await fetch(url, { method: "HEAD", redirect: "follow" });
    if (!res.ok) return { ok: false, status: res.status, size: null };
    // HuggingFace expone X-Linked-Size con el tamaño real del archivo (sin
    // compresión). Para archivos pequeños el content-length viene comprimido
    // (gzip) y no coincide con lo que Node escribe a disco al hacer GET.
    const linked = res.headers.get("x-linked-size");
    const len = res.headers.get("content-length");
    const raw = linked ?? len;
    const size = raw ? Number(raw) : null;
    return { ok: true, status: res.status, size: Number.isFinite(size) ? size : null };
  } catch (e) {
    return { ok: false, status: 0, size: null, error: e?.message ?? String(e) };
  }
}

async function downloadFile(url, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  if (!res.body) {
    throw new Error(`empty body for ${url}`);
  }
  const tmp = `${dest}.partial`;
  const stream = Readable.fromWeb(res.body);
  await pipeline(stream, fs.createWriteStream(tmp));
  fs.renameSync(tmp, dest);
}

async function processFile(filePath, { optional = false } = {}) {
  const url = buildRemoteUrl(filePath);
  const dest = buildLocalPath(filePath);
  const exists = fs.existsSync(dest);
  const localSize = exists ? fs.statSync(dest).size : null;

  const head = await getRemoteSize(url);

  if (!head.ok) {
    if (head.status === 404) {
      if (exists) {
        console.log(
          `[copy-kokoro-model] keep ${filePath} (remote 404, ${localSize} bytes locally)`,
        );
        return;
      }
      if (optional) {
        console.log(`[copy-kokoro-model] skip ${filePath} (optional, remote 404)`);
        return;
      }
      throw new Error(`Required file missing remote and local: ${filePath}`);
    }
    if (exists) {
      console.log(
        `[copy-kokoro-model] HEAD failed for ${filePath} (status=${head.status}); keeping local copy (${localSize} bytes)`,
      );
      return;
    }
    if (optional) {
      console.log(
        `[copy-kokoro-model] skip ${filePath} (optional, HEAD failed status=${head.status})`,
      );
      return;
    }
    throw new Error(
      `HEAD failed for required file ${filePath}: status=${head.status}${head.error ? ` (${head.error})` : ""}`,
    );
  }

  if (exists && head.size === null) {
    // HEAD ok pero no dió content-length confiable (e.g. transfer-encoding:
    // chunked tras seguir el redirect en Node fetch). Asumimos que el archivo
    // local es válido para preservar idempotencia.
    console.log(
      `[copy-kokoro-model] skip ${filePath} (${localSize} bytes; HEAD sin size, asumiendo OK)`,
    );
    return;
  }
  if (exists && head.size !== null && head.size === localSize) {
    console.log(`[copy-kokoro-model] skip ${filePath} (${localSize} bytes)`);
    return;
  }
  if (exists && head.size !== null && head.size !== localSize) {
    console.log(
      `[copy-kokoro-model] size mismatch ${filePath} (local=${localSize}, remote=${head.size}) — re-downloading`,
    );
  } else if (!exists) {
    console.log(`[copy-kokoro-model] download ${filePath}`);
  }

  await downloadFile(url, dest);
  const finalSize = fs.statSync(dest).size;
  console.log(`[copy-kokoro-model] saved ${filePath} (${finalSize} bytes)`);
}

(async () => {
  try {
    fs.mkdirSync(outRoot, { recursive: true });
    for (const f of REQUIRED_FILES) {
      await processFile(f, { optional: false });
    }
    for (const f of OPTIONAL_FILES) {
      await processFile(f, { optional: true });
    }
    console.log(
      `[copy-kokoro-model] done → ${path.relative(root, outRoot)} (model=${MODEL_ID}@${REVISION})`,
    );
  } catch (e) {
    console.error("[copy-kokoro-model] failed:", e?.message ?? e);
    process.exit(1);
  }
})();
