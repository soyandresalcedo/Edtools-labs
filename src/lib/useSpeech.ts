"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Motores de síntesis soportados.
 * - "elevenlabs": proxy `/api/tts` (servidor decide la voz, cliente solo decodifica).
 * - "webspeech": SpeechSynthesis nativo del navegador (gratis, sin red).
 * - "none": no hay TTS disponible (e.g. SSR, navegador sin Web Speech).
 */
export type SpeechEngine = "elevenlabs" | "webspeech" | "none";
export type SpeechPhase = "idle" | "generating" | "speaking";
export type SpeechStatus =
  | "idle"
  | "loading"
  | "ready"
  | "error"
  | "unavailable";

/**
 * Estado del proxy `/api/tts`. Se determina con un GET barato al montar el hook
 * (el endpoint responde 200 + `{ ok: true }` cuando la API key y los voice_ids
 * están configurados en el servidor).
 */
export type ElevenLabsStatus = "unknown" | "ready" | "unavailable" | "blocked";

const MUTED_KEY = "physicsboard.muted";

// #region debug log
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

interface SpeakTask {
  text: string;
  cancelled: boolean;
  /** BCP-47, p. ej. "es-419". Vacío/omitido = inglés (Teach). */
  webSpeechLang?: string;
  resolve?: (value: { durationMs: number }) => void;
  /**
   * Disparado justo antes de que el audio empiece a sonar (ElevenLabs) o de
   * invocar `speechSynthesis.speak` (Web Speech). Permite a quienes encolan
   * frases sincronizar caption/log con el inicio real del audio en vez de con
   * el momento en que se llama a `speakAsync`.
   */
  onStart?: () => void;
  /**
   * Promesa que se "awaitea" justo antes de arrancar la reproducción. Sirve
   * para sincronizar el inicio del audio con un evento externo (p. ej. que el
   * worker de dibujos termine de dibujar lo asociado a la frase previa). La
   * generación/decodificación del buffer NO se bloquea por esto, sólo el
   * `play()` final.
   */
  waitBeforePlay?: Promise<unknown>;
  /**
   * Tope superior para el `waitBeforePlay`. Si la promesa no resuelve en este
   * tiempo, arrancamos el audio igual para evitar silencios encadenados ante
   * un dibujo que se cuelgue. Default: 1500ms.
   */
  waitBeforePlayCapMs?: number;
}

const DEFAULT_WAIT_BEFORE_PLAY_CAP_MS = 1500;

/**
 * Espera a `task.waitBeforePlay` con un cap. Devuelve `true` si la espera
 * se completó por la promesa, `false` si fue por el timeout. Nunca lanza:
 * un reject en la promesa externa se trata igual que "ya está listo" (porque
 * el caller del speak no debe romperse si el draw worker tropezó).
 */
async function awaitBeforePlay(task: SpeakTask): Promise<void> {
  if (!task.waitBeforePlay) return;
  const cap = task.waitBeforePlayCapMs ?? DEFAULT_WAIT_BEFORE_PLAY_CAP_MS;
  await Promise.race([
    Promise.resolve(task.waitBeforePlay).catch(() => {}),
    new Promise<void>((resolve) => setTimeout(resolve, cap)),
  ]);
}

/**
 * Item ya generado/decodificado, listo para reproducirse.
 *
 * `play()` arranca la reproducción y se resuelve cuando termina (onended o
 * watchdog). No toca phase/speaking porque eso lo gobierna `drainQueue` para
 * evitar parpadeo entre frases pipeleadas.
 */
type PreparedSpeakTask = {
  task: SpeakTask;
  play: () => Promise<void>;
};

export interface UseSpeech {
  status: SpeechStatus;
  engine: SpeechEngine;
  phase: SpeechPhase;
  muted: boolean;
  setMuted: (value: boolean) => void;
  unlock: (opts?: { timeoutMs?: number }) => Promise<{ ok: boolean; state: string }>;
  speak: (text: string) => void;
  speakAsync: (
    text: string,
    opts?: {
      timeoutMs?: number;
      webSpeechLang?: string;
      onStart?: () => void;
      /**
       * Promesa que la cola de speech esperará (con tope) ANTES de arrancar
       * el audio de esta frase. Útil para sincronizar con el draw worker.
       */
      waitBeforePlay?: Promise<unknown>;
      /** Tope para `waitBeforePlay`. Default: 1500ms. */
      waitBeforePlayCapMs?: number;
    },
  ) => Promise<{ durationMs: number }>;
  cancel: () => void;
  available: boolean;
  isSpeaking: boolean;
  /** Disponibilidad del proxy /api/tts (clave de API en server, etc). */
  elevenLabsStatus: ElevenLabsStatus;
}

function hasSpeechSynthesis(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
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

/** Voz de Web Speech preferente para un BCP-47; prioriza es-MX/es-419/es-US. */
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

function langPrefix(bcp47: string): string {
  return (bcp47 ?? "").toLowerCase().slice(0, 2);
}

function voiceMatchesLang(
  voice: SpeechSynthesisVoice,
  utteranceLang: string,
): boolean {
  return langPrefix(voice.lang) === langPrefix(utteranceLang);
}

/**
 * Espera (con tope corto) a que `speechSynthesis.getVoices()` devuelva voces.
 * Chrome/Edge devuelve `[]` hasta disparar `voiceschanged`; sin esto el primer
 * `speak` cae a fallback EN aunque el utterance pida es-*.
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

export function useSpeech(): UseSpeech {
  // Primer render = SSR-safe (idéntico en server y client). El resto se decide
  // dentro de `useEffect` después del mount.
  const [status, setStatus] = useState<SpeechStatus>("loading");
  const [engine, setEngine] = useState<SpeechEngine>("none");
  const [phase, setPhase] = useState<SpeechPhase>("idle");
  const [muted, setMutedState] = useState<boolean>(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [elevenLabsStatus, setElevenLabsStatus] =
    useState<ElevenLabsStatus>("unknown");

  const audioCtxRef = useRef<AudioContext | null>(null);
  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const queueRef = useRef<SpeakTask[]>([]);
  const runningRef = useRef(false);
  /**
   * Slot de prefetch (depth=1) usado por `drainQueue`: mientras suena la frase
   * N, aquí guardamos la frase N+1 ya generada/decodificada. Lo expongo como
   * ref para que `cancel()` y `setMuted(true)` puedan marcar su task como
   * cancelada y evitar que un buffer huérfano arranque después.
   */
  const prefetchedRef = useRef<PreparedSpeakTask | null>(null);
  /**
   * Timestamp `performance.now()` al que terminó la última reproducción. Sólo
   * para el log `dbg` (gap entre frases). 0 = sin frase previa.
   */
  const lastPlayEndRef = useRef(0);
  const preferredVoiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const preferredEsVoiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const elevenLabsStatusRef = useRef<ElevenLabsStatus>("unknown");
  /**
   * Contador de fallos consecutivos del proxy `/api/tts`. Un 503/429 puntual
   * no debe tirar el motor para el resto de la sesión: sólo marcamos
   * `blocked` cuando hay 2+ fallos seguidos. Cualquier éxito (prepare ok)
   * resetea el contador.
   */
  const elevenLabsConsecutiveFailsRef = useRef(0);
  const mutedRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const readyWaitersRef = useRef<Array<() => void>>([]);
  const engineRef = useRef<SpeechEngine>("none");
  const statusRef = useRef<SpeechStatus>("loading");

  useEffect(() => {
    engineRef.current = engine;
    statusRef.current = status;
  }, [engine, status]);

  useEffect(() => {
    elevenLabsStatusRef.current = elevenLabsStatus;
  }, [elevenLabsStatus]);

  // Activamos Web Speech inmediatamente *después* del mount (evita hydration mismatch).
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
  }, []);

  useEffect(() => {
    if (statusRef.current === "ready" && engineRef.current !== "none") notifyReady();
  }, [engine, notifyReady, status]);

  // Probe pasivo de /api/tts (sin gastar tokens): GET barato. El endpoint siempre
  // responde 200 con `{ ok }` en el body; decidir por `body.ok` evita el ruido
  // de "Failed to load resource: 503" en la consola cuando ElevenLabs no está
  // configurado en el servidor.
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

  // Re-probe periódico mientras estamos `blocked`: si ElevenLabs se cae por un
  // rato (rate-limit, mantenimiento, hipo de la API), volvemos a `ready` en
  // cuanto se recupere sin requerir refresh manual del usuario.
  useEffect(() => {
    if (elevenLabsStatus !== "blocked") return;
    let cancelled = false;
    const interval = setInterval(async () => {
      if (cancelled) return;
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
        if (bodyOk) {
          elevenLabsConsecutiveFailsRef.current = 0;
          setElevenLabsStatus("ready");
        }
      } catch {
        // ignore: seguimos blocked, reintentamos en el próximo tick
      }
    }, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [elevenLabsStatus]);

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
    if (prefetchedRef.current) {
      prefetchedRef.current.task.cancelled = true;
      try {
        prefetchedRef.current.task.resolve?.({ durationMs: 0 });
      } catch {
        // ignore
      }
      prefetchedRef.current = null;
    }
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
    lastPlayEndRef.current = 0;
    setSpeaking(false);
    setPhase("idle");
  }, [setSpeaking]);

  const setMuted = useCallback(
    (value: boolean) => {
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
        if (prefetchedRef.current) {
          prefetchedRef.current.task.cancelled = true;
          try {
            prefetchedRef.current.task.resolve?.({ durationMs: 0 });
          } catch {
            // ignore
          }
          prefetchedRef.current = null;
        }
        try {
          activeSourceRef.current?.stop();
        } catch {
          // ignore
        }
        activeSourceRef.current = null;
        if (hasSpeechSynthesis()) window.speechSynthesis.cancel();
        lastPlayEndRef.current = 0;
        setSpeaking(false);
        setPhase("idle");
      }
    },
    [setSpeaking],
  );

  // Web Speech warmup: asegura que `getVoices()` esté caliente al primer turno.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!hasSpeechSynthesis()) return;
    const warmVoices = () => {
      preferredVoiceRef.current = pickPreferredVoice();
      const es = pickPreferredVoiceForLang("es-419");
      if (es && langPrefix(es.lang) === "es") {
        preferredEsVoiceRef.current = es;
      }
    };
    warmVoices();
    window.speechSynthesis.onvoiceschanged = warmVoices;
  }, []);

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

  const playWithWebSpeech = useCallback(
    async (text: string, task: SpeakTask) => {
      if (!hasSpeechSynthesis()) return;
      // Si todavía no llegaron las voces (común en Chrome/Edge en el primer
      // turno), esperamos a `voiceschanged`. Sin esto, español termina hablando
      // con voz inglesa hasta el segundo turno.
      if (window.speechSynthesis.getVoices().length === 0) {
        await waitForVoices(600);
      }
      // Sincronización con el caller (e.g. esperar a que el worker de draws
      // dibuje lo asociado a la frase previa). Tope: `waitBeforePlayCapMs`.
      await awaitBeforePlay(task);
      if (task.cancelled || mutedRef.current) {
        task.resolve?.({ durationMs: 0 });
        return;
      }
      await new Promise<void>((resolve) => {
        const utterance = new SpeechSynthesisUtterance(text);
        const lang = task.webSpeechLang ?? "en-US";
        const wantsEs = langPrefix(lang) === "es";
        utterance.lang = lang;
        utterance.rate = 0.97;
        utterance.pitch = 1.0;
        utterance.volume = 1;

        // Selección de voz "segura": preferimos una que coincida con el idioma
        // del utterance. Si no hay coincidencia, dejamos `utterance.voice` sin
        // asignar para que el SO elija por `lang`, en vez de forzar una voz EN
        // cuando se pidió ES.
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
          lastPlayEndRef.current = performance.now();
          task.resolve?.({ durationMs });
          resolve();
        };
        utterance.onerror = () => {
          task.resolve?.({ durationMs: 0 });
          resolve();
        };
        if (task.cancelled || mutedRef.current) {
          task.resolve?.({ durationMs: 0 });
          resolve();
          return;
        }
        try {
          const tPlayStart = performance.now();
          const prevEnd = lastPlayEndRef.current;
          const gapMs = prevEnd ? Math.round(tPlayStart - prevEnd) : null;
          // #region debug log
          dbg(
            "useSpeech.ts:playWebSpeech",
            "start",
            { gapMs, lang, textLen: text.length },
            "W1",
          );
          // #endregion
          try {
            task.onStart?.();
          } catch {
            // user callback no debe romper el playback
          }
          if (!isSpeakingRef.current) setSpeaking(true);
          setPhase("speaking");
          window.speechSynthesis.speak(utterance);
        } catch {
          task.resolve?.({ durationMs: 0 });
          resolve();
        }
      });
    },
    [setSpeaking],
  );

  /**
   * Etapa "prepare" de ElevenLabs: hace el fetch al proxy `/api/tts` y decodifica
   * el audio en un AudioBuffer. No reproduce nada todavía. Esto permite a
   * `drainQueue` arrancar la generación de la frase N+1 mientras `play()` de N
   * sigue sonando (prefetch=1).
   *
   * `setPhase("generating")` solo si NO estamos hablando ya: evita parpadeo
   * "speaking → generating → speaking" entre frases pipeleadas.
   */
  const prepareElevenLabs = useCallback(
    async (task: SpeakTask): Promise<PreparedSpeakTask | null> => {
      if (task.cancelled || mutedRef.current) {
        try {
          task.resolve?.({ durationMs: 0 });
        } catch {
          // ignore
        }
        return null;
      }
      if (!isSpeakingRef.current) setPhase("generating");

      const lang =
        langPrefix(task.webSpeechLang ?? "en-US") === "es" ? "es" : "en";
      const t0 = performance.now();
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: task.text, lang }),
      });
      if (!res.ok || !res.body) {
        const detail = await res.text().catch(() => "");
        throw new Error(`elevenlabs proxy ${res.status}: ${detail.slice(0, 200)}`);
      }
      const arrayBuf = await res.arrayBuffer();
      const genMs = Math.round(performance.now() - t0);
      // #region debug log
      dbg(
        "useSpeech.ts:prepareElevenLabs",
        "fetched",
        { genMs, bytes: arrayBuf.byteLength, lang, textLen: task.text.length },
        "E1",
      );
      // #endregion

      if (task.cancelled || mutedRef.current) {
        try {
          task.resolve?.({ durationMs: 0 });
        } catch {
          // ignore
        }
        return null;
      }
      const ctx = ensureAudioCtx();
      if (!ctx) throw new Error("AudioContext unavailable");
      const buffer = await ctx.decodeAudioData(arrayBuf.slice(0));
      const durationMs = Math.round(buffer.duration * 1000);

      return {
        task,
        play: async () => {
          if (task.cancelled || mutedRef.current) {
            task.resolve?.({ durationMs: 0 });
            return;
          }
          if (ctx.state !== "running") {
            await unlock({ timeoutMs: 2500 });
          }
          if (task.cancelled || mutedRef.current) {
            task.resolve?.({ durationMs: 0 });
            return;
          }
          // Sincronización con el caller: el buffer ya está listo, sólo
          // esperamos (con tope) a que el draw asociado a la frase previa
          // termine. Esto NO bloquea el prefetch de la siguiente frase.
          await awaitBeforePlay(task);
          if (task.cancelled || mutedRef.current) {
            task.resolve?.({ durationMs: 0 });
            return;
          }
          const source = ctx.createBufferSource();
          source.buffer = buffer;
          source.connect(ctx.destination);
          activeSourceRef.current = source;

          const tPlayStart = performance.now();
          const prevEnd = lastPlayEndRef.current;
          const gapMs = prevEnd ? Math.round(tPlayStart - prevEnd) : null;
          // #region debug log
          dbg(
            "useSpeech.ts:playElevenLabs",
            "start",
            { gapMs, durationMs, genMs, textLen: task.text.length },
            "E2",
          );
          // #endregion

          try {
            task.onStart?.();
          } catch {
            // user callback no debe romper el playback
          }
          if (!isSpeakingRef.current) setSpeaking(true);
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

          lastPlayEndRef.current = performance.now();
          if (activeSourceRef.current === source) activeSourceRef.current = null;
          task.resolve?.({ durationMs });
        },
      };
    },
    [ensureAudioCtx, setSpeaking, unlock],
  );

  /**
   * Decide motor y devuelve un `PreparedSpeakTask`. Reglas:
   *   1. Si el proxy ElevenLabs está `ready` → usar ElevenLabs (cualquier idioma).
   *   2. Si falla (red, 5xx, decode), marcamos `blocked` y caemos a Web Speech.
   *   3. Si no hay ElevenLabs y existe `speechSynthesis` → Web Speech.
   *   4. Sin nada disponible → resolvemos con duración 0 (no-op).
   */
  const prepareTask = useCallback(
    async (task: SpeakTask): Promise<PreparedSpeakTask | null> => {
      if (task.cancelled || mutedRef.current) {
        try {
          task.resolve?.({ durationMs: 0 });
        } catch {
          // ignore
        }
        return null;
      }

      if (elevenLabsStatusRef.current === "ready") {
        try {
          const prep = await prepareElevenLabs(task);
          if (prep) {
            // Éxito de ElevenLabs: limpiamos el contador para que un fallo
            // aislado posterior no cuente como "consecutivo".
            elevenLabsConsecutiveFailsRef.current = 0;
            return prep;
          }
        } catch (e) {
          elevenLabsConsecutiveFailsRef.current += 1;
          const fails = elevenLabsConsecutiveFailsRef.current;
          console.warn(
            `[useSpeech] ElevenLabs prepare failed (${fails} consecutive), falling back`,
            e,
          );
          // Sólo bloqueamos el motor cuando hay 2 fallos consecutivos. Un 503
          // aislado (que pasa cuando ElevenLabs hace throttle puntual) cae a
          // Web Speech sólo en esa frase, pero la siguiente vuelve a intentar
          // ElevenLabs.
          if (fails >= 2) {
            setElevenLabsStatus("blocked");
            elevenLabsStatusRef.current = "blocked";
          }
          if (task.cancelled || mutedRef.current) {
            try {
              task.resolve?.({ durationMs: 0 });
            } catch {
              // ignore
            }
            return null;
          }
        }
      }

      if (!hasSpeechSynthesis()) {
        try {
          task.resolve?.({ durationMs: 0 });
        } catch {
          // ignore
        }
        return null;
      }
      return {
        task,
        play: () => playWithWebSpeech(task.text, task),
      };
    },
    [prepareElevenLabs, playWithWebSpeech],
  );

  /**
   * Loop de drenado con prefetch=1.
   *
   * Mientras la frase N se reproduce (`await cur.play()`), arrancamos
   * `prepareTask(N+1)` en paralelo. Cuando termina N, el buffer de N+1 ya está
   * listo y `play(N+1)` arranca sin gap apreciable — la misma sensación que
   * Web Speech del SO, donde no hay fase de generación.
   *
   * Tasks cancelados (vía `cancel()` o `setMuted(true)`) ven `task.cancelled=true`
   * dentro de `prepare`/`play` y resuelven con duration=0 sin tocar audio.
   * `prefetchedRef` hace visible al exterior el slot pre-cargado.
   *
   * Phase/speaking se gobiernan acá (no dentro de cada `play()`):
   *   - inicio del loop: phase="generating" si no estamos hablando
   *   - cada `play()` interno setea phase="speaking" + setSpeaking(true)
   *   - finally del loop: phase="idle" + setSpeaking(false)
   */
  const drainQueue = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;

    let prefetched: PreparedSpeakTask | null = prefetchedRef.current;
    prefetchedRef.current = prefetched;

    try {
      if (!isSpeakingRef.current) setPhase("generating");

      while (queueRef.current.length || prefetched) {
        let cur: PreparedSpeakTask | null;
        if (prefetched) {
          cur = prefetched;
          prefetched = null;
          prefetchedRef.current = null;
        } else {
          const t = queueRef.current.shift()!;
          cur = await prepareTask(t);
        }

        // Disparar prefetch de N+1 si ya hay item en cola, ANTES de empezar a
        // reproducir N. Así `gen(N+1)` corre en paralelo a `play(N)`.
        const nextTask = queueRef.current.shift();
        const nextP = nextTask ? prepareTask(nextTask) : null;

        if (cur) {
          try {
            await cur.play();
          } catch (e) {
            console.warn("[useSpeech] play failed", e);
            try {
              cur.task.resolve?.({ durationMs: 0 });
            } catch {
              // ignore
            }
          }
        }

        if (nextP) {
          try {
            prefetched = await nextP;
            prefetchedRef.current = prefetched;
          } catch (e) {
            console.warn("[useSpeech] prefetch prepare failed", e);
            prefetched = null;
            prefetchedRef.current = null;
          }
        } else if (queueRef.current.length > 0) {
          // Items que llegaron a la cola DURANTE play(N) y no alcanzamos a
          // pre-generar. Aquí pagamos `gen(M)` como gap; es el peor caso, pero
          // sólo ocurre cuando el SSE entrega el siguiente speak más lento que
          // ElevenLabs (raro en práctica).
          const lateTask = queueRef.current.shift()!;
          try {
            prefetched = await prepareTask(lateTask);
            prefetchedRef.current = prefetched;
          } catch (e) {
            console.warn("[useSpeech] late prepare failed", e);
            prefetched = null;
            prefetchedRef.current = null;
          }
        }
      }
    } finally {
      runningRef.current = false;
      prefetchedRef.current = null;
      if (isSpeakingRef.current) setSpeaking(false);
      setPhase("idle");
    }
  }, [prepareTask, setSpeaking]);

  const speakAsync = useCallback(
    async (
      text: string,
      opts?: {
        timeoutMs?: number;
        webSpeechLang?: string;
        onStart?: () => void;
        waitBeforePlay?: Promise<unknown>;
        waitBeforePlayCapMs?: number;
      },
    ): Promise<{ durationMs: number }> => {
      const timeoutMs = opts?.timeoutMs ?? 30000;
      if (!text || mutedRef.current) return { durationMs: 0 };

      const enqueue = (): Promise<{ durationMs: number }> => {
        const task: SpeakTask = {
          text,
          cancelled: false,
          webSpeechLang: opts?.webSpeechLang,
          onStart: opts?.onStart,
          waitBeforePlay: opts?.waitBeforePlay,
          waitBeforePlayCapMs: opts?.waitBeforePlayCapMs,
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
        {
          engine: engineRef.current,
          status: statusRef.current,
          timeoutMs,
          textLen: text.length,
        },
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
    muted,
    setMuted,
    unlock,
    speak,
    speakAsync,
    cancel,
    available: engine !== "none",
    isSpeaking,
    elevenLabsStatus,
  };
}
