"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  DEFAULT_KOKORO_VOICE,
  isKokoroVoiceId,
  KOKORO_VOICES,
  VOICE_KEY,
  type KokoroVoiceId,
  type KokoroVoicesCatalog,
} from "./kokoroVoices";

import {
  getKokoroTTS,
  type KokoroLoadState,
  type KokoroTTS,
  resetKokoroSingleton,
  subscribeKokoro,
} from "./kokoroSingleton";

export {
  KOKORO_VOICES,
  type KokoroVoiceId,
  type KokoroVoicesCatalog,
} from "./kokoroVoices";

export type SpeechEngine = "elevenlabs" | "kokoro" | "webspeech" | "none";
export type SpeechPhase = "idle" | "generating" | "speaking";
export type SpeechStatus =
  | "idle"
  | "loading"
  | "ready"
  | "error"
  | "unavailable";

export type KokoroStatus = "idle" | "loading" | "ready" | "failed";

/**
 * Preferencia explícita del usuario para el motor de voz.
 * - "auto": comportamiento Fase 1 (Kokoro EN, Web Speech ES).
 * - "elevenlabs": prioriza ElevenLabs; si falla, cae al motor automático.
 */
export type EnginePref = "auto" | "elevenlabs";
export const ENGINE_PREF_KEY = "physicsboard.enginePref";

/** Estado de disponibilidad del proxy `/api/tts` (probe ligero). */
export type ElevenLabsStatus = "unknown" | "ready" | "unavailable" | "blocked";

const MUTED_KEY = "physicsboard.muted";

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

/** Móvil: no se carga Kokoro; UI y retry pueden reconocer este token. */
export const KOKORO_SKIPPED_MOBILE = "kokoro_skipped_mobile" as const;

interface SpeakTask {
  text: string;
  cancelled: boolean;
  /** BCP-47, p. ej. "es-419" para Lab; vacío/omitido = inglés (Teach). */
  webSpeechLang?: string;
  resolve?: (value: { durationMs: number }) => void;
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
    opts?: { timeoutMs?: number; webSpeechLang?: string },
  ) => Promise<{ durationMs: number }>;
  cancel: () => void;
  available: boolean;
  isSpeaking: boolean;
  kokoroInitError: string | null;
  retryKokoro: () => void;
  /** Preferencia explícita del usuario (auto vs elevenlabs). */
  enginePref: EnginePref;
  setEnginePref: (next: EnginePref) => void;
  /** Disponibilidad del proxy /api/tts (clave de API en server, etc). */
  elevenLabsStatus: ElevenLabsStatus;
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

function normLang(s: string): string {
  return s.toLowerCase().replace(/_/g, "-");
}

/** Voz de Web Speech; Kokoro se ignora. Preferencia es-419 / es-MX / cualquier es-. */
function pickPreferredVoiceForLang(bcp47: string): SpeechSynthesisVoice | null {
  if (!hasSpeechSynthesis()) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  const want = normLang(bcp47);
  if (want.startsWith("en")) {
    return pickPreferredVoice();
  }
  if (want.startsWith("es")) {
    const prefer = [
      /^es-mx$/i,
      /^es-419$/i,
      /^es-us$/i,
      /^es-co$/i,
      /^es-ar$/i,
    ];
    for (const re of prefer) {
      const m = voices.find((v) => re.test(normLang(v.lang)));
      if (m) return m;
    }
    const anyEs = voices.find((v) => normLang(v.lang).startsWith("es"));
    if (anyEs) return anyEs;
  }
  const byExact = voices.find((v) => normLang(v.lang) === want);
  if (byExact) return byExact;
  return pickPreferredVoice();
}

function isMobileLike(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

/** Devuelve el prefijo BCP-47 ("en", "es", …). */
function langPrefix(bcp47: string): string {
  return (bcp47 ?? "").toLowerCase().slice(0, 2);
}

/** True si la voz comparte familia de idioma con el utterance.lang. */
function voiceMatchesLang(
  voice: SpeechSynthesisVoice,
  utteranceLang: string,
): boolean {
  return langPrefix(voice.lang) === langPrefix(utteranceLang);
}

/**
 * Espera (con tope corto) a que `speechSynthesis.getVoices()` devuelva voces.
 * En Chrome/Edge la primera llamada tras el mount suele venir vacía hasta que
 * dispara `voiceschanged`; sin esto el primer `speak` cae a fallback EN.
 */
async function waitForVoices(timeoutMs = 600): Promise<void> {
  if (!hasSpeechSynthesis()) return;
  if (window.speechSynthesis.getVoices().length > 0) return;
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    const handler = () => {
      clearTimeout(timer);
      try {
        window.speechSynthesis.removeEventListener("voiceschanged", handler);
      } catch {
        // ignore
      }
      finish();
    };
    try {
      window.speechSynthesis.addEventListener("voiceschanged", handler, {
        once: true,
      });
    } catch {
      // Safari antiguo: el setTimeout cubre el caso.
    }
  });
}

// NOTE: Antes había un ladder de intentos `wasm/q8 → wasm/q4f16 → wasm/q4 → webgpu/fp32`.
// Lo redujimos a `wasm/q8` único dentro del singleton (ver kokoroSingleton.ts).
// Si q8 falla, el catch del consumer cae a Web Speech como antes. Reactivar
// WebGPU/fp32 detrás de un feature flag si fuese necesario en el futuro.

export function useSpeech(): UseSpeech {
  // IMPORTANTE (SSR/Hydration): el primer render debe ser idéntico en server y client.
  // No podemos depender de `window` en inicializadores de useState, o React/Next
  // va a detectar mismatch y re-renderizar todo en cliente (lento en móvil).
  const [status, setStatus] = useState<SpeechStatus>("loading");
  const [engine, setEngine] = useState<SpeechEngine>("none");
  const [phase, setPhase] = useState<SpeechPhase>("idle");
  const [kokoroStatus, setKokoroStatus] = useState<KokoroStatus>("idle");
  const [kokoroProgress, setKokoroProgress] = useState<number | null>(null);
  const [muted, setMutedState] = useState<boolean>(false);
  const [voice, setVoiceState] = useState<KokoroVoiceId>(DEFAULT_KOKORO_VOICE);
  const [kokoroInitError, setKokoroInitError] = useState<string | null>(null);
  const [loadKey, setLoadKey] = useState(0);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [enginePref, setEnginePrefState] = useState<EnginePref>("auto");
  const [elevenLabsStatus, setElevenLabsStatus] =
    useState<ElevenLabsStatus>("unknown");

  const ttsRef = useRef<KokoroTTS | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const queueRef = useRef<SpeakTask[]>([]);
  const runningRef = useRef(false);
  const preferredVoiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const preferredEsVoiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const enginePrefRef = useRef<EnginePref>("auto");
  const elevenLabsStatusRef = useRef<ElevenLabsStatus>("unknown");
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

  useEffect(() => {
    enginePrefRef.current = enginePref;
  }, [enginePref]);

  useEffect(() => {
    elevenLabsStatusRef.current = elevenLabsStatus;
  }, [elevenLabsStatus]);

  // Habilita Web Speech inmediatamente *después* del mount (evita hydration mismatch).
  useEffect(() => {
    if (!hasSpeechSynthesis()) {
      setEngine("none");
      setStatus("unavailable");
      return;
    }
    setEngine("webspeech");
    setStatus("ready");
  }, []);

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
    try {
      const storedPref = localStorage.getItem(ENGINE_PREF_KEY);
      if (storedPref === "elevenlabs" || storedPref === "auto") {
        setEnginePrefState(storedPref);
        enginePrefRef.current = storedPref;
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (statusRef.current === "ready" && engineRef.current !== "none") notifyReady();
  }, [engine, notifyReady, status]);

  // Probe pasivo de /api/tts (sin gastar tokens): GET barato. El endpoint siempre
  // responde 200 con `{ ok }` en el body; decidir por `body.ok` evita el ruido
  // de "Failed to load resource: 503" en la consola cuando ElevenLabs no está
  // configurado.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/tts", { method: "GET" });
        if (cancelled) return;
        let bodyOk = false;
        try {
          const json = (await res.json()) as { ok?: unknown };
          bodyOk = json?.ok === true;
        } catch {
          // ignore
        }
        setElevenLabsStatus(bodyOk ? "ready" : "unavailable");
      } catch {
        if (cancelled) return;
        setElevenLabsStatus("unavailable");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setEnginePref = useCallback((next: EnginePref) => {
    setEnginePrefState(next);
    enginePrefRef.current = next;
    try {
      localStorage.setItem(ENGINE_PREF_KEY, next);
    } catch {
      // ignore
    }
  }, []);

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
    // Limpia la instancia/promesa de módulo para forzar una nueva carga; el
    // bump de `loadKey` hace que el `useEffect` se vuelva a suscribir.
    resetKokoroSingleton();
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
    if (typeof window === "undefined") return;

    let disposed = false;

    // Web Speech warmup (siempre, móvil o desktop): asegura voces en cuanto el
    // navegador las publica (Chrome dispara `voiceschanged` después del mount).
    if (hasSpeechSynthesis()) {
      const warmVoices = () => {
        preferredVoiceRef.current = pickPreferredVoice();
        const es = pickPreferredVoiceForLang("es-419");
        if (es && langPrefix(es.lang) === "es") {
          preferredEsVoiceRef.current = es;
        }
      };
      warmVoices();
      window.speechSynthesis.onvoiceschanged = warmVoices;
    }

    // Móvil: bypass Kokoro completo. Web Speech ya está caliente.
    if (isMobileLike()) {
      ttsRef.current = null;
      setKokoroProgress(null);
      setKokoroInitError(KOKORO_SKIPPED_MOBILE);
      setKokoroStatus("failed");
      // #region debug log
      dbg("useSpeech.ts:init", "mobile: Kokoro skipped, Web Speech only", {}, "H0");
      // #endregion
      return () => {
        disposed = true;
      };
    }

    // Desktop: delegar al singleton de módulo. Múltiples mounts comparten una
    // misma instancia (la primera dispara la carga, las siguientes reutilizan).
    // #region debug log
    dbg("useSpeech.ts:init", "subscribing to kokoroSingleton", { hasWebGPU: hasWebGPU(), hasSpeech: hasSpeechSynthesis(), ua: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 80) : "n/a" }, "H1");
    // #endregion

    const unsubscribe = subscribeKokoro((s: KokoroLoadState) => {
      if (disposed) return;
      switch (s.status) {
        case "idle":
          setKokoroStatus("idle");
          setKokoroProgress(null);
          break;
        case "loading":
          setKokoroStatus("loading");
          setKokoroProgress(s.progress);
          break;
        case "ready":
          setKokoroInitError(null);
          setKokoroProgress(1);
          setKokoroStatus("ready");
          break;
        case "failed":
          setKokoroInitError(s.error);
          setKokoroStatus("failed");
          break;
      }
    });

    void getKokoroTTS()
      .then((tts: KokoroTTS) => {
        if (disposed) return;
        ttsRef.current = tts;
        setEngine("kokoro");
        // #region debug log
        dbg("useSpeech.ts:init", "KOKORO READY (via singleton)", {}, "H3");
        // #endregion
      })
      .catch((err: unknown) => {
        if (disposed) return;
        console.warn("[useSpeech] Kokoro load failed, falling back", err);
        // #region debug log
        dbg("useSpeech.ts:init", "FALLBACK to webspeech", {
          errorName: err instanceof Error ? err.name : typeof err,
          errorMsg: err instanceof Error ? err.message : String(err),
        }, "H1");
        // #endregion
        ttsRef.current = null;
        if (!hasSpeechSynthesis()) {
          setEngine("none");
          setStatus("unavailable");
        }
      });

    return () => {
      disposed = true;
      unsubscribe();
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
      // Cast: kokoro-js tipa `voice` como literal union del catálogo completo;
      // nuestra fuente canónica es kokoroVoices.json, validada con isKokoroVoiceId.
      type GenerateOpts = NonNullable<Parameters<KokoroTTS["generate"]>[1]>;
      const audio = await tts.generate(text, {
        voice: voiceRef.current as GenerateOpts["voice"],
      });
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
    // Si todavía no llegaron las voces (común en Chrome/Edge en el primer turno),
    // esperamos un poco a `voiceschanged` antes de elegir una. Sin esto, español
    // termina hablando con voz inglesa hasta el segundo turno.
    if (window.speechSynthesis.getVoices().length === 0) {
      await waitForVoices(600);
    }
    await new Promise<void>((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);
      const lang = task.webSpeechLang ?? "en-US";
      const wantsEs = langPrefix(lang) === "es";
      utterance.lang = lang;
      utterance.rate = 0.97;
      utterance.pitch = 1.0;
      utterance.volume = 1;

      // Selección de voz "segura": preferimos una que coincida con el idioma del
      // utterance. Si no hay coincidencia (p. ej. Chrome aún sin voces es-*),
      // dejamos `utterance.voice` sin asignar para que el SO elija por `lang`,
      // en vez de forzar una voz EN cuando se pidió ES.
      const candidate =
        (wantsEs ? preferredEsVoiceRef.current : null) ??
        pickPreferredVoiceForLang(lang) ??
        (wantsEs ? null : preferredVoiceRef.current) ??
        (wantsEs ? null : pickPreferredVoice());
      if (candidate && voiceMatchesLang(candidate, lang)) {
        utterance.voice = candidate;
        if (wantsEs && !preferredEsVoiceRef.current) {
          preferredEsVoiceRef.current = candidate;
        }
      }
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

  const playWithElevenLabs = useCallback(
    async (text: string, task: SpeakTask) => {
      const lang = langPrefix(task.webSpeechLang ?? "en-US") === "es" ? "es" : "en";
      setPhase("generating");
      const t0 = performance.now();
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, lang }),
      });
      if (!res.ok || !res.body) {
        const detail = await res.text().catch(() => "");
        throw new Error(`elevenlabs proxy ${res.status}: ${detail.slice(0, 200)}`);
      }
      const arrayBuf = await res.arrayBuffer();
      const genMs = Math.round(performance.now() - t0);
      // #region debug log
      dbg(
        "useSpeech.ts:playWithElevenLabs",
        "fetched",
        { genMs, bytes: arrayBuf.byteLength, lang, textLen: text.length },
        "E1",
      );
      // #endregion
      if (task.cancelled || mutedRef.current) return;
      const ctx = ensureAudioCtx();
      if (!ctx) throw new Error("AudioContext unavailable");
      if (ctx.state !== "running") {
        await unlock({ timeoutMs: 2500 });
      }
      if (task.cancelled || mutedRef.current) return;
      const buffer = await ctx.decodeAudioData(arrayBuf.slice(0));
      if (task.cancelled || mutedRef.current) return;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      activeSourceRef.current = source;
      const durationMs = Math.round(buffer.duration * 1000);
      setSpeaking(true);
      setPhase("speaking");
      await new Promise<void>((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          resolve();
        };
        const watchdogMs = Math.max(800, durationMs + 800);
        const t = setTimeout(() => {
          try {
            source.stop();
          } catch {
            // ignore
          }
          finish();
        }, watchdogMs);
        source.onended = () => {
          clearTimeout(t);
          finish();
        };
        try {
          source.start();
        } catch (e) {
          console.warn("[useSpeech] elevenlabs source.start failed", e);
          clearTimeout(t);
          finish();
        }
      });
      if (activeSourceRef.current === source) activeSourceRef.current = null;
      if (isSpeakingRef.current) setSpeaking(false);
      setPhase("idle");
      task.resolve?.({ durationMs });
    },
    [ensureAudioCtx, setSpeaking, unlock],
  );

  const drainQueue = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      while (queueRef.current.length) {
        const task = queueRef.current.shift()!;
        if (task.cancelled || mutedRef.current) continue;

        // Política de motor por turno:
        // 1. Si el usuario eligió ElevenLabs y el proxy está listo → ElevenLabs.
        // 2. Si el turno pide inglés y Kokoro está cargado → Kokoro (Fase 1).
        // 3. Resto → Web Speech (cubre ES + cualquier fallback).
        const wantsEnglish = langPrefix(task.webSpeechLang ?? "en-US") === "en";
        const tryElevenFirst =
          enginePrefRef.current === "elevenlabs" &&
          elevenLabsStatusRef.current === "ready";
        const useKokoro = !tryElevenFirst && !!ttsRef.current && wantsEnglish;

        try {
          if (tryElevenFirst) {
            try {
              await playWithElevenLabs(task.text, task);
              continue;
            } catch (e) {
              console.warn("[useSpeech] ElevenLabs failed, falling back", e);
              // Marcamos bloqueado para que la UI muestre el motivo, pero NO
              // cambiamos enginePref: el usuario sigue queriendo ElevenLabs.
              setElevenLabsStatus("blocked");
              elevenLabsStatusRef.current = "blocked";
              if (task.cancelled || mutedRef.current) {
                task.resolve?.({ durationMs: 0 });
                continue;
              }
              // Fall-through a Kokoro/WebSpeech como red de seguridad.
              const fallbackUseKokoro = !!ttsRef.current && wantsEnglish;
              if (fallbackUseKokoro) {
                await playWithKokoro(task.text, task);
              } else if (hasSpeechSynthesis()) {
                await playWithWebSpeech(task.text, task);
              } else {
                task.resolve?.({ durationMs: 0 });
              }
              continue;
            }
          }

          if (useKokoro) {
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
  }, [playWithElevenLabs, playWithKokoro, playWithWebSpeech]);

  const speakAsync = useCallback(
    async (text: string, opts?: { timeoutMs?: number; webSpeechLang?: string }): Promise<{ durationMs: number }> => {
      const timeoutMs = opts?.timeoutMs ?? 30000;
      if (!text || mutedRef.current) return { durationMs: 0 };

      const enqueue = (): Promise<{ durationMs: number }> => {
        const task: SpeakTask = {
          text,
          cancelled: false,
          webSpeechLang: opts?.webSpeechLang,
        };
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
    enginePref,
    setEnginePref,
    elevenLabsStatus,
  };
}
