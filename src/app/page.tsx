"use client";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useRef, useState } from "react";
import { LessonCanvas } from "@/components/LessonCanvas";
import {
  buildElementsFromSkeletons,
  toolCallToSkeletons,
} from "@/lib/excalidrawOps";
import type { ToolName } from "@/lib/tools";
const STEP_DELAY_MS = 250;

const PRESET_QUESTIONS = [
  "Explícame el MRU",
  "¿Velocidad vs aceleración?",
  "Gráfica x-t de un auto a velocidad constante",
  "¿Rapidez y velocidad son lo mismo?",
] as const;

type SSEEvent = { event: string; data: any };

async function* parseSSE(res: Response): AsyncGenerator<SSEEvent> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
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
}

export default function Home() {
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const [question, setQuestion] = useState("");
  const [caption, setCaption] = useState("");
  const [loading, setLoading] = useState(false);
  const [apiKeyHint, setApiKeyHint] = useState<string | null>(null);

  function newLesson() {
    apiRef.current?.updateScene({ elements: [] });
    setCaption("");
    setQuestion("");
    setApiKeyHint(null);
  }

  async function askOpusWith(q: string) {
    const trimmed = q.trim();
    if (!trimmed || loading) return;

    setLoading(true);
    setCaption("");
    setApiKeyHint(null);
    setQuestion(trimmed);

    let speakCount = 0;
    let drawToolCalls = 0;
    const scene: any[] = [];
    apiRef.current?.updateScene({ elements: [] });

    try {
      const res = await fetch("/api/lesson", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });

      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "");
        setCaption(`Error HTTP ${res.status}: ${text.slice(0, 200)}`);
        return;
      }

      for await (const { event, data } of parseSSE(res)) {
        if (event === "tool_call") {
          const name = data.name as string;

          if (name === "speak") {
            const text = String(data.input?.text ?? "");
            setCaption(text);
            speakCount++;
            const holdMs = Math.max(1200, text.length * 45);
            await new Promise((r) => setTimeout(r, holdMs));
            continue;
          }

          drawToolCalls++;

          if (name === "clear_canvas") {
            scene.length = 0;
            apiRef.current?.updateScene({ elements: [] });
          } else {
            try {
              const skeletons = toolCallToSkeletons(name as ToolName, data.input);
              const elements = await buildElementsFromSkeletons(skeletons);
              scene.push(...elements);
              apiRef.current?.updateScene({ elements: [...scene] });
            } catch (e) {
              console.error("draw failed", data, e);
            }
          }
          await new Promise((r) => setTimeout(r, STEP_DELAY_MS));
        } else if (event === "narration_delta") {
          // Legacy / otros backends; ignoramos en UI (Día 2 = solo speak tool)
          console.warn("[ui] narration_delta ignored", data);
        } else if (event === "tool_error") {
          console.warn("tool_error", data);
        } else if (event === "error") {
          setCaption(data?.message ?? "Uy, algo salió mal. Intenta de nuevo.");
          if (
            typeof data?.message === "string" &&
            data.message.includes("ANTHROPIC_API_KEY")
          ) {
            setApiKeyHint("Agrega ANTHROPIC_API_KEY en .env.local y reinicia pnpm dev.");
          }
          break;
        } else if (event === "done") {
          break;
        }
      }

      if (drawToolCalls === 0 && speakCount > 0) {
        setCaption(
          (prev) =>
            prev +
            "  ⚠️ Hubo speak pero no se dibujó nada. Reformula la pregunta o intenta de nuevo.",
        );
      } else if (drawToolCalls === 0 && speakCount === 0) {
        setCaption("No llegó respuesta. Revisa la consola del navegador.");
      }
    } catch (err) {
      console.error("askOpus fatal", err);
      setCaption(`Error: ${String(err)}`);
    } finally {
      setLoading(false);
    }
  }

  function askOpus() {
    void askOpusWith(question);
  }

  const showThinking = loading && !caption;

  return (
    <main className="flex flex-col h-screen">
      <div className="flex-1 relative">
        <LessonCanvas onReady={(api) => (apiRef.current = api)} />
      </div>
      <div className="p-4 border-t bg-white space-y-2">
        {showThinking ? (
          <p className="text-sm text-slate-500 italic">Opus está dibujando…</p>
        ) : null}
        <p className="text-sm text-slate-700 min-h-[1.5rem]">{caption || " "}</p>
        {apiKeyHint ? (
          <p className="text-xs text-slate-500">{apiKeyHint}</p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {PRESET_QUESTIONS.map((label) => (
            <button
              key={label}
              type="button"
              disabled={loading}
              onClick={() => void askOpusWith(label)}
              className="text-xs px-2 py-1 rounded-full border border-slate-300 bg-slate-50 hover:bg-slate-100 disabled:opacity-50"
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            disabled={loading}
            onClick={newLesson}
            className="text-xs px-2 py-1 rounded-full border border-slate-400 bg-white hover:bg-slate-50 disabled:opacity-50"
          >
            Nueva lección
          </button>
        </div>
        <div className="flex gap-2">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Pregúntame sobre cinemática..."
            className="flex-1 px-3 py-2 border rounded"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !loading && question.trim()) askOpus();
            }}
          />
          <button
            onClick={askOpus}
            disabled={loading || !question.trim()}
            className="px-4 py-2 bg-slate-900 text-white rounded disabled:opacity-50"
          >
            {loading ? "..." : "Enséñame"}
          </button>
        </div>
      </div>
    </main>
  );
}
