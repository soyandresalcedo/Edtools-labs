"use client";

import { useState, type KeyboardEvent } from "react";
import { ArrowUp, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { AgentStatus } from "@/lib/useLessonStream";

export function QuestionInput({
  onUserGesture,
  onSubmit,
  onStop,
  status,
  disabled,
}: {
  onUserGesture: () => void;
  onSubmit: (q: string) => void;
  onStop: () => void;
  status: AgentStatus;
  disabled?: boolean;
}) {
  const [value, setValue] = useState("");
  const isBusy =
    status === "thinking" || status === "speaking" || status === "drawing";
  const blocked = isBusy || !!disabled;

  function submit() {
    const trimmed = value.trim();
    if (!trimmed || blocked) return;
    onUserGesture();
    onSubmit(trimmed);
    setValue("");
  }

  function handleKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div
      className={cn(
        "relative flex items-end gap-2 rounded-2xl border bg-background p-2 shadow-sm transition-shadow focus-within:ring-2 focus-within:ring-ring",
      )}
    >
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKey}
        placeholder="Ask me about kinematics…"
        rows={1}
        className="min-h-[40px] max-h-40 resize-none border-0 bg-transparent px-2 py-2 text-sm shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
        disabled={blocked}
      />
      {isBusy ? (
        <Button
          type="button"
          variant="default"
          size="icon"
          onClick={onStop}
          aria-label="Stop lesson"
        >
          <Square className="h-4 w-4" />
        </Button>
      ) : (
        <Button
          type="button"
          variant="default"
          size="icon"
          disabled={!value.trim()}
          onClick={submit}
          aria-label="Send question"
        >
          <ArrowUp className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
