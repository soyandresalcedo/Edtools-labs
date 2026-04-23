"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type SpeechEngine = "kokoro" | "webspeech" | "none";
export type SpeechStatus =
  | "idle"
  | "loading"
  | "ready"
  | "error"
  | "unavailable";

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

type KokoroDtype = "fp32" | "fp16" | "q8" | "q4" | "q4f16";

function isKokoroVoiceId(v: string): v is KokoroVoiceId {
  return KOKORO_VOICES.some((item) => item.id === v);
}

type KokoroModule = typeof import("kokoro-js");
type KokoroTTS = InstanceType<KokoroModule["KokoroTTS"]>;

interface SpeakTask {
  text: string;
  cancelled: boolean;
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

/** Single-thread WASM avoids SharedArrayBuffer / cross-origin isolation issues. */
async function configureWasmSingleThread(): Promise<void> {
  try {
    const { env } = await import("@huggingface/transformers");
    const wasm = (
      env as {
        backends?: { onnx?: { wasm?: { numThreads?: number } } };
      }
    ).backends?.onnx?.wasm;
    if (wasm) wasm.numThreads = 1;
  } catch (e) {
    console.warn("[useSpeech] transformers WASM preset skipped", e);
  }
}

export interface UseSpeech {
  status: SpeechStatus;
  engine: SpeechEngine;
  muted: boolean;
  setMuted: (value: boolean) => void;
  voice: KokoroVoiceId;
  setVoice: (id: KokoroVoiceId) => void;
  voices: KokoroVoicesCatalog;
  speak: (text: string) => void;
  cancel: () => void;
  available: boolean;
  kokoroInitError: string | null;
  retryKokoro: () => void;
}

function hasWebGPU(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
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

function kokoroLoadAttempts(): Array<{ device: "webgpu" | "wasm"; dtype: KokoroDtype }> {
  const out: Array<{ device: "webgpu" | "wasm"; dtype: KokoroDtype }> = [];
  if (hasWebGPU()) {
    out.push({ device: "webgpu", dtype: "fp32" });
    out.push({ device: "webgpu", dtype: "q8" });
  }
  out.push({ device: "wasm", dtype: "q8" });
  out.push({ device: "wasm", dtype: "q4f16" });
  out.push({ device: "wasm", dtype: "q4" });
  return out;
}

export function useSpeech(): UseSpeech {
  const [status, setStatus] = useState<SpeechStatus>("loading");
  const [engine, setEngine] = useState<SpeechEngine>("none");
  const [muted, setMutedState] = useState<boolean>(false);
  const [voice, setVoiceState] = useState<KokoroVoiceId>(DEFAULT_KOKORO_VOICE);
  const [kokoroInitError, setKokoroInitError] = useState<string | null>(null);
  const [loadKey, setLoadKey] = useState(0);

  const ttsRef = useRef<KokoroTTS | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const queueRef = useRef<SpeakTask[]>([]);
  const runningRef = useRef(false);
  const preferredVoiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const mutedRef = useRef(false);
  const voiceRef = useRef<KokoroVoiceId>(DEFAULT_KOKORO_VOICE);

  useEffect(() => {
    voiceRef.current = voice;
  }, [voice]);

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

  const cancel = useCallback(() => {
    queueRef.current.forEach((t) => {
      t.cancelled = true;
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
  }, []);

  const retryKokoro = useCallback(() => {
    cancel();
    ttsRef.current = null;
    setKokoroInitError(null);
    setStatus("loading");
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
      });
      queueRef.current = [];
      try {
        activeSourceRef.current?.stop();
      } catch {
        // ignore
      }
      activeSourceRef.current = null;
      if (hasSpeechSynthesis()) window.speechSynthesis.cancel();
    }
  }, []);

  useEffect(() => {
    let disposed = false;

    async function init() {
      if (typeof window === "undefined") return;

      setStatus("loading");
      setKokoroInitError(null);

      if (hasSpeechSynthesis()) {
        const warmVoices = () => {
          preferredVoiceRef.current = pickPreferredVoice();
        };
        warmVoices();
        window.speechSynthesis.onvoiceschanged = warmVoices;
      }

      try {
        await configureWasmSingleThread();
        if (disposed) return;

        const mod = await import("kokoro-js");
        if (disposed) return;

        let lastErr: unknown;
        for (const { device, dtype } of kokoroLoadAttempts()) {
          if (disposed) return;
          try {
            const tts = await mod.KokoroTTS.from_pretrained(KOKORO_MODEL_ID, {
              dtype,
              device,
            });
            if (disposed) return;
            ttsRef.current = tts;
            setEngine("kokoro");
            setKokoroInitError(null);
            setStatus("ready");
            return;
          } catch (e) {
            lastErr = e;
            console.warn(`[useSpeech] Kokoro load failed (${device}/${dtype})`, e);
          }
        }
        throw lastErr ?? new Error("Kokoro: all load attempts failed");
      } catch (err) {
        console.warn("[useSpeech] Kokoro load failed, falling back", err);
        if (disposed) return;
        setKokoroInitError(formatInitError(err));
        ttsRef.current = null;
        if (hasSpeechSynthesis()) {
          setEngine("webspeech");
          setStatus("ready");
        } else {
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

  const playWithKokoro = useCallback(
    async (text: string, task: SpeakTask) => {
      const tts = ttsRef.current;
      if (!tts) throw new Error("Kokoro not ready");
      const audio = await tts.generate(text, { voice: voiceRef.current });
      if (task.cancelled || mutedRef.current) return;
      const ctx = ensureAudioCtx();
      if (!ctx) throw new Error("AudioContext unavailable");
      if (ctx.state === "suspended") {
        try {
          await ctx.resume();
        } catch {
          // ignore
        }
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
      await new Promise<void>((resolve) => {
        source.onended = () => resolve();
        try {
          source.start();
        } catch (e) {
          console.warn("[useSpeech] source.start failed", e);
          resolve();
        }
      });
      if (activeSourceRef.current === source) activeSourceRef.current = null;
    },
    [ensureAudioCtx],
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
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      if (task.cancelled || mutedRef.current) {
        resolve();
        return;
      }
      try {
        window.speechSynthesis.speak(utterance);
      } catch {
        resolve();
      }
    });
  }, []);

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
        }
      }
    } finally {
      runningRef.current = false;
    }
  }, [playWithKokoro, playWithWebSpeech]);

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
    muted,
    setMuted,
    voice,
    setVoice,
    voices: KOKORO_VOICES,
    speak,
    cancel,
    available: engine !== "none",
    kokoroInitError,
    retryKokoro,
  };
}
