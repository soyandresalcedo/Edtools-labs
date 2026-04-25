"use client";

import dynamic from "next/dynamic";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ViewportAppState } from "@/lib/sceneToViewport";
import type { AppLang } from "@/lib/lang";

const LessonCanvasInner = dynamic(() => import("./LessonCanvasInner"), {
  ssr: false,
});

export function LessonCanvas(props: {
  onReady: (api: ExcalidrawImperativeAPI) => void;
  onAppStateChange?: (s: ViewportAppState) => void;
  lang?: AppLang;
}) {
  return <LessonCanvasInner {...props} />;
}
