"use client";

import { useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { LogEntry } from "@/lib/useLessonStream";
import type { AgentStatus } from "@/lib/useLessonStream";
import type { AppLang } from "@/lib/lang";
import { LabCard } from "@/components/agent/LabCard";

export function ConversationLog({
  entries,
  currentCaption,
  isSpeaking,
  lang,
  agentStatus,
  patchLabSuggestion,
  askLab,
  unlockAudio,
}: {
  entries: LogEntry[];
  currentCaption: string;
  isSpeaking: boolean;
  lang: AppLang;
  agentStatus: AgentStatus;
  patchLabSuggestion: (
    id: string,
    patch: Partial<
      Pick<
        Extract<LogEntry, { role: "lab_suggestion" }>,
        "state" | "predictionChoice"
      >
    >,
  ) => void;
  askLab: (input: {
    question: string;
    handoffContext?: string;
    sensorSummary?: string;
    predictionChoice?: string;
  }) => void | Promise<void>;
  unlockAudio: () => void;
}) {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [entries.length, currentCaption]);

  if (entries.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-lg font-semibold text-primary">
          EL
        </div>
        <p className="text-sm font-medium text-foreground">
          Hi, I&apos;m Edtools Labs.
        </p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Pick a chip below or type a kinematics question. I&apos;ll explain it
          on the board while I narrate each step.
        </p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-4 px-4 py-4">
        {entries.map((entry, idx) => {
          if (entry.role === "lab_suggestion") {
            return (
              <div key={entry.id} className="flex flex-col items-start">
                <span className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {lang === "es" ? "Laboratorio" : "Lab"}
                </span>
                <LabCard
                  entry={entry}
                  lang={lang}
                  log={entries.slice(0, idx + 1)}
                  status={agentStatus}
                  patchLabSuggestion={patchLabSuggestion}
                  askLab={askLab}
                  unlockAudio={unlockAudio}
                />
              </div>
            );
          }

          const isLastAgent =
            isSpeaking &&
            entry.role === "agent" &&
            idx === entries.length - 1 &&
            entry.text === currentCaption;

          return (
            <div
              key={`${entry.ts}-${idx}`}
              className={cn(
                "flex flex-col",
                entry.role === "user" ? "items-end" : "items-start",
              )}
            >
              <span
                className={cn(
                  "mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground",
                )}
              >
                {entry.role === "user" ? "You" : "Edtools Labs"}
              </span>
              <div
                className={cn(
                  "max-w-[90%] rounded-2xl px-3 py-2 text-sm leading-snug",
                  entry.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-foreground",
                  isLastAgent && "ring-2 ring-sky-500/60",
                )}
              >
                {entry.text}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}
