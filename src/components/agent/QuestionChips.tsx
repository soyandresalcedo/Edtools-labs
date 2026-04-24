"use client";

import { Button } from "@/components/ui/button";
import type { AppLang } from "@/lib/lang";

/** Presets: label shown and string sent to `/api/lesson` (same language as UI). */
export const PRESET_CHIPS = [
  {
    en: "Explain uniform motion (MRU)",
    es: "Explica el MRU (movimiento rectilíneo uniforme)",
  },
  {
    en: "Speed vs velocity?",
    es: "¿Rapidez y velocidad son lo mismo?",
  },
  {
    en: "Position–time graph of a car at constant speed",
    es: "Gráfica posición–tiempo de un auto a velocidad constante",
  },
  {
    en: "Are speed and velocity the same?",
    es: "¿La misma rapidez significa la misma velocidad?",
  },
  {
    en: "What is uniformly accelerated motion?",
    es: "¿Qué es el movimiento uniformemente acelerado (MRUA)?",
  },
  {
    en: "Explain free fall",
    es: "Explica la caída libre",
  },
] as const;

/** @deprecated Use PRESET_CHIPS and lang */
export const PRESET_QUESTIONS = PRESET_CHIPS.map((c) => c.en);

export function QuestionChips({
  lang,
  onSelect,
  disabled,
}: {
  lang: AppLang;
  onSelect: (q: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {PRESET_CHIPS.map((chip) => {
        const label = chip[lang];
        return (
          <Button
            key={label}
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => onSelect(label)}
            className="h-auto min-h-7 max-w-full whitespace-normal rounded-full px-3 py-1 text-left text-xs font-normal leading-snug"
          >
            {label}
          </Button>
        );
      })}
    </div>
  );
}
