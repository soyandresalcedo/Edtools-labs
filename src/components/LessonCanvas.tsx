"use client";

import dynamic from "next/dynamic";
import { MainMenu, WelcomeScreen } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ViewportAppState } from "@/lib/sceneToViewport";
import "@excalidraw/excalidraw/index.css";

const Excalidraw = dynamic(
  async () => (await import("@excalidraw/excalidraw")).Excalidraw,
  { ssr: false },
);

export function LessonCanvas({
  onReady,
  onAppStateChange,
}: {
  onReady: (api: ExcalidrawImperativeAPI) => void;
  onAppStateChange?: (s: ViewportAppState) => void;
}) {
  return (
    <div className="w-full h-full">
      <Excalidraw
        excalidrawAPI={(api) => {
          if (api) onReady(api);
        }}
        onChange={(_elements, appState) => {
          if (!onAppStateChange) return;
          onAppStateChange({
            zoom: appState.zoom?.value ?? 1,
            scrollX: appState.scrollX ?? 0,
            scrollY: appState.scrollY ?? 0,
          });
        }}
        name=""
        theme="light"
        viewModeEnabled
        initialData={{
          appState: { viewBackgroundColor: "#fafafa", theme: "light" },
        }}
        UIOptions={{
          canvasActions: {
            saveToActiveFile: false,
            loadScene: false,
            export: false,
            saveAsImage: false,
            changeViewBackgroundColor: false,
            toggleTheme: false,
            clearCanvas: false,
          },
        }}
      >
        <MainMenu />
        <WelcomeScreen />
      </Excalidraw>
    </div>
  );
}
