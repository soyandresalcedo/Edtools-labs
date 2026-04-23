"use client";

import { Button } from "@/components/ui/button";

export const PRESET_QUESTIONS = [
  "Explain uniform motion (MRU)",
  "Speed vs velocity?",
  "Position–time graph of a car at constant speed",
  "Are speed and velocity the same?",
  "What is uniformly accelerated motion?",
  "Explain free fall",
] as const;

export function QuestionChips({
  onSelect,
  disabled,
}: {
  onSelect: (q: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {PRESET_QUESTIONS.map((label) => (
        <Button
          key={label}
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => onSelect(label)}
          className="h-7 rounded-full px-3 text-xs font-normal"
        >
          {label}
        </Button>
      ))}
    </div>
  );
}
