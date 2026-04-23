"use client";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useCallback, useRef, useState } from "react";
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
  type KokoroVoiceId,
  type KokoroVoicesCatalog,
  type SpeechEngine,
  type SpeechStatus,
} from "@/lib/useSpeech";

const STEP_DELAY_MS = 60;

export type AgentStatus =
  | "idle"
  | "thinking"
  | "speaking"
  | "drawing"
  | "done"
  | "error";

export type LogEntry =
  | { role: "user"; text: string; ts: number }
  | { role: "agent"; text: string; ts: number };

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
  penState: PenState;
  appState: ViewportAppState;
  setAppState: (s: ViewportAppState) => void;
  muted: boolean;
  setMuted: (value: boolean) => void;
  speechStatus: SpeechStatus;
  speechEngine: SpeechEngine;
  speechAvailable: boolean;
  kokoroInitError: string | null;
  retryKokoro: () => void;
  voice: KokoroVoiceId;
  setVoice: (id: KokoroVoiceId) => void;
  voices: KokoroVoicesCatalog;
  ask(question: string): Promise<void>;
  stop(): void;
  newLesson(): void;
}

export function useLessonStream(): UseLessonStream {
  const canvasRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const penRef = useRef<Point>({ ...DEFAULT_PEN_REST });
  const speech = useSpeech();

  const [status, setStatus] = useState<AgentStatus>("idle");
  const [caption, setCaption] = useState("");
  const [log, setLog] = useState<LogEntry[]>([]);
  const [apiKeyHint, setApiKeyHint] = useState<string | null>(null);
  const [penState, setPenState] = useState<PenState>(DEFAULT_PEN_STATE);
  const [appState, setAppStateInternal] = useState<ViewportAppState>(
    DEFAULT_VIEWPORT_STATE,
  );

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
    hidePen();
    setStatus("idle");
  }, [hidePen, speech]);

  const newLesson = useCallback(() => {
    stop();
    canvasRef.current?.updateScene({ elements: [] });
    penRef.current = { ...DEFAULT_PEN_REST };
    setPenState(DEFAULT_PEN_STATE);
    setCaption("");
    setLog([]);
    setApiKeyHint(null);
    setStatus("idle");
  }, [stop]);

  const ask = useCallback(
    async (question: string) => {
      const trimmed = question.trim();
      if (!trimmed || isBusy) return;

      stop();
      const controller = new AbortController();
      abortRef.current = controller;

      setStatus("thinking");
      setCaption("");
      setApiKeyHint(null);
      setLog((prev) => [...prev, { role: "user", text: trimmed, ts: Date.now() }]);

      const scene: any[] = [];
      canvasRef.current?.updateScene({ elements: [] });
      penRef.current = { ...DEFAULT_PEN_REST };
      setPenState({
        point: penRef.current,
        color: "neutral",
        phase: "rest",
        visible: true,
      });

      let speakCount = 0;
      let drawToolCalls = 0;

      try {
        const res = await fetch("/api/lesson", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: trimmed }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          const text = await res.text().catch(() => "");
          const msg = `HTTP ${res.status}: ${text.slice(0, 200)}`;
          setCaption(msg);
          setStatus("error");
          toast.error("Request failed", { description: msg });
          return;
        }

        for await (const { event, data } of parseSSE(res, controller.signal)) {
          if (controller.signal.aborted) return;

          if (event === "tool_call") {
            const name = data.name as string;

            if (name === "speak") {
              const text = String(data.input?.text ?? "");
              setStatus("speaking");
              setCaption(text);
              setLog((prev) => [
                ...prev,
                { role: "agent", text, ts: Date.now() },
              ]);
              speakCount++;
              speech.speak(text);
              const holdMs = Math.max(1200, text.length * 45);
              await new Promise((r) => setTimeout(r, holdMs));
              continue;
            }

            setStatus("drawing");
            drawToolCalls++;

            if (name === "clear_canvas") {
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
              continue;
            }

            try {
              const toolName = name as ToolName;
              const skeletons = toolCallToSkeletons(toolName, data.input);
              const shapeSkeletons = skeletons.filter(
                (s: any) => s?.type !== "text",
              );
              const textSkeletons = skeletons.filter(
                (s: any) => s?.type === "text",
              ) as TextSkeleton[];

              const color = penColorForTool(toolName, data.input);

              if (shapeSkeletons.length > 0) {
                const rest = await tracePenForShape({
                  name: toolName,
                  input: data.input,
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
                const { rest } = await typewriteText({
                  skeleton: textSkel,
                  api: canvasRef.current,
                  scene,
                  penFrom: penRef.current,
                  penColor: color,
                  setPen: setPenState,
                  signal: controller.signal,
                });
                penRef.current = rest;
              }
            } catch (e) {
              console.error("draw failed", data, e);
            }

            await new Promise((r) => setTimeout(r, STEP_DELAY_MS));
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
            return;
          } else if (event === "done") {
            break;
          } else if (event === "narration_delta") {
            console.warn("[ui] narration_delta ignored", data);
          }
        }

        if (drawToolCalls === 0 && speakCount === 0) {
          setCaption("No response received. Check the browser console.");
          setStatus("error");
          toast.error("Empty response", {
            description: "The agent returned no tool calls.",
          });
          return;
        }

        if (drawToolCalls === 0 && speakCount > 0) {
          toast.warning("Nothing was drawn", {
            description: "Rephrase the question to get a visual explanation.",
          });
        }

        // Gentle idle glide back to a resting point.
        if (!controller.signal.aborted) {
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
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [hidePen, isBusy, speech, stop],
  );

  return {
    canvasRef,
    status,
    caption,
    log,
    apiKeyHint,
    isBusy,
    penState,
    appState,
    setAppState,
    muted: speech.muted,
    setMuted: speech.setMuted,
    speechStatus: speech.status,
    speechEngine: speech.engine,
    speechAvailable: speech.available,
    kokoroInitError: speech.kokoroInitError,
    retryKokoro: speech.retryKokoro,
    voice: speech.voice,
    setVoice: speech.setVoice,
    voices: speech.voices,
    ask,
    stop,
    newLesson,
  };
}
