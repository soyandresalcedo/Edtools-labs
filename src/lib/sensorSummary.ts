import type { TiltEvent } from "@/lib/useTiltEvents";

function dirLabel(
  d: TiltEvent["direction"],
  lang: "en" | "es",
): string {
  const en: Record<TiltEvent["direction"], string> = {
    right: "right",
    left: "left",
    forward: "forward",
    back: "back",
  };
  const es: Record<TiltEvent["direction"], string> = {
    right: "derecha",
    left: "izquierda",
    forward: "adelante",
    back: "atrás",
  };
  return lang === "es" ? es[d] : en[d];
}

function peakAngleDeg(e: TiltEvent): number {
  return Math.abs(e.maxGamma) >= Math.abs(e.maxBeta)
    ? Math.round(Math.abs(e.maxGamma))
    : Math.round(Math.abs(e.maxBeta));
}

/** Approximate average tilt rate during hold (°/s), from peak angle / duration. */
function approxRateDegPerS(e: TiltEvent): number {
  const sec = Math.max(e.holdMs / 1000, 0.001);
  const peak = peakAngleDeg(e);
  return Math.round(peak / sec);
}

/** Symmetry score 0–1 for last two events (similar peak angles, opposite dirs). */
function symmetryPair(events: TiltEvent[]): number | null {
  if (events.length < 2) return null;
  const a = events[events.length - 2]!;
  const b = events[events.length - 1]!;
  const ga = peakAngleDeg(a);
  const gb = peakAngleDeg(b);
  if (!ga || !gb) return null;
  const ratio = Math.min(ga, gb) / Math.max(ga, gb);
  const opposite =
    (a.direction === "right" && b.direction === "left") ||
    (a.direction === "left" && b.direction === "right") ||
    (a.direction === "forward" && b.direction === "back") ||
    (a.direction === "back" && b.direction === "forward");
  return opposite ? Math.round(ratio * 100) / 100 : null;
}

/**
 * Human + model friendly summary with derived quantities.
 */
export function buildSensorSummary(events: TiltEvent[], lang: "en" | "es"): string {
  const parts = events.map((e) => {
    const deg = peakAngleDeg(e);
    const rate = approxRateDegPerS(e);
    return `${dirLabel(e.direction, lang)} peak~${deg}° hold=${e.holdMs}ms ~${rate}°/s`;
  });
  const chain = parts.join(lang === "es" ? " → " : " -> ");
  const sym = symmetryPair(events);
  const symStr =
    sym == null
      ? ""
      : lang === "es"
        ? ` simetría_ida_vuelta=${sym}`
        : ` out_back_symmetry=${sym}`;
  return `${chain}${symStr}`;
}
