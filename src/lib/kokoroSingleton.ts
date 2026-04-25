"use client";

/**
 * KokoroTTS Singleton — Module-level instance manager.
 *
 * Mantiene una única instancia de KokoroTTS por pestaña, sobreviviendo a remounts
 * de componentes y a navegaciones cliente (no a reload completo). Combinado con
 * los headers HTTP `Cache-Control: immutable` en `/vendors-tts/*`, los reloads
 * sirven el modelo desde disk/memory cache sin re-descargar.
 *
 * Estrategia de carga local
 * -------------------------
 * `kokoro.web.js` es un bundle self-contained con SU PROPIA copia bundleada de
 * `@huggingface/transformers`. Por eso configurar `env.allowLocalModels` /
 * `env.localModelPath` en la copia importada por webpack NO afecta a kokoro-js.
 *
 * En su lugar pre-llenamos las dos Cache Storage que el bundle de kokoro-js
 * consulta antes de tocar la red:
 *
 *   1. `transformers-cache` → archivos del modelo (config, tokenizer, ONNX) bajo
 *      la URL canónica de HuggingFace como key. transformers-bundle.useBrowserCache
 *      es `true` por default, por lo que mira ahí primero.
 *   2. `kokoro-voices` → archivos `.bin` de voces, key = URL HF. kokoro-js los pide
 *      con `fetch()` directo y cachea contra esa cache.
 *
 * Las copias locales viven en `/vendors-tts/models/<modelId>/...` (descargadas
 * por `scripts/copy-kokoro-model.cjs` en build/dev). Same-origin + immutable.
 */

import {
  DEFAULT_KOKORO_VOICE,
  isKokoroVoiceId,
  KOKORO_MODEL_ID,
  KOKORO_REVISION,
  KOKORO_VOICES,
  VOICE_KEY,
} from "./kokoroVoices";

type KokoroModule = typeof import("kokoro-js");
export type KokoroTTS = InstanceType<KokoroModule["KokoroTTS"]>;

export type KokoroLoadState =
  | { status: "idle" }
  | { status: "loading"; progress: number | null }
  | { status: "ready" }
  | { status: "failed"; error: string };

let instance: KokoroTTS | null = null;
let loadingPromise: Promise<KokoroTTS> | null = null;
let state: KokoroLoadState = { status: "idle" };
const subscribers = new Set<(s: KokoroLoadState) => void>();

function setState(next: KokoroLoadState): void {
  state = next;
  subscribers.forEach((cb) => {
    try {
      cb(state);
    } catch {
      // suscripción rota, ignorar
    }
  });
}

export function getKokoroState(): KokoroLoadState {
  return state;
}

export function subscribeKokoro(
  cb: (s: KokoroLoadState) => void,
): () => void {
  subscribers.add(cb);
  // Emitir estado actual para que el consumer no quede a ciegas si se subscribe tarde.
  try {
    cb(state);
  } catch {
    // ignorar
  }
  return () => {
    subscribers.delete(cb);
  };
}

export function resetKokoroSingleton(): void {
  instance = null;
  loadingPromise = null;
  setState({ status: "idle" });
}

export async function getKokoroTTS(): Promise<KokoroTTS> {
  if (instance) {
    if (state.status !== "ready") setState({ status: "ready" });
    return instance;
  }
  if (loadingPromise) return loadingPromise;
  loadingPromise = loadKokoroOnce();
  return loadingPromise;
}

async function loadKokoroOnce(): Promise<KokoroTTS> {
  setState({ status: "loading", progress: null });
  try {
    // 1. Pre-llenar `transformers-cache` y `kokoro-voices` con copias locales
    // ANTES de instanciar — kokoro.web.js consultará esas caches primero
    // (env.useBrowserCache=true bundleado).
    await prewarmCaches();

    // 2. Cargar el bundle nativo (self-contained, sin imports externos).
    const mod = await importKokoroModule();

    // 3. Apuntar el wasm runtime a same-origin via el setter público que expone
    // kokoro-js (`mod.env.wasmPaths` reenvía a `Wg.backends.onnx.wasm.wasmPaths`).
    try {
      const base = `${getBasePath()}/vendors-tts/`.replace(/\/{2,}/g, "/");
      mod.env.wasmPaths = base;
    } catch {
      // best-effort
    }

    // 4. Instanciar. Atempt único: WASM + q8 (sufijo `_quantized` en transformers).
    // Si falla, falla en serio y caemos a Web Speech via el catch del consumer.
    const tts = (await withTimeout(
      mod.KokoroTTS.from_pretrained(KOKORO_MODEL_ID, {
        device: "wasm",
        dtype: "q8",
        progress_callback: (p: unknown) => {
          const frac = extractProgress(p);
          if (frac !== null) {
            setState({ status: "loading", progress: frac });
          }
        },
      }),
      kokoroTimeoutMs(),
      "KokoroTTS.from_pretrained(wasm/q8)",
    )) as KokoroTTS;

    // 5. Pre-warm de la voz seleccionada — BLOQUEANTE.
    //
    // Antes era fire-and-forget tras `setState("ready")`. Eso producía un gap
    // notorio en la PRIMERA frase del primer turno: si el usuario hace una
    // pregunta apenas la UI dice "Voice ready", el primer `tts.generate` real
    // cae frío y compila el grafo ONNX en ese momento (cientos de ms / segundos).
    //
    // Esperar al pre-warm antes de marcar `ready` cambia ese costo a tiempo de
    // carga (la barra de progreso se queda un poco más, ~300-700ms en desktop)
    // pero hace que el primer turno suene tan fluido como los siguientes —
    // alineado con el resto del pipelining gen↔play que hace `useSpeech.drainQueue`.
    try {
      await prewarmCurrentVoice(tts);
    } catch {
      // best-effort: aunque el pre-warm falle (p. ej. fonemizador raro), igual
      // marcamos ready. La penalización vuelve al primer turno, pero no rompe.
    }

    instance = tts;
    setState({ status: "ready" });

    return tts;
  } catch (err) {
    instance = null;
    loadingPromise = null;
    setState({ status: "failed", error: formatError(err) });
    throw err;
  }
}

async function importKokoroModule(): Promise<KokoroModule> {
  const base = getBasePath();
  const kokoroPath = `${base}/vendors-tts/kokoro.web.js`.replace(/\/{2,}/g, "/");
  // webpackIgnore: bundle ya pre-empaquetado en /public; webpack no debe procesarlo
  // (rompe con factory undefined al expandir `new URL(..., import.meta.url)`).
  return (await import(
    /* webpackIgnore: true */
    new URL(kokoroPath, window.location.origin).href
  )) as KokoroModule;
}

function getBasePath(): string {
  if (typeof window === "undefined") return "";
  // Next.js inyecta basePath en __NEXT_DATA__ cuando está configurado.
  const data = (window as unknown as { __NEXT_DATA__?: { basePath?: string } })
    .__NEXT_DATA__;
  return data?.basePath ?? "";
}

function extractProgress(p: unknown): number | null {
  if (!p || typeof p !== "object") return null;
  const obj = p as { loaded?: unknown; total?: unknown; status?: unknown };
  const loaded = Number(obj.loaded);
  const total = Number(obj.total);
  if (
    Number.isFinite(loaded) &&
    Number.isFinite(total) &&
    total > 0 &&
    loaded >= 0
  ) {
    return Math.max(0, Math.min(1, loaded / total));
  }
  return null;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
  });
  return Promise.race([p, timeoutPromise]).finally(() => {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  });
}

function kokoroTimeoutMs(): number {
  if (typeof navigator === "undefined") return 45_000;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    ? 120_000
    : 45_000;
}

function formatError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function storedVoiceId(): string {
  if (typeof window === "undefined") return DEFAULT_KOKORO_VOICE;
  try {
    const raw = window.localStorage.getItem(VOICE_KEY);
    if (raw && isKokoroVoiceId(raw)) return raw;
  } catch {
    // localStorage bloqueado (incognito strict, SecurityError); fallback al default
  }
  return DEFAULT_KOKORO_VOICE;
}

async function prewarmCurrentVoice(tts: KokoroTTS): Promise<void> {
  const voice = storedVoiceId();
  // Texto mínimo para forzar la compilación del grafo ONNX con esta voz.
  // Cast: kokoro-js tipa `voice` como literal union (incluye TODO el catálogo
  // de kokoro-js, no solo las 5 voces curadas). Nuestra lista canónica vive en
  // kokoroVoices.json y se valida con isKokoroVoiceId() antes de llegar acá.
  type GenerateOpts = NonNullable<Parameters<KokoroTTS["generate"]>[1]>;
  await tts.generate("a", { voice: voice as GenerateOpts["voice"] });
}

/**
 * Pre-llena `transformers-cache` (modelo) y `kokoro-voices` (voces) con copias
 * locales `same-origin`. Ambas caches se consultan por URL canónica de HF, así
 * que esa es la `key` que usamos al hacer `cache.put`.
 *
 * Best-effort: cualquier fallo (CSP, incognito, archivo missing) se silencia y
 * deja que kokoro-js haga su fallback normal a HuggingFace.
 */
async function prewarmCaches(): Promise<void> {
  if (typeof caches === "undefined") return;

  const base = getBasePath();
  const localBase = `${base}/vendors-tts/models/${KOKORO_MODEL_ID}`.replace(
    /\/{2,}/g,
    "/",
  );
  const remoteBase = `https://huggingface.co/${KOKORO_MODEL_ID}/resolve/${KOKORO_REVISION}`;

  // 1. transformers-cache (modelo + tokenizer + config)
  // Sólo archivos que sabemos publicados por HF para este modelo. Listar
  // opcionales que HF responde 404 (special_tokens_map.json, generation_config.json)
  // genera ruido en consola: aunque manejamos `!res.ok` con un return silencioso,
  // el navegador igual imprime el 404 en DevTools. Si un modelo futuro publica
  // esos archivos, se reactivan junto con el bump de revisión en kokoroVoices.json.
  await prewarmCache("transformers-cache", [
    "config.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "onnx/model_quantized.onnx",
  ], remoteBase, localBase);

  // 2. kokoro-voices (5 voces .bin)
  await prewarmCache(
    "kokoro-voices",
    KOKORO_VOICES.map((v) => `voices/${v.id}.bin`),
    remoteBase,
    localBase,
  );
}

async function prewarmCache(
  cacheName: string,
  files: ReadonlyArray<string>,
  remoteBase: string,
  localBase: string,
): Promise<void> {
  let cache: Cache;
  try {
    cache = await caches.open(cacheName);
  } catch {
    return;
  }

  await Promise.all(
    files.map(async (file) => {
      const remoteUrl = `${remoteBase}/${file}`;
      try {
        const existing = await cache.match(remoteUrl);
        if (existing) return;
        const localUrl = `${localBase}/${file}`;
        const res = await fetch(localUrl, { credentials: "omit" });
        if (!res.ok) return;
        // Clonar headers no-CORS-restricted para que transformers/kokoro-js
        // pueda inspeccionar Content-Length si lo necesita.
        await cache.put(remoteUrl, res);
      } catch {
        // archivo opcional / red caída — silenciar, fallback a HF
      }
    }),
  );
}
