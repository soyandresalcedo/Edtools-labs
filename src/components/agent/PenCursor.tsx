"use client";

import { cn } from "@/lib/utils";
import {
  sceneToViewport,
  type Point,
  type ViewportAppState,
} from "@/lib/sceneToViewport";

export type PenPhase = "approach" | "writing" | "rest";
export type PenColor =
  | "neutral"
  | "velocity"
  | "acceleration"
  | "force"
  | "displacement";

const COLOR_MAP: Record<PenColor, { body: string; tip: string; shadow: string }> = {
  neutral: { body: "#0f172a", tip: "#1e293b", shadow: "#94a3b8" },
  velocity: { body: "#1e40af", tip: "#2563eb", shadow: "#93c5fd" },
  acceleration: { body: "#991b1b", tip: "#dc2626", shadow: "#fca5a5" },
  force: { body: "#166534", tip: "#16a34a", shadow: "#86efac" },
  displacement: { body: "#5b21b6", tip: "#7c3aed", shadow: "#c4b5fd" },
};

export type PenState = {
  point: Point;
  color: PenColor;
  phase: PenPhase;
  visible: boolean;
};

export function PenCursor({
  state,
  appState,
}: {
  state: PenState;
  appState: ViewportAppState;
}) {
  const vp = sceneToViewport(state.point, appState);
  const writing = state.phase === "writing";
  const colors = COLOR_MAP[state.color];

  const tiltDeg = writing ? -28 : -36;
  const scale = writing ? 1 : 0.94;

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute left-0 top-0 z-30"
      style={{
        transform: `translate3d(${vp.x}px, ${vp.y}px, 0)`,
        opacity: state.visible ? 1 : 0,
        transition:
          "transform 55ms linear, opacity 180ms ease-out",
        willChange: "transform, opacity",
      }}
    >
      <div
        className={cn(
          "pointer-events-none",
          writing && "animate-agent-pulse",
        )}
        style={{
          transform: `translate(-6px, -46px) rotate(${tiltDeg}deg) scale(${scale})`,
          transformOrigin: "6px 46px",
          transition:
            "transform 140ms cubic-bezier(.2,.8,.2,1)",
        }}
      >
        <PencilSVG colors={colors} />
      </div>

      {writing ? (
        <span
          aria-hidden
          className="absolute block rounded-full"
          style={{
            left: -4,
            top: -4,
            width: 8,
            height: 8,
            background: colors.shadow,
            opacity: 0.55,
            filter: "blur(2px)",
          }}
        />
      ) : null}
    </div>
  );
}

function PencilSVG({ colors }: { colors: { body: string; tip: string; shadow: string } }) {
  return (
    <svg
      width="40"
      height="52"
      viewBox="0 0 40 52"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ filter: "drop-shadow(0 2px 3px rgba(15,23,42,0.25))" }}
    >
      <defs>
        <linearGradient id="pencil-wood" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#fde68a" />
          <stop offset="100%" stopColor="#f59e0b" />
        </linearGradient>
      </defs>
      {/* Eraser cap */}
      <rect x="12" y="2" width="16" height="6" rx="2" fill="#f472b6" />
      <rect x="12" y="7" width="16" height="2" rx="1" fill="#be185d" />
      {/* Metal ferrule */}
      <rect x="11" y="9" width="18" height="5" rx="1" fill="#94a3b8" />
      <rect x="11" y="11" width="18" height="1" fill="#64748b" />
      {/* Wooden body */}
      <rect x="12" y="14" width="16" height="26" fill="url(#pencil-wood)" />
      {/* Body stroke accent */}
      <rect x="19" y="14" width="2" height="26" fill={colors.body} opacity="0.35" />
      {/* Wood tip */}
      <polygon points="12,40 28,40 20,48" fill="#fef3c7" />
      {/* Lead tip */}
      <polygon points="17,44 23,44 20,50" fill={colors.tip} />
    </svg>
  );
}

export const DEFAULT_PEN_STATE: PenState = {
  point: { x: 400, y: 300 },
  color: "neutral",
  phase: "rest",
  visible: false,
};
