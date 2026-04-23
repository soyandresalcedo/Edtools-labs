"use client";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import type { AgentStatus as AgentStatusValue } from "@/lib/useLessonStream";
import type { SpeechPhase } from "@/lib/useSpeech";

const STATUS_COPY: Record<
  AgentStatusValue,
  { label: string; dot: string; variant: "outline" | "info" | "success" | "warning" | "destructive" }
> = {
  idle: { label: "Ready", dot: "bg-slate-400", variant: "outline" },
  thinking: { label: "Thinking", dot: "bg-sky-500", variant: "info" },
  speaking: { label: "Speaking", dot: "bg-sky-500", variant: "info" },
  drawing: { label: "Drawing", dot: "bg-sky-500", variant: "info" },
  done: { label: "Done", dot: "bg-emerald-500", variant: "success" },
  error: { label: "Error", dot: "bg-red-500", variant: "destructive" },
};

export function AgentStatus({
  status,
  speechPhase,
}: {
  status: AgentStatusValue;
  speechPhase?: SpeechPhase;
}) {
  const meta = STATUS_COPY[status];
  const animated =
    status === "thinking" || status === "speaking" || status === "drawing";

  const label =
    status === "speaking" && speechPhase === "generating"
      ? "Generating voice"
      : meta.label;

  return (
    <Badge variant={meta.variant} className="gap-2 px-3 py-1">
      <span
        className={cn(
          "h-2 w-2 rounded-full",
          meta.dot,
          animated && "animate-agent-pulse",
        )}
      />
      {label}
    </Badge>
  );
}
