"use client";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types/types";
import { useRef, useState } from "react";
import { LessonCanvas } from "@/components/LessonCanvas";
import {
  buildElementsFromSkeletons,
  toolCallToSkeletons,
} from "@/lib/excalidrawOps";

const STEP_DELAY_MS = 600;

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

  async function askOpus() {
    setLoading(true);
    setCaption("Pensando...");
    setApiKeyHint(null);
    let narration = "";
    const scene: any[] = [];
    apiRef.current?.updateScene({ elements: [] });

    const res = await fetch("/api/lesson", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    });

    for await (const { event, data } of parseSSE(res)) {
      if (event === "tool_call") {
        if (data.name === "clear_canvas") {
          scene.length = 0;
          apiRef.current?.updateScene({ elements: [] });
        } else {
          const skeletons = toolCallToSkeletons(data.name, data.input);
          const elements = buildElementsFromSkeletons(skeletons);
          scene.push(...elements);
          apiRef.current?.updateScene({ elements: [...scene] });
        }
        await new Promise((r) => setTimeout(r, STEP_DELAY_MS));
      } else if (event === "narration_delta") {
        narration += data.text;
        setCaption(narration);
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
      } else if (event === "done") {
        break;
      }
    }

    setLoading(false);
  }

  return (
    <main className="flex flex-col h-screen">
      <div className="flex-1 relative">
        <LessonCanvas onReady={(api) => (apiRef.current = api)} />
      </div>
      <div className="p-4 border-t bg-white space-y-2">
        <p className="text-sm text-slate-700 min-h-[1.5rem]">{caption || " "}</p>
        {apiKeyHint ? (
          <p className="text-xs text-slate-500">{apiKeyHint}</p>
        ) : null}
        <div className="flex gap-2">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Pregúntame sobre cinemática..."
            className="flex-1 px-3 py-2 border rounded"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !loading) askOpus();
            }}
          />
          <button
            onClick={askOpus}
            disabled={loading || !question}
            className="px-4 py-2 bg-slate-900 text-white rounded disabled:opacity-50"
          >
            {loading ? "..." : "Enséñame"}
          </button>
        </div>
      </div>
    </main>
  );
}

