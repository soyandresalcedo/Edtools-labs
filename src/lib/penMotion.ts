import type { Point } from "@/lib/sceneToViewport";
import type { ToolName } from "@/lib/tools";
import type { PenColor, PenState } from "@/components/agent/PenCursor";

export type PenSetter = (state: PenState) => void;

function colorForTool(name: ToolName, input: any): PenColor {
  if (name === "draw_arrow") {
    switch (input?.kind) {
      case "velocity":
        return "velocity";
      case "acceleration":
        return "acceleration";
      case "force":
        return "force";
      case "displacement":
        return "displacement";
      default:
        return "neutral";
    }
  }
  return "neutral";
}

/** Ordered list of scene points the pen should visit to trace the shape. */
export function shapeAnchors(name: ToolName, input: any): Point[] {
  switch (name) {
    case "draw_circle": {
      const { x, y, r } = input;
      const steps = 18;
      const pts: Point[] = [];
      for (let i = 0; i <= steps; i++) {
        const theta = (i / steps) * Math.PI * 2 - Math.PI / 2;
        pts.push({ x: x + r * Math.cos(theta), y: y + r * Math.sin(theta) });
      }
      return pts;
    }
    case "draw_rect": {
      const { x, y, w, h } = input;
      return [
        { x, y },
        { x: x + w, y },
        { x: x + w, y: y + h },
        { x, y: y + h },
        { x, y },
      ];
    }
    case "draw_line":
    case "draw_arrow": {
      const { from, to } = input;
      return [
        { x: from[0], y: from[1] },
        { x: to[0], y: to[1] },
      ];
    }
    default:
      return [];
  }
}

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

async function animatePath({
  path,
  duration,
  color,
  phase,
  setPen,
  signal,
}: {
  path: Point[];
  duration: number;
  color: PenColor;
  phase: "approach" | "writing";
  setPen: PenSetter;
  signal?: AbortSignal;
}) {
  if (path.length < 2) return;
  const totalLen = path.reduce((acc, p, i) => {
    if (i === 0) return 0;
    const prev = path[i - 1];
    return acc + Math.hypot(p.x - prev.x, p.y - prev.y);
  }, 0);
  if (totalLen === 0) {
    setPen({
      point: path[path.length - 1],
      color,
      phase: "rest",
      visible: true,
    });
    return;
  }

  const fps = 60;
  const frames = Math.max(6, Math.round((duration / 1000) * fps));
  const start = performance.now();

  function pointAt(t: number): Point {
    const eased = easeOutCubic(Math.min(1, Math.max(0, t)));
    const targetLen = eased * totalLen;
    let walked = 0;
    for (let i = 1; i < path.length; i++) {
      const prev = path[i - 1];
      const cur = path[i];
      const seg = Math.hypot(cur.x - prev.x, cur.y - prev.y);
      if (walked + seg >= targetLen || i === path.length - 1) {
        const ratio = seg === 0 ? 1 : (targetLen - walked) / seg;
        return {
          x: prev.x + (cur.x - prev.x) * ratio,
          y: prev.y + (cur.y - prev.y) * ratio,
        };
      }
      walked += seg;
    }
    return path[path.length - 1];
  }

  for (let i = 1; i <= frames; i++) {
    if (signal?.aborted) return;
    const elapsed = performance.now() - start;
    const t = Math.min(1, elapsed / duration);
    setPen({ point: pointAt(t), color, phase, visible: true });
    await new Promise((r) => setTimeout(r, 1000 / fps));
    if (t >= 1) break;
  }

  setPen({
    point: path[path.length - 1],
    color,
    phase,
    visible: true,
  });
}

/**
 * Trace a single drawing tool with the pen: glide approach + write path.
 * Only for shape tools (circle/rect/line/arrow). Returns the resting point.
 */
export async function tracePenForShape({
  name,
  input,
  current,
  setPen,
  signal,
}: {
  name: ToolName;
  input: any;
  current: Point;
  setPen: PenSetter;
  signal?: AbortSignal;
}): Promise<Point> {
  const anchors = shapeAnchors(name, input);
  if (anchors.length === 0) return current;
  const color = colorForTool(name, input);

  await animatePath({
    path: [current, anchors[0]],
    duration: 280,
    color: "neutral",
    phase: "approach",
    setPen,
    signal,
  });
  if (signal?.aborted) return anchors[0];

  if (anchors.length >= 2) {
    const traceDuration = Math.min(
      1000,
      Math.max(260, anchors.length * 55 + 180),
    );
    await animatePath({
      path: anchors,
      duration: traceDuration,
      color,
      phase: "writing",
      setPen,
      signal,
    });
  }

  setPen({
    point: anchors[anchors.length - 1],
    color,
    phase: "rest",
    visible: true,
  });
  return anchors[anchors.length - 1];
}

/** Slide the pen from `current` to `to` without writing. */
export async function glidePen({
  from,
  to,
  setPen,
  signal,
  duration = 260,
}: {
  from: Point;
  to: Point;
  setPen: PenSetter;
  signal?: AbortSignal;
  duration?: number;
}): Promise<Point> {
  await animatePath({
    path: [from, to],
    duration,
    color: "neutral",
    phase: "approach",
    setPen,
    signal,
  });
  return to;
}

export const DEFAULT_PEN_REST: Point = { x: 400, y: 300 };
