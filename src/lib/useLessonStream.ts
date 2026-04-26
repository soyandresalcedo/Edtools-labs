"use client";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  buildElementsFromSkeletons,
  toolCallToSkeletons,
} from "@/lib/excalidrawOps";
import {
  DEFAULT_PEN_REST,
  tracePenForShape,
  glidePen,
} from "@/lib/penMotion";
import { typewriteText, type TextSkeleton } from "@/lib/typewriter";
import type { Point, ViewportAppState } from "@/lib/sceneToViewport";
import { DEFAULT_VIEWPORT_STATE } from "@/lib/sceneToViewport";
import {
  DEFAULT_PEN_STATE,
  type PenColor,
  type PenState,
} from "@/components/agent/PenCursor";
import type { ToolName } from "@/lib/tools";
import {
  useSpeech,
  type ElevenLabsStatus,
  type SpeechEngine,
  type SpeechPhase,
  type SpeechStatus,
} from "@/lib/useSpeech";
import type { AppLang } from "@/lib/lang";
import {
  inferDefaultLang,
  readStoredLang,
  writeStoredLang,
  webSpeechLocaleForLang,
} from "@/lib/lang";
import type { LabTopic } from "@/prompts/lab-recipes";
import { isLabTopic } from "@/prompts/lab-recipes";
import { formatProgressForPrompt, readLabProgress } from "@/lib/progressStore";
import {
  MAX_HISTORY_TURNS,
  type SessionToolUse,
  type SessionTurn,
} from "@/lib/sessionTypes";
import { isLikelyMode2Question } from "@/lib/modeTriggers";

const STEP_DELAY_MS = 60;

export type AgentStatus =
  | "idle"
  | "thinking"
  | "speaking"
  | "drawing"
  | "done"
  | "error";

export type LabSuggestionState =
  | "pending"
  | "predicting"
  | "running"
  | "reflecting"
  | "done"
  | "skipped";

export type LogEntry =
  | { role: "user"; text: string; ts: number; seq: number }
  | { role: "agent"; text: string; ts: number; seq: number }
  | {
      role: "lab_suggestion";
      id: string;
      ts: number;
      seq: number;
      topic: LabTopic;
      reason: string;
      predict?: { question: string; options: string[] };
      state: LabSuggestionState;
      predictionChoice?: string;
    };

type SSEEvent = { event: string; data: any };

async function* parseSSE(
  res: Response,
  signal: AbortSignal,
): AsyncGenerator<SSEEvent> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (signal.aborted) return;
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";

      for (const block of blocks) {
        const lines = block.split("\n");
        const eventLine = lines.find((l) => l.startsWith("event: "));
        const dataLine = lines.find((l) => l.startsWith("data: "));
        if (!eventLine || !dataLine) continue;
        yield {
          event: eventLine.slice(7),
          data: JSON.parse(dataLine.slice(6)),
        };
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
}

function penColorForTool(name: ToolName, input: any): PenColor {
  if (name === "draw_arrow") {
    switch (input?.kind) {
      case "velocity":
        return "velocity";
      case "acceleration":
        return "acceleration";
      case "force":
        return "force";
      case "displacement":
        return "displacement";
      default:
        return "neutral";
    }
  }
  return "neutral";
}

export interface UseLessonStream {
  canvasRef: React.MutableRefObject<ExcalidrawImperativeAPI | null>;
  status: AgentStatus;
  caption: string;
  log: LogEntry[];
  apiKeyHint: string | null;
  isBusy: boolean;
  isAudioSpeaking: boolean;
  unlockAudio: () => void;
  penState: PenState;
  appState: ViewportAppState;
  setAppState: (s: ViewportAppState) => void;
  muted: boolean;
  setMuted: (value: boolean) => void;
  speechStatus: SpeechStatus;
  speechEngine: SpeechEngine;
  speechPhase: SpeechPhase;
  speechAvailable: boolean;
  elevenLabsStatus: ElevenLabsStatus;
  lang: AppLang;
  setLang: (lang: AppLang) => void;
  ask(question: string): Promise<void>;
  askLab(input: {
    question: string;
    handoffContext?: string;
    sensorSummary?: string;
    predictionChoice?: string;
  }): Promise<void>;
  stop(): void;
  newLesson(): void;
  showLabReturn: boolean;
  returnToTeach: () => void;
  patchLabSuggestion: (
    id: string,
    patch: Partial<
      Pick<
        Extract<LogEntry, { role: "lab_suggestion" }>,
        "state" | "predictionChoice"
      >
    >,
  ) => void;
}

export function useLessonStream(): UseLessonStream {
  const canvasRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const penRef = useRef<Point>({ ...DEFAULT_PEN_REST });
  const speech = useSpeech();
  const lastSpeakDurationMsRef = useRef(0);
  const lastSpeakTextLenRef = useRef(0);
  const pendingSpeakPromiseRef = useRef<Promise<{ durationMs: number }> | null>(
    null,
  );
  // Cadena serial de Promesas para ejecutar los `draw_*` fuera del bucle SSE.
  // Cada `tool_call` de dibujo se encadena con `.then` y captura el promise del
  // `speak` inmediatamente anterior (`speakBefore`) antes de tocar el canvas.
  // Esto restaura la sincronía habla→dibuja sin re-bloquear el SSE (lo que
  // anularía el pipelining gen↔play de `useSpeech.drainQueue`).
  const pendingDrawWorkerRef = useRef<Promise<void>>(Promise.resolve());

  // Historial estructurado de la conversación. Cada turno guarda el texto del
  // usuario y los tool_uses que el modelo emitió en esa respuesta. Lo
  // enviamos a /api/lesson para que Claude reconstruya su propio contexto
  // (tema activo, lo dibujado, lo dicho) y mantenga la conversación
  // multi-turno. Solo se resetea con `newLesson`.
  const sessionTurnsRef = useRef<SessionTurn[]>([]);

  // Buffer del scene actual del canvas. Antes vivía como `const scene` dentro
  // de cada `askInternal` (se reseteaba en cada pregunta) — eso anulaba la
  // posibilidad de pedir follow-ups visuales sobre lo ya dibujado. Ahora
  // sobrevive entre turnos: solo se vacía cuando el modelo emite
  // `clear_canvas` o cuando el usuario pulsa "Nueva lección".
  const sceneRef = useRef<any[]>([]);

  // Contador monotonico para ordenar entradas del log por intencion del
  // modelo. `speak` se inserta cuando arranca el audio (callback `onStart`,
  // detras de la cola TTS), pero `suggest_lab` se inserta de inmediato al
  // recibir el SSE. Sin este `seq`, una `suggest_lab` emitida entre dos
  // `speak` puede aparecer en pantalla ANTES de los speaks que el modelo
  // emitio antes que ella. Con `seq` capturado al recibir el tool_call,
  // `ConversationLog` puede ordenar de forma estable y reflejar la
  // intencion del modelo, no el orden de inserciones efectivas.
  const logSeqRef = useRef(0);
  const nextLogSeq = useCallback(() => {
    logSeqRef.current += 1;
    return logSeqRef.current;
  }, []);

  const [status, setStatus] = useState<AgentStatus>("idle");
  const [caption, setCaption] = useState("");
  const [log, setLog] = useState<LogEntry[]>([]);
  const [apiKeyHint, setApiKeyHint] = useState<string | null>(null);
  const [showLabReturn, setShowLabReturn] = useState(false);
  const labReturnContextRef = useRef<string | null>(null);
  const [penState, setPenState] = useState<PenState>(DEFAULT_PEN_STATE);
  const [appState, setAppStateInternal] = useState<ViewportAppState>(
    DEFAULT_VIEWPORT_STATE,
  );
  const [lang, setLangState] = useState<AppLang>("en");
  const langRef = useRef<AppLang>("en");

  useEffect(() => {
    const stored = readStoredLang();
    const initial = stored ?? inferDefaultLang();
    setLangState(initial);
    langRef.current = initial;
  }, []);

  // Mantener `<html lang>` alineado con AppLang. El layout es server-rendered con
  // lang="en" (estable para hydration); aquí lo actualizamos post-mount para
  // accesibilidad y para que el navegador escoja la pronunciación correcta de
  // textos sin lang explícito.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.lang = lang === "es" ? "es" : "en";
  }, [lang]);

  const setLang = useCallback((next: AppLang) => {
    setLangState(next);
    langRef.current = next;
    writeStoredLang(next);
  }, []);

  const setAppState = useCallback((s: ViewportAppState) => {
    setAppStateInternal((prev) => {
      if (
        prev.zoom === s.zoom &&
        prev.scrollX === s.scrollX &&
        prev.scrollY === s.scrollY
      ) {
        return prev;
      }
      return s;
    });
  }, []);

  const isBusy =
    status === "thinking" || status === "speaking" || status === "drawing";

  const hidePen = useCallback(() => {
    setPenState((prev) => ({ ...prev, visible: false }));
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    speech.cancel();
    pendingSpeakPromiseRef.current = null;
    // Descartamos la cadena previa del draw worker para que la SIGUIENTE
    // lección no quede encolada detrás de closures pendientes. Los closures
    // viejos ya no harán nada visible porque cada paso chequea
    // `controller.signal.aborted` (que ahora es `true` tras el abort de
    // arriba), pero romper la referencia evita además que `await
    // pendingDrawWorkerRef.current` al final del próximo SSE espere a draws
    // huérfanos.
    pendingDrawWorkerRef.current = Promise.resolve();
    hidePen();
    setStatus("idle");
  }, [hidePen, speech]);

  const unlockAudio = useCallback(() => {
    void speech.unlock({ timeoutMs: 2500 });
  }, [speech]);

  const newLesson = useCallback(() => {
    stop();
    labReturnContextRef.current = null;
    setShowLabReturn(false);
    canvasRef.current?.updateScene({ elements: [] });
    penRef.current = { ...DEFAULT_PEN_REST };
    setPenState(DEFAULT_PEN_STATE);
    setCaption("");
    setLog([]);
    setApiKeyHint(null);
    sessionTurnsRef.current = [];
    sceneRef.current = [];
    logSeqRef.current = 0;
    setStatus("idle");
  }, [stop]);

  const patchLabSuggestion = useCallback(
    (
      id: string,
      patch: Partial<
        Pick<
          Extract<LogEntry, { role: "lab_suggestion" }>,
          "state" | "predictionChoice"
        >
      >,
    ) => {
      setLog((prev) =>
        prev.map((e) =>
          e.role === "lab_suggestion" && e.id === id ? { ...e, ...patch } : e,
        ),
      );
    },
    [],
  );

  type AskMode = "teach" | "lab";

  // Opciones internas (no expuestas al consumidor) para controlar el flujo
  // de auto-recuperacion: cuando el modelo respondio en MODE 2 sin emitir
  // ningun `draw_*`, lanzamos UN retry con `suppressUserLog` para que el
  // mensaje sintetico de continuacion no aparezca como un turno del alumno
  // en el chat. `retryAttempt` corta cualquier potencial loop infinito.
  type AskInternalOptions = {
    retryAttempt?: number;
    suppressUserLog?: boolean;
  };

  const askInternalRef = useRef<
    | ((
        mode: AskMode,
        input: {
          question: string;
          handoffContext?: string;
          sensorSummary?: string;
          predictionChoice?: string;
        },
        options?: AskInternalOptions,
      ) => Promise<void>)
    | null
  >(null);

  const askInternal = useCallback(
    async (
      mode: AskMode,
      input: {
        question: string;
        handoffContext?: string;
        sensorSummary?: string;
        predictionChoice?: string;
      },
      options?: AskInternalOptions,
    ) => {
      const trimmed = input.question.trim();
      if (!trimmed || isBusy) return;
      const retryAttempt = options?.retryAttempt ?? 0;
      const suppressUserLog = options?.suppressUserLog ?? false;

      labReturnContextRef.current = null;
      setShowLabReturn(false);

      unlockAudio();
      console.debug("[useLessonStream] ask", {
        speechEngine: speech.engine,
        speechStatus: speech.status,
        lang: langRef.current,
      });

      stop();
      const controller = new AbortController();
      abortRef.current = controller;

      setStatus("thinking");
      setCaption("");
      setApiKeyHint(null);
      let logUserText = trimmed;
      if (mode === "lab") {
        logUserText =
          langRef.current === "es" ? "Reflexión del lab" : "Lab reflection";
      } else if (
        trimmed.startsWith("We just completed") ||
        trimmed.startsWith("Acabamos de completar")
      ) {
        logUserText =
          langRef.current === "es"
            ? "Seguir después del lab"
            : "Continue after lab";
      }
      if (!suppressUserLog) {
        setLog((prev) => [
          ...prev,
          { role: "user", text: logUserText, ts: Date.now(), seq: nextLogSeq() },
        ]);
      }

      // CONVERSACIÓN MULTI-TURNO: el `scene` actual sobrevive entre `ask`s.
      // Solo se vacía cuando el modelo emite `clear_canvas` o cuando el
      // usuario pulsa "Nueva lección". Esto permite que un follow-up
      // ("explícamelo de nuevo", "y si...") agregue elementos sobre el
      // lienzo previo o limpie de forma explícita si el modelo lo decide.
      const scene = sceneRef.current;
      // El lápiz sí lo dejamos en su última posición de descanso para que la
      // siguiente animación no salte; no es estado lógico, es presentación.
      penRef.current = { ...DEFAULT_PEN_REST };
      setPenState({
        point: penRef.current,
        color: "neutral",
        phase: "rest",
        visible: true,
      });

      let speakCount = 0;
      let drawToolCalls = 0;
      let labSuggestCount = 0;
      const labAgentLines: string[] = [];
      const webLang = webSpeechLocaleForLang(langRef.current);

      // Buffer de tool_uses emitidos por el modelo en este turno. Se commitea
      // a `sessionTurnsRef` cuando llega `done` para que el próximo `ask`
      // mande un history coherente. Si el turno aborta o falla, no se
      // commitea (evitamos enviar tool_uses sin tool_results).
      const currentTurnToolUses: SessionToolUse[] = [];
      let toolUseCounter = 0;
      const nextToolUseId = () => {
        toolUseCounter += 1;
        return `cu-${Date.now().toString(36)}-${toolUseCounter}`;
      };

      try {
        {
          const deadline = Date.now() + 4000;
          while (!canvasRef.current && Date.now() < deadline) {
            if (controller.signal.aborted) return;
            // eslint-disable-next-line no-await-in-loop
            await new Promise((r) => setTimeout(r, 25));
          }
          if (!canvasRef.current) {
            const msg =
              "Excalidraw is still starting. Please wait a second and try again.";
            setCaption(msg);
            setStatus("error");
            toast.error("Canvas not ready", { description: msg });
            if (mode === "lab") throw new Error(msg);
            return;
          }
        }

        const labProgressSummary = formatProgressForPrompt(readLabProgress());

        const res = await fetch("/api/lesson", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question: trimmed,
            mode,
            handoffContext: input.handoffContext,
            sensorSummary: input.sensorSummary,
            lang: langRef.current,
            predictionChoice: input.predictionChoice,
            labProgressSummary,
            // Mandamos hasta MAX_HISTORY_TURNS turnos previos para que Claude
            // mantenga el tema activo y conozca lo que ya dibujó/dijo. El
            // server reconstruye estos turnos como user/assistant(tool_use)/
            // tool_result tríos antes de llamar a messages.stream.
            history: sessionTurnsRef.current.slice(-MAX_HISTORY_TURNS),
          }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          const text = await res.text().catch(() => "");
          const msg = `HTTP ${res.status}: ${text.slice(0, 200)}`;
          setCaption(msg);
          setStatus("error");
          toast.error("Request failed", { description: msg });
          if (mode === "lab") throw new Error(msg);
          return;
        }

        for await (const { event, data } of parseSSE(res, controller.signal)) {
          if (controller.signal.aborted) return;

          if (event === "tool_call") {
            const name = data.name as string;

            // Snapshot de cada tool_use para reconstruir el turno cuando
            // termine. Se incluyen TODOS los tools (speak, draw_*,
            // clear_canvas, suggest_lab) porque la API de Anthropic exige
            // un tool_result por cada tool_use que vea en `assistant`.
            currentTurnToolUses.push({
              id: nextToolUseId(),
              name: name as ToolName,
              input: data.input,
            });

            if (name === "speak") {
              const text = String(data.input?.text ?? "");
              // OJO: NO esperamos al `pendingSpeakPromiseRef` previo. Si lo
              // hiciéramos, el bucle SSE quedaría bloqueado hasta que termine
              // de sonar la frase anterior y la siguiente ni siquiera entraría
              // a la cola → anula el pipelining de `useSpeech.drainQueue`.
              // En cambio, encolamos inmediatamente y delegamos la sincronía
              // de caption/log/status al callback `onStart`, que `useSpeech`
              // dispara justo antes de que el audio empiece a sonar.
              speakCount++;
              if (mode === "lab") labAgentLines.push(text);
              // Capturamos el `seq` AHORA (orden SSE), no en `onStart`. Si
              // un `suggest_lab` llega entre este speak y el siguiente, su
              // `seq` quedara mas alto que el de este speak y ConversationLog
              // los rendera en orden correcto aunque el speak se inserte mas
              // tarde (cuando arranque su audio).
              const speakSeq = nextLogSeq();
              // Snapshot del worker de draws ANTES de encolar el speak: en él
              // están los dibujos asociados al speak anterior. `useSpeech`
              // hará `await` (con cap 1500ms) sobre este snapshot ANTES de
              // arrancar el audio de esta frase, sin bloquear la generación.
              // El primer speak del turno encuentra el worker resuelto
              // (`stop()` lo deja en `Promise.resolve()`), así no introduce
              // gap inicial.
              const drawWorkerSnapshot = pendingDrawWorkerRef.current;
              const p = speech.speakAsync(text, {
                timeoutMs: 30000,
                webSpeechLang: webLang,
                waitBeforePlay: drawWorkerSnapshot,
                waitBeforePlayCapMs: 1500,
                onStart: () => {
                  setStatus("speaking");
                  setCaption(text);
                  setLog((prev) => [
                    ...prev,
                    { role: "agent", text, ts: Date.now(), seq: speakSeq },
                  ]);
                },
              });
              pendingSpeakPromiseRef.current = p;
              void p.then(({ durationMs }) => {
                lastSpeakDurationMsRef.current = durationMs;
                lastSpeakTextLenRef.current = text.length;
                if (pendingSpeakPromiseRef.current === p) {
                  pendingSpeakPromiseRef.current = null;
                }
              });
              continue;
            }

            if (name === "suggest_lab") {
              labSuggestCount++;
              const topic = data.input?.topic;
              const reason = String(data.input?.reason ?? "");
              const predict = data.input?.predict as
                | { question: string; options: string[] }
                | undefined;
              if (isLabTopic(topic) && reason.length >= 10) {
                const id = `lab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                const initialState: LabSuggestionState = predict?.options?.length
                  ? "predicting"
                  : "pending";
                const labSeq = nextLogSeq();
                setLog((prev) => [
                  ...prev,
                  {
                    role: "lab_suggestion",
                    id,
                    ts: Date.now(),
                    seq: labSeq,
                    topic,
                    reason,
                    predict,
                    state: initialState,
                  },
                ]);
              }
              continue;
            }

            // Encolamos el draw en una cadena serial de Promesas (`drawWorker`).
            // El SSE NO espera al draw: solo guarda el promise del `speak`
            // inmediatamente anterior (`speakBefore`) para que el closure lo
            // espere antes de tocar el canvas. Así:
            //   • Los `speak` siguen entrando rápido a la cola de useSpeech →
            //     el pipelining gen↔play (`drainQueue` prefetch=1) se
            //     conserva.
            //   • Cada draw arranca cuando su speak asociado terminó →
            //     restauramos el ritmo "habla, dibuja" del comportamiento
            //     original sin re-bloquear el SSE.
            drawToolCalls++;
            const speakBefore = pendingSpeakPromiseRef.current;
            const drawName = name;
            const drawInput = data.input;

            pendingDrawWorkerRef.current = pendingDrawWorkerRef.current.then(
              async () => {
                if (controller.signal.aborted) return;
                if (speakBefore) {
                  try {
                    await speakBefore;
                  } catch {
                    // El speak fue cancelado/abortado: seguimos igual; el
                    // chequeo de `controller.signal.aborted` justo abajo se
                    // encarga de cortar si la lección entera fue abortada.
                  }
                }
                if (controller.signal.aborted) return;

                setStatus("drawing");

                if (drawName === "clear_canvas") {
                  scene.length = 0;
                  canvasRef.current?.updateScene({ elements: [] });
                  penRef.current = { ...DEFAULT_PEN_REST };
                  setPenState({
                    point: penRef.current,
                    color: "neutral",
                    phase: "rest",
                    visible: true,
                  });
                  await new Promise((r) => setTimeout(r, STEP_DELAY_MS));
                  return;
                }

                try {
                  const toolName = drawName as ToolName;
                  const skeletons = toolCallToSkeletons(toolName, drawInput);
                  const shapeSkeletons = skeletons.filter(
                    (s: any) => s?.type !== "text",
                  );
                  const textSkeletons = skeletons.filter(
                    (s: any) => s?.type === "text",
                  ) as TextSkeleton[];

                  const color = penColorForTool(toolName, drawInput);

                  if (shapeSkeletons.length > 0) {
                    const rest = await tracePenForShape({
                      name: toolName,
                      input: drawInput,
                      current: penRef.current,
                      setPen: setPenState,
                      signal: controller.signal,
                    });
                    if (controller.signal.aborted) return;
                    penRef.current = rest;

                    const shapeElements =
                      await buildElementsFromSkeletons(shapeSkeletons);
                    scene.push(...shapeElements);
                    canvasRef.current?.updateScene({ elements: [...scene] });
                  }

                  for (const textSkel of textSkeletons) {
                    if (controller.signal.aborted) return;
                    const lastSpeakMs = lastSpeakDurationMsRef.current;
                    const lastCaptionLen = Math.max(
                      1,
                      lastSpeakTextLenRef.current,
                    );
                    const approxCharDelayMs = lastSpeakMs
                      ? Math.max(
                          20,
                          Math.min(
                            85,
                            Math.round(lastSpeakMs / lastCaptionLen),
                          ),
                        )
                      : undefined;
                    const { rest } = await typewriteText({
                      skeleton: textSkel,
                      api: canvasRef.current,
                      scene,
                      penFrom: penRef.current,
                      penColor: color,
                      setPen: setPenState,
                      signal: controller.signal,
                      charDelayMs: approxCharDelayMs,
                    });
                    penRef.current = rest;
                  }
                } catch (e) {
                  console.error(
                    "draw failed",
                    { name: drawName, input: drawInput },
                    e,
                  );
                }

                await new Promise((r) => setTimeout(r, STEP_DELAY_MS));
              },
            );
            continue;
          } else if (event === "tool_error") {
            console.warn("tool_error", data);
          } else if (event === "error") {
            const msg = data?.message ?? "Something went wrong. Try again.";
            setCaption(msg);
            setStatus("error");
            if (
              typeof data?.message === "string" &&
              data.message.includes("ANTHROPIC_API_KEY")
            ) {
              setApiKeyHint(
                "Add ANTHROPIC_API_KEY to .env.local and restart pnpm dev.",
              );
            }
            toast.error("Agent error", { description: msg });
            if (mode === "lab") throw new Error(msg);
            return;
          } else if (event === "done") {
            // Commit del turno: ahora `sessionTurnsRef` queda con un par
            // (user, assistantToolUses) coherente que el próximo `ask`
            // mandará al server. Truncamos al final de la lista para no
            // crecer sin límite (el slice del fetch además aplica un cap).
            if (currentTurnToolUses.length > 0) {
              sessionTurnsRef.current = [
                ...sessionTurnsRef.current,
                {
                  userText: trimmed,
                  assistantToolUses: currentTurnToolUses.slice(),
                },
              ].slice(-MAX_HISTORY_TURNS);
            }
            break;
          } else if (event === "narration_delta") {
            console.warn("[ui] narration_delta ignored", data);
          }
        }

        if (drawToolCalls === 0 && speakCount === 0 && labSuggestCount === 0) {
          const msg = "No response received. Check the browser console.";
          setCaption(msg);
          setStatus("error");
          toast.error("Empty response", {
            description: "The agent returned no tool calls.",
          });
          if (mode === "lab") throw new Error(msg);
          return;
        }

        if (mode === "lab" && speakCount > 0) {
          const L = langRef.current;
          const linesLabel =
            L === "es"
              ? "Líneas de voz del lab (en orden)"
              : "Lab voice lines (in order)";
          const ctx = `[[Lab completion]]
sensorSummary: ${input.sensorSummary ?? "(none)"}
predictionChoice: ${input.predictionChoice && input.predictionChoice.length > 0 ? input.predictionChoice : "(none)"}
From teach (handoffContext):
${input.handoffContext && input.handoffContext.length > 0 ? input.handoffContext : "(none)"}
${linesLabel}:
${labAgentLines.map((l, i) => `${i + 1}. ${l}`).join("\n")}`;
          labReturnContextRef.current = ctx;
          setShowLabReturn(false);
          const followQ =
            L === "es"
              ? "Acabamos de completar el laboratorio con el teléfono. En una o dos frases cortas de aula en español, conecta lo que sentiste y lo que dijo el lab con el tema de cinemática que estamos viendo; luego haz una pregunta socrática breve sobre el tema principal."
              : "We just completed the phone tilt lab. In one or two short classroom sentences, connect what you felt and what the lab said to the kinematics point we are studying, then ask one brief Socratic follow-up about the main topic.";
          window.setTimeout(() => {
            void askInternalRef.current?.("teach", {
              question: followQ,
              handoffContext: ctx,
            });
          }, 400);
        }

        // Auto-recuperacion para MODE 2: si la pregunta del alumno tenia
        // triggers de "explicame X" / "no entiendo X" / "show me X" pero
        // el modelo respondio solo con `speak` (sin clear_canvas ni
        // draw_*), reintentamos UNA vez con un mensaje sintetico que
        // referencia el turno fallido (ya esta en `sessionTurnsRef`).
        // No mostramos ese mensaje en el log para que el alumno no vea
        // texto raro: solo ve aparecer el dibujo que faltaba.
        //
        // OJO: el retry NO se dispara aqui. Lo agendamos para DESPUES de
        // `setStatus("done")` y de que el speech del turno actual termine,
        // porque askInternal hace `if (isBusy) return;` al inicio. Si lo
        // disparamos ahora, el audio del speak fallido sigue sonando,
        // `isBusy === true`, y el retry se descarta silenciosamente.
        let pendingMissedDrawsRetry = false;
        if (
          mode === "teach" &&
          drawToolCalls === 0 &&
          speakCount > 0 &&
          labSuggestCount === 0
        ) {
          const shouldAutoRetry =
            retryAttempt === 0 &&
            !suppressUserLog &&
            isLikelyMode2Question(trimmed, langRef.current);
          if (shouldAutoRetry) {
            pendingMissedDrawsRetry = true;
            console.debug(
              "[useLessonStream] will retry missing draws (MODE 2 trigger detected)",
              { trimmed },
            );
          } else {
            toast.warning("Nothing was drawn", {
              description: "Rephrase the question to get a visual explanation.",
            });
          }
        }

        if (!controller.signal.aborted) {
          if (pendingSpeakPromiseRef.current) {
            await pendingSpeakPromiseRef.current;
          }
          // Drenar la cadena del draw worker antes de mover el lápiz a rest:
          // si quedan draws pendientes (p. ej. el último grupo después del
          // último speak), los ejecutamos primero para que `glidePen` no
          // arranque encima de un canvas todavía mutándose.
          await pendingDrawWorkerRef.current;
          await glidePen({
            from: penRef.current,
            to: { ...DEFAULT_PEN_REST },
            setPen: setPenState,
            signal: controller.signal,
            duration: 380,
          });
          penRef.current = { ...DEFAULT_PEN_REST };
          setPenState({
            point: penRef.current,
            color: "neutral",
            phase: "rest",
            visible: true,
          });
        }

        setStatus("done");
        setTimeout(() => hidePen(), 1600);

        // Disparar retry de "missed draws" ahora que `status === "done"` y
        // el speech del turno fallido ya termino. askInternal hara `stop()`
        // por defecto, lo cual no afecta porque ya no hay nada en cola.
        if (pendingMissedDrawsRetry && !controller.signal.aborted) {
          const L = langRef.current;
          const recoveryQ =
            L === "es"
              ? "Tu última respuesta prometió mostrarme la gráfica/dibujo pero no dibujaste nada. Continúa AHORA con los draws que faltaron + un speak final socrático. NO repitas el saludo. NO uses clear_canvas si ya hay algo en pantalla."
              : "Your last turn promised a drawing but emitted no draws. Continue NOW with the missing draws + a final Socratic speak. Do NOT greet again. Do NOT clear_canvas if anything is already on screen.";
          window.setTimeout(() => {
            void askInternalRef.current?.(
              "teach",
              { question: recoveryQ },
              { retryAttempt: 1, suppressUserLog: true },
            );
          }, 250);
        }
      } catch (err) {
        if ((err as any)?.name === "AbortError") {
          hidePen();
          setStatus("idle");
          return;
        }
        console.error("ask fatal", err);
        setCaption(`Error: ${String(err)}`);
        setStatus("error");
        hidePen();
        toast.error("Unexpected error", { description: String(err) });
        if (mode === "lab") throw err;
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [hidePen, isBusy, nextLogSeq, speech, stop, unlockAudio],
  );

  askInternalRef.current = askInternal;

  const ask = useCallback(
    async (question: string) => {
      return askInternal("teach", { question });
    },
    [askInternal],
  );

  const askLab = useCallback(
    async (input: {
      question: string;
      handoffContext?: string;
      sensorSummary?: string;
      predictionChoice?: string;
    }) => {
      return askInternal("lab", input);
    },
    [askInternal],
  );

  const returnToTeach = useCallback(() => {
    const ctx = labReturnContextRef.current;
    if (!ctx) return;
    labReturnContextRef.current = null;
    setShowLabReturn(false);
    const L = langRef.current;
    const q =
      L === "es"
        ? "Acabamos de completar el laboratorio con el teléfono. En una o dos frases cortas de aula en español, conecta la experiencia y el diálogo del lab con el tema de cinemática que estamos viendo, luego una pregunta socrática breve."
        : "We just completed the phone tilt lab. In one or two short classroom English sentences, connect the tilt experience and the lab dialogue to the kinematics point we are studying, then ask one Socratic follow-up for the main topic.";
    void askInternal("teach", {
      question: q,
      handoffContext: ctx,
    });
  }, [askInternal]);

  return {
    canvasRef,
    status,
    caption,
    log,
    apiKeyHint,
    isBusy,
    isAudioSpeaking: speech.isSpeaking,
    unlockAudio,
    penState,
    appState,
    setAppState,
    muted: speech.muted,
    setMuted: speech.setMuted,
    speechStatus: speech.status,
    speechEngine: speech.engine,
    speechPhase: speech.phase,
    speechAvailable: speech.available,
    elevenLabsStatus: speech.elevenLabsStatus,
    lang,
    setLang,
    ask,
    askLab,
    stop,
    newLesson,
    showLabReturn,
    returnToTeach,
    patchLabSuggestion,
  };
}
