"use client";

import dynamic from "next/dynamic";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types/types";
import "@excalidraw/excalidraw/index.css";

const Excalidraw = dynamic(
  async () => (await import("@excalidraw/excalidraw")).Excalidraw,
  { ssr: false }
);

export function LessonCanvas({
  onReady,
}: {
  onReady: (api: ExcalidrawImperativeAPI) => void;
}) {
  return (
    <div className="w-full h-full">
      <Excalidraw
        excalidrawAPI={(api) => {
          if (api) onReady(api);
        }}
        initialData={{ appState: { viewBackgroundColor: "#fafafa" } }}
        UIOptions={{
          canvasActions: {
            saveToActiveFile: false,
            loadScene: false,
            export: false,
            saveAsImage: false,
          },
        }}
      />
    </div>
  );
}

