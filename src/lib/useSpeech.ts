"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type SpeechEngine = "kokoro" | "webspeech" | "none";
export type SpeechPhase = "idle" | "generating" | "speaking";
export type SpeechStatus =
  | "idle"
  | "loading"
  | "ready"
  | "error"
  | "unavailable";

export type KokoroStatus = "idle" | "loading" | "ready" | "failed";

export const KOKORO_VOICES = [
  { id: "af_heart", label: "Heart (warm, friendly)", lang: "en-US" },
  { id: "af_bella", label: "Bella (warm narrator)", lang: "en-US" },
  { id: "af_nova", label: "Nova (bright, clear)", lang: "en-US" },
  { id: "bf_emma", label: "Emma (British female)", lang: "en-GB" },
  { id: "am_michael", label: "Michael (male, calm)", lang: "en-US" },
] as const;

export type KokoroVoiceId = (typeof KOKORO_VOICES)[number]["id"];
export type KokoroVoicesCatalog = typeof KOKORO_VOICES;

const MUTED_KEY = "physicsboard.muted";
const VOICE_KEY = "physicsboard.voice";
const KOKORO_MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
const DEFAULT_KOKORO_VOICE: KokoroVoiceId = "af_heart";

// #region debug log
// NOTE: nunca apuntes a localhost desde el cliente: en móviles/HTTPS túneles
// genera ruido (y falsos "failed to load") sin aportar valor. Si necesitas
// trazas, usa `console.debug` o el endpoint de debug del app (no hardcodear IPs).
function dbg(
  location: string,
  message: string,
  data: Record<string, unknown> = {},
  hypothesisId = "H1",
): void {
  if (process.env.NODE_ENV !== "development") return;
  // eslint-disable-next-line no-console
  console.debug(`[speech:dbg] ${hypothesisId} ${location} — ${message}`, data);
}
// #endregion

type KokoroDtype = "fp32" | "fp16" | "q8" | "q4" | "q4f16";

function isKokoroVoiceId(v: string): v is KokoroVoiceId {
  return KOKORO_VOICES.some((item) => item.id === v);
}

type KokoroModule = typeof import("kokoro-js");
type KokoroTTS = InstanceType<KokoroModule["KokoroTTS"]>;

interface SpeakTask {
  text: string;
  cancelled: boolean;
  resolve?: (value: { durationMs: number }) => void;
}

function formatInitError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function kokoroTimeoutMs(): number {
  // La primera carga puede ser muy pesada en móvil (descarga + parse + compile).
  // Preferimos tolerancia alta porque la UI ya funciona con Web Speech.
  return isMobileLike() ? 120_000 : 45_000;
}

function kokoroInitBudgetMs(): number {
  // Solo para evitar cuelgues silenciosos. Si hay progreso, dejamos seguir.
  return isMobileLike() ? 240_000 : 90_000;
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        t = setTimeout(() => {
          reject(new Error(`${label} timed out after ${ms}ms`));
        }, ms);
      }),
    ]);
  } finally {
    if (t) clearTimeout(t);
  }
}

/** Single-thread WASM avoids SharedArrayBuffer / cross-origin isolation issues. */
async function configureWasmSingleThread(): Promise<void> {
  try {
    const mod = await import("@huggingface/transformers");
    // #region debug log
    dbg("useSpeech.ts:configureWasmSingleThread", "transformers imported", { hasEnv: !!mod.env, keys: Object.keys(mod).slice(0, 10) }, "H2");
    // #endregion
    const { env } = mod;
    const wasm = (
      env as {
        backends?: { onnx?: { wasm?: { numThreads?: number } } };
      }
    ).backends?.onnx?.wasm;
    if (wasm) wasm.numThreads = 1;

    // Prefer caching in browsers when available (faster second load, less jank).
    try {
      (env as any).useBrowserCache = true;
      (env as any).useWasmCache = true;
    } catch {
      // ignore
    }

    // Point ORT WASM assets to our locally served copies when possible.
    // This avoids CDN/DNS issues on mobile networks.
    try {
      const nextBase = (
        window as { __NEXT_DATA__?: { basePath?: string } }
      ).__NEXT_DATA__?.basePath;
      const base = `${nextBase ?? ""}/vendors-tts/`.replace(/\/\//g, "/");
      if ((env as any).backends?.onnx?.wasm) {
        (env as any).backends.onnx.wasm.wasmPaths = base;
      }
    } catch {
      // ignore
    }
  } catch (e) {
    // #region debug log
    dbg("useSpeech.ts:configureWasmSingleThread", "transformers import FAILED", { error: e instanceof Error ? e.message : String(e), stack: e instanceof Error ? (e.stack ?? "").split("\n").slice(0, 5) : undefined }, "H1");
    // #endregion
    console.warn("[useSpeech] transformers WASM preset skipped", e);
  }
}

export interface UseSpeech {
  status: SpeechStatus;
  engine: SpeechEngine;
  phase: SpeechPhase;
  kokoroStatus: KokoroStatus;
  kokoroProgress: number | null;
  muted: boolean;
  setMuted: (value: boolean) => void;
  voice: KokoroVoiceId;
  setVoice: (id: KokoroVoiceId) => void;
  voices: KokoroVoicesCatalog;
  unlock: (opts?: { timeoutMs?: number }) => Promise<{ ok: boolean; state: string }>;
  speak: (text: string) => void;
  speakAsync: (
    text: string,
    opts?: { timeoutMs?: number },
  ) => Promise<{ durationMs: number }>;
  cancel: () => void;
  available: boolean;
  isSpeaking: boolean;
  kokoroInitError: string | null;
  retryKokoro: () => void;
}

function hasWebGPU(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

function hasSpeechSynthesis(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

function isAndroidChrome(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /Android/i.test(ua) && /Chrome\//i.test(ua);
}

function pickPreferredVoice(): SpeechSynthesisVoice | null {
  if (!hasSpeechSynthesis()) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  const preferOrder = [
    /ava.*neural/i,
    /ava.*premium/i,
    /ava/i,
    /jenny.*neural/i,
    /jenny/i,
    /aria.*neural/i,
    /aria/i,
    /samantha.*enhanced/i,
    /samantha/i,
    /allison.*enhanced/i,
    /zoe.*enhanced/i,
    /google.*us english/i,
    /english.*united states/i,
  ];
  for (const re of preferOrder) {
    const match = voices.find((v) => re.test(v.name));
    if (match) return match;
  }
  return voices.find((v) => v.lang.startsWith("en")) ?? voices[0];
}

function isMobileLike(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function kokoroLoadAttempts(): Array<{ device: "webgpu" | "wasm"; dtype: KokoroDtype }> {
  const out: Array<{ device: "webgpu" | "wasm"; dtype: KokoroDtype }> = [];
  // En móvil priorizamos WASM cuantizado: primer uso suele ser por red/CPU,
  // y WebGPU+fp32 tiende a ser el camino más caro.
  if (isMobileLike()) {
    out.push({ device: "wasm", dtype: "q8" });
    out.push({ device: "wasm", dtype: "q4f16" });
    out.push({ device: "wasm", dtype: "q4" });
    // Android Chrome suele ser más estable con WASM al inicio; si WebGPU es viable
    // lo dejamos como último intento.
    if (hasWebGPU()) out.push({ device: "webgpu", dtype: "fp32" });
  } else {
    if (hasWebGPU()) {
      out.push({ device: "webgpu", dtype: "fp32" });
    }
    out.push({ device: "wasm", dtype: "q8" });
    out.push({ device: "wasm", dtype: "q4f16" });
    out.push({ device: "wasm", dtype: "q4" });
  }
  return out;
}

export function useSpeech(): UseSpeech {
  // UX: si el navegador soporta Web Speech, la app debe ser usable inmediatamente.
  const [status, setStatus] = useState<SpeechStatus>(() =>
    hasSpeechSynthesis() ? "ready" : "unavailable",
  );
  const [engine, setEngine] = useState<SpeechEngine>(() =>
    hasSpeechSynthesis() ? "webspeech" : "none",
  );
  const [phase, setPhase] = useState<SpeechPhase>("idle");
  const [kokoroStatus, setKokoroStatus] = useState<KokoroStatus>("idle");
  const [kokoroProgress, setKokoroProgress] = useState<number | null>(null);
  const [muted, setMutedState] = useState<boolean>(false);
  const [voice, setVoiceState] = useState<KokoroVoiceId>(DEFAULT_KOKORO_VOICE);
  const [kokoroInitError, setKokoroInitError] = useState<string | null>(null);
  const [loadKey, setLoadKey] = useState(0);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const ttsRef = useRef<KokoroTTS | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const queueRef = useRef<SpeakTask[]>([]);
  const runningRef = useRef(false);
  const preferredVoiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const mutedRef = useRef(false);
  const voiceRef = useRef<KokoroVoiceId>(DEFAULT_KOKORO_VOICE);
  const isSpeakingRef = useRef(false);
  const readyWaitersRef = useRef<Array<() => void>>([]);
  const engineRef = useRef<SpeechEngine>("none");
  const statusRef = useRef<SpeechStatus>("loading");

  useEffect(() => {
    voiceRef.current = voice;
  }, [voice]);

  useEffect(() => {
    engineRef.current = engine;
    statusRef.current = status;
  }, [engine, status]);

  const setSpeaking = useCallback((value: boolean) => {
    isSpeakingRef.current = value;
    setIsSpeaking(value);
  }, []);

  const notifyReady = useCallback(() => {
    const waiters = readyWaitersRef.current;
    if (!waiters.length) return;
    readyWaitersRef.current = [];
    waiters.forEach((fn) => {
      try {
        fn();
      } catch {
        // ignore
      }
    });
  }, []);

  const waitUntilReady = useCallback(
    async (timeoutMs = 15000): Promise<boolean> => {
      if (statusRef.current === "ready" && engineRef.current !== "none") return true;
      // #region debug log
      dbg(
        "useSpeech.ts:waitUntilReady",
        "waiting",
        { status: statusRef.current, engine: engineRef.current, timeoutMs },
        "R1",
      );
      // #endregion
      return await new Promise<boolean>((resolve) => {
        let done = false;
        const finish = (ok: boolean) => {
          if (done) return;
          done = true;
          resolve(ok);
        };
        readyWaitersRef.current.push(() => finish(true));
        setTimeout(
          () =>
            finish(
              statusRef.current === "ready" && engineRef.current !== "none",
            ),
          timeoutMs,
        );
      });
    },
    [],
  );

  useEffect(() => {
    try {
      const raw = localStorage.getItem(MUTED_KEY);
      if (raw === "1") {
        setMutedState(true);
        mutedRef.current = true;
      }
    } catch {
      // ignore
    }
    try {
      const stored = localStorage.getItem(VOICE_KEY);
      if (stored && isKokoroVoiceId(stored)) {
        setVoiceState(stored);
        voiceRef.current = stored;
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (statusRef.current === "ready" && engineRef.current !== "none") notifyReady();
  }, [engine, notifyReady, status]);

  const cancel = useCallback(() => {
    queueRef.current.forEach((t) => {
      t.cancelled = true;
      try {
        t.resolve?.({ durationMs: 0 });
      } catch {
        // ignore
      }
    });
    queueRef.current = [];
    try {
      activeSourceRef.current?.stop();
    } catch {
      // ignore
    }
    activeSourceRef.current = null;
    if (hasSpeechSynthesis()) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
    }
    setSpeaking(false);
    setPhase("idle");
  }, [setSpeaking]);

  const retryKokoro = useCallback(() => {
    cancel();
    ttsRef.current = null;
    setKokoroInitError(null);
    setKokoroProgress(null);
    setKokoroStatus("idle");
    setLoadKey((k) => k + 1);
  }, [cancel]);

  const setVoice = useCallback(
    (id: KokoroVoiceId) => {
      cancel();
      voiceRef.current = id;
      setVoiceState(id);
      try {
        localStorage.setItem(VOICE_KEY, id);
      } catch {
        // ignore
      }
    },
    [cancel],
  );

  const setMuted = useCallback((value: boolean) => {
    setMutedState(value);
    mutedRef.current = value;
    try {
      localStorage.setItem(MUTED_KEY, value ? "1" : "0");
    } catch {
      // ignore
    }
    if (value) {
      queueRef.current.forEach((t) => {
        t.cancelled = true;
        try {
          t.resolve?.({ durationMs: 0 });
        } catch {
          // ignore
        }
      });
      queueRef.current = [];
      try {
        activeSourceRef.current?.stop();
      } catch {
        // ignore
      }
      activeSourceRef.current = null;
      if (hasSpeechSynthesis()) window.speechSynthesis.cancel();
      setSpeaking(false);
      setPhase("idle");
    }
  }, [setSpeaking]);

  useEffect(() => {
    let disposed = false;

    async function init() {
      if (typeof window === "undefined") return;

      setKokoroStatus("loading");
      setKokoroProgress(null);
      setKokoroInitError(null);

      // Reduce ORT noise in consoles by default.
      // NOTE: onnxruntime-web typings are not exported cleanly in our pinned dev build,
      // so we avoid importing it directly here to keep TypeScript happy.

      if (hasSpeechSynthesis()) {
        const warmVoices = () => {
          preferredVoiceRef.current = pickPreferredVoice();
        };
        warmVoices();
        window.speechSynthesis.onvoiceschanged = warmVoices;
      }

      // #region debug log
      dbg("useSpeech.ts:init", "start", { hasWebGPU: hasWebGPU(), hasSpeech: hasSpeechSynthesis(), ua: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 80) : "n/a" }, "H1");
      // #endregion
      try {
        await configureWasmSingleThread();
        if (disposed) return;

        // #region debug log
        dbg("useSpeech.ts:init", "importing kokoro-js (static /vendors-tts)", {}, "H1");
        // #endregion
        // Carga nativa: evita que Webpack empaquete Kokoro+ORT (new URL relative a import.meta
        // rompe con factory undefined). Assets en public/ vía scripts/copy-tts-assets.cjs.
        const nextBase = (
          window as { __NEXT_DATA__?: { basePath?: string } }
        ).__NEXT_DATA__?.basePath;
        const kokoroPath = `${nextBase ?? ""}/vendors-tts/kokoro.web.js`.replace(
          /\/\//g,
          "/",
        );
        const mod = (await import(
          /* webpackIgnore: true */
          new URL(kokoroPath, window.location.origin).href
        )) as typeof import("kokoro-js");
        if (disposed) return;
        // #region debug log
        dbg("useSpeech.ts:init", "kokoro-js imported", { hasKokoroTTS: !!mod.KokoroTTS, modKeys: Object.keys(mod).slice(0, 10) }, "H1");
        // #endregion

        let lastErr: unknown;
        const attempts = kokoroLoadAttempts();
        const initStartedAt = performance.now();
        let lastProgressAt = performance.now();
        // #region debug log
        dbg("useSpeech.ts:init", "load attempts plan", { attempts, count: attempts.length }, "H4");
        // #endregion
        for (const { device, dtype } of attempts) {
          if (disposed) return;
          const budgetMs = kokoroInitBudgetMs();
          const now = performance.now();
          const recentlyProgressing = now - lastProgressAt < 12_000;
          if (!recentlyProgressing && now - initStartedAt > budgetMs) {
            throw new Error(
              `Kokoro: exceeded init budget (${budgetMs}ms)`,
            );
          }
          // #region debug log
          dbg("useSpeech.ts:init", "attempt start", { device, dtype }, "H4");
          // #endregion
          try {
            const tts = await withTimeout(
              mod.KokoroTTS.from_pretrained(KOKORO_MODEL_ID, {
                dtype,
                device,
                progress_callback: (p: unknown) => {
                  try {
                    const loaded = Number((p as any)?.loaded ?? NaN);
                    const total = Number((p as any)?.total ?? NaN);
                    if (
                      Number.isFinite(loaded) &&
                      Number.isFinite(total) &&
                      total > 0
                    ) {
                      const frac = Math.max(0, Math.min(1, loaded / total));
                      lastProgressAt = performance.now();
                      if (!disposed) setKokoroProgress(frac);
                    }
                  } catch {
                    // ignore
                  }
                },
              }),
              kokoroTimeoutMs(),
              `KokoroTTS.from_pretrained(${device}/${dtype})`,
            );
            if (disposed) return;
            ttsRef.current = tts;
            setEngine("kokoro");
            setKokoroInitError(null);
            setKokoroStatus("ready");
            // #region debug log
            dbg("useSpeech.ts:init", "KOKORO READY", { device, dtype }, "H3");
            // #endregion
            // No warmup en el camino crítico (móvil): puede empeorar la UX.
            return;
          } catch (e) {
            lastErr = e;
            // #region debug log
            dbg("useSpeech.ts:init", "attempt FAILED", {
              device,
              dtype,
              errorName: e instanceof Error ? e.name : typeof e,
              errorMsg: e instanceof Error ? e.message : String(e),
              errorStack: e instanceof Error ? (e.stack ?? "").split("\n").slice(0, 8) : undefined,
            }, "H4");
            // #endregion
            console.warn(`[useSpeech] Kokoro load failed (${device}/${dtype})`, e);
          }
        }
        throw lastErr ?? new Error("Kokoro: all load attempts failed");
      } catch (err) {
        console.warn("[useSpeech] Kokoro load failed, falling back", err);
        if (disposed) return;
        // #region debug log
        dbg("useSpeech.ts:init", "FALLBACK to webspeech", {
          errorName: err instanceof Error ? err.name : typeof err,
          errorMsg: err instanceof Error ? err.message : String(err),
          errorStack: err instanceof Error ? (err.stack ?? "").split("\n").slice(0, 8) : undefined,
        }, "H1");
        // #endregion
        setKokoroInitError(formatInitError(err));
        ttsRef.current = null;
        setKokoroStatus("failed");
        // La UX no debe depender de Kokoro. Si no hay Web Speech, sí degradamos.
        if (!hasSpeechSynthesis()) {
          setEngine("none");
          setStatus("unavailable");
        }
      }
    }

    void init();

    return () => {
      disposed = true;
    };
  }, [loadKey]);

  const ensureAudioCtx = useCallback((): AudioContext | null => {
    if (typeof window === "undefined") return null;
    if (audioCtxRef.current) return audioCtxRef.current;
    const Ctor =
      (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null;
    audioCtxRef.current = new Ctor();
    return audioCtxRef.current;
  }, []);

  const unlock = useCallback(
    async (opts?: { timeoutMs?: number }): Promise<{ ok: boolean; state: string }> => {
      const timeoutMs = opts?.timeoutMs ?? 2500;
      const ctx = ensureAudioCtx();
      if (!ctx) return { ok: false, state: "unavailable" };

      const before = ctx.state;
      // #region debug log
      dbg("useSpeech.ts:unlock", "start", { before, timeoutMs }, "U1");
      // #endregion

      if (ctx.state === "running") return { ok: true, state: "running" };

      const attempt = async () => {
        try {
          await ctx.resume();
        } catch (e) {
          // #region debug log
          dbg(
            "useSpeech.ts:unlock",
            "resume failed",
            { error: e instanceof Error ? e.message : String(e), before },
            "U1",
          );
          // #endregion
        }
        return ctx.state;
      };

      if (timeoutMs <= 0) {
        const state = await attempt();
        return { ok: state === "running", state };
      }

      const state = await Promise.race([
        attempt(),
        new Promise<AudioContextState>((resolve) => {
          setTimeout(() => resolve(ctx.state), timeoutMs);
        }),
      ]);

      // #region debug log
      dbg("useSpeech.ts:unlock", "done", { before, after: state }, "U1");
      // #endregion
      return { ok: state === "running", state };
    },
    [ensureAudioCtx],
  );

  const playWithKokoro = useCallback(
    async (text: string, task: SpeakTask) => {
      const tts = ttsRef.current;
      if (!tts) throw new Error("Kokoro not ready");
      setPhase("generating");
      const gen0 = performance.now();
      const audio = await tts.generate(text, { voice: voiceRef.current });
      const genMs = Math.round(performance.now() - gen0);
      // #region debug log
      dbg(
        "useSpeech.ts:playWithKokoro",
        "generated",
        { genMs, textLen: text.length, voice: voiceRef.current },
        "T1",
      );
      // #endregion
      if (task.cancelled || mutedRef.current) return;
      const ctx = ensureAudioCtx();
      if (!ctx) throw new Error("AudioContext unavailable");
      if (ctx.state !== "running") {
        await unlock({ timeoutMs: 2500 });
      }
      if (task.cancelled || mutedRef.current) return;
      const pcm = (audio as { audio: Float32Array }).audio;
      const sampleRate = Number(
        (audio as { sampling_rate?: number }).sampling_rate ?? 24000,
      );
      const buffer = ctx.createBuffer(1, pcm.length, sampleRate);
      buffer.getChannelData(0).set(pcm);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      activeSourceRef.current = source;
      const durationMs = Math.round((pcm.length / sampleRate) * 1000);
      setSpeaking(true);
      setPhase("speaking");
      await new Promise<void>((resolve) => {
        let done = false;
        const finish = (reason: string) => {
          if (done) return;
          done = true;
          // #region debug log
          dbg(
            "useSpeech.ts:playWithKokoro",
            "playback finished",
            { reason, durationMs, genMs, ctxState: ctx.state },
            "T3",
          );
          // #endregion
          resolve();
        };
        // Watchdog: if onended never fires, don't stall the queue.
        const watchdogMs = Math.max(800, durationMs + 800);
        const t = setTimeout(() => {
          try {
            source.stop();
          } catch {
            // ignore
          }
          finish("watchdog");
        }, watchdogMs);

        const wrappedFinish = (reason: string) => {
          clearTimeout(t);
          finish(reason);
        };
        source.onended = () => wrappedFinish("onended");
        // AudioBufferSourceNode no expone onerror en los typings del DOM;
        // usamos addEventListener defensivamente (no-op si el runtime no lo dispara).
        (source as unknown as EventTarget).addEventListener(
          "error",
          () => wrappedFinish("onerror"),
        );

        try {
          source.start();
        } catch (e) {
          console.warn("[useSpeech] source.start failed", e);
          wrappedFinish("start_failed");
        }
      });
      if (activeSourceRef.current === source) activeSourceRef.current = null;
      if (isSpeakingRef.current) setSpeaking(false);
      setPhase("idle");
      task.resolve?.({ durationMs });
    },
    [ensureAudioCtx, setSpeaking, unlock],
  );

  const playWithWebSpeech = useCallback(async (text: string, task: SpeakTask) => {
    if (!hasSpeechSynthesis()) return;
    await new Promise<void>((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.97;
      utterance.pitch = 1.0;
      utterance.volume = 1;
      const v = preferredVoiceRef.current ?? pickPreferredVoice();
      if (v) utterance.voice = v;
      const start = performance.now();
      utterance.onend = () => {
        const durationMs = Math.max(0, Math.round(performance.now() - start));
        if (isSpeakingRef.current) setSpeaking(false);
        setPhase("idle");
        task.resolve?.({ durationMs });
        resolve();
      };
      utterance.onerror = () => {
        if (isSpeakingRef.current) setSpeaking(false);
        setPhase("idle");
        task.resolve?.({ durationMs: 0 });
        resolve();
      };
      if (task.cancelled || mutedRef.current) {
        setPhase("idle");
        task.resolve?.({ durationMs: 0 });
        resolve();
        return;
      }
      try {
        setSpeaking(true);
        setPhase("speaking");
        window.speechSynthesis.speak(utterance);
      } catch {
        if (isSpeakingRef.current) setSpeaking(false);
        setPhase("idle");
        task.resolve?.({ durationMs: 0 });
        resolve();
      }
    });
  }, [setSpeaking]);

  const drainQueue = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      while (queueRef.current.length) {
        const task = queueRef.current.shift()!;
        if (task.cancelled || mutedRef.current) continue;

        try {
          if (ttsRef.current) {
            await playWithKokoro(task.text, task);
          } else if (hasSpeechSynthesis()) {
            await playWithWebSpeech(task.text, task);
          }
        } catch (err) {
          console.warn("[useSpeech] playback error, falling back", err);
          if (!task.cancelled && !mutedRef.current && hasSpeechSynthesis()) {
            try {
              await playWithWebSpeech(task.text, task);
            } catch {
              // ignore
            }
          }
          try {
            task.resolve?.({ durationMs: 0 });
          } catch {
            // ignore
          }
        }
      }
    } finally {
      runningRef.current = false;
    }
  }, [playWithKokoro, playWithWebSpeech]);

  const speakAsync = useCallback(
    async (text: string, opts?: { timeoutMs?: number }): Promise<{ durationMs: number }> => {
      const timeoutMs = opts?.timeoutMs ?? 30000;
      if (!text || mutedRef.current) return { durationMs: 0 };

      const enqueue = (): Promise<{ durationMs: number }> => {
        const task: SpeakTask = { text, cancelled: false };
        const p = new Promise<{ durationMs: number }>((resolve) => {
          task.resolve = resolve;
        });
        queueRef.current.push(task);
        void drainQueue();

        if (timeoutMs <= 0) return p;
        return Promise.race([
          p,
          new Promise<{ durationMs: number }>((resolve) => {
            setTimeout(() => resolve({ durationMs: 0 }), timeoutMs);
          }),
        ]);
      };

      if (engineRef.current === "none") {
        const ok = await waitUntilReady(Math.min(timeoutMs, 15000));
        if (!ok || engineRef.current === "none") {
          // #region debug log
          dbg(
            "useSpeech.ts:speakAsync",
            "dropped (not ready)",
            {
              status: statusRef.current,
              engine: engineRef.current,
              timeoutMs,
              textLen: text.length,
            },
            "R2",
          );
          // #endregion
          return { durationMs: 0 };
        }
      }

      // #region debug log
      dbg(
        "useSpeech.ts:speakAsync",
        "enqueue",
        { engine: engineRef.current, status: statusRef.current, timeoutMs, textLen: text.length },
        "T2",
      );
      // #endregion
      return await enqueue();
    },
    [drainQueue, waitUntilReady],
  );

  const speak = useCallback(
    (text: string) => {
      if (!text || mutedRef.current) return;
      if (engine === "none") return;
      queueRef.current.push({ text, cancelled: false });
      void drainQueue();
    },
    [drainQueue, engine],
  );

  return {
    status,
    engine,
    phase,
    kokoroStatus,
    kokoroProgress,
    muted,
    setMuted,
    voice,
    setVoice,
    voices: KOKORO_VOICES,
    unlock,
    speak,
    speakAsync,
    cancel,
    available: engine !== "none",
    isSpeaking,
    kokoroInitError,
    retryKokoro,
  };
}
