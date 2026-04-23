"use client";

import { cn } from "@/lib/utils";
import type { AgentStatus } from "@/lib/useLessonStream";

export function CanvasCaptionOverlay({
  caption,
  status,
}: {
  caption: string;
  status: AgentStatus;
}) {
  const visible =
    caption.length > 0 &&
    (status === "speaking" ||
      status === "drawing" ||
      status === "thinking" ||
      status === "done");

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-0 bottom-6 z-10 flex justify-center px-6 transition-opacity duration-300",
        visible ? "opacity-100" : "opacity-0",
      )}
    >
      <div className="pointer-events-auto max-w-3xl rounded-xl border bg-background/90 px-5 py-3 text-sm leading-relaxed text-foreground shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/70">
        {caption || " "}
      </div>
    </div>
  );
}
