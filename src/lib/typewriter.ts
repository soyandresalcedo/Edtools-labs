import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { Point } from "@/lib/sceneToViewport";
import type { PenColor, PenState } from "@/components/agent/PenCursor";
import { buildElementsFromSkeletons } from "@/lib/excalidrawOps";

export type TextSkeleton = {
  type: "text";
  x: number;
  y: number;
  text: string;
  fontSize?: number;
  strokeColor?: string;
};

type Setter = (state: PenState) => void;

/**
 * Approximate char width based on Excalidraw's default hand-drawn font.
 * Good enough to keep the pen above the last letter; we don't need perfect metrics.
 */
function estCharAdvance(fontSize: number) {
  return fontSize * 0.55;
}

/**
 * Typewrite a text element into the scene, character by character.
 * Moves the pen to follow the caret and updates the scene incrementally.
 *
 * Returns the resting pen position (after the last char) and the final
 * array of elements appended to the scene (typically just one text element).
 */
export async function typewriteText({
  skeleton,
  api,
  scene,
  penFrom,
  penColor,
  setPen,
  signal,
  charDelayMs = 45,
}: {
  skeleton: TextSkeleton;
  api: ExcalidrawImperativeAPI | null;
  scene: any[];
  penFrom: Point;
  penColor: PenColor;
  setPen: Setter;
  signal?: AbortSignal;
  charDelayMs?: number;
}): Promise<{ rest: Point; appended: any[] }> {
  const fullText = String(skeleton.text ?? "");
  const fontSize = skeleton.fontSize ?? 18;

  if (fullText.length === 0 || !api) {
    return { rest: penFrom, appended: [] };
  }

  await glideToCaret({
    penFrom,
    target: { x: skeleton.x, y: skeleton.y + fontSize / 2 },
    setPen,
    signal,
  });
  if (signal?.aborted) return { rest: penFrom, appended: [] };

  let elementId: string | null = null;
  let lastIdx = -1;
  let lastCaret: Point = { x: skeleton.x, y: skeleton.y + fontSize / 2 };

  for (let i = 1; i <= fullText.length; i++) {
    if (signal?.aborted) return { rest: lastCaret, appended: scene.slice(-1) };

    const prefix = fullText.slice(0, i);
    const [newEl] = await buildElementsFromSkeletons([
      { ...skeleton, text: prefix },
    ]);

    if (!newEl) break;

    if (elementId === null) {
      elementId = newEl.id;
      scene.push(newEl);
      lastIdx = scene.length - 1;
    } else {
      newEl.id = elementId;
      if (lastIdx >= 0 && lastIdx < scene.length) {
        scene[lastIdx] = newEl;
      } else {
        const found = scene.findIndex((e: any) => e?.id === elementId);
        if (found >= 0) {
          scene[found] = newEl;
          lastIdx = found;
        }
      }
    }

    api.updateScene({ elements: [...scene] });

    const caret: Point = {
      x: skeleton.x + estCharAdvance(fontSize) * i,
      y: skeleton.y + fontSize / 2,
    };
    lastCaret = caret;
    setPen({
      point: caret,
      color: penColor,
      phase: "writing",
      visible: true,
    });

    await new Promise((r) => setTimeout(r, charDelayMs));
  }

  setPen({
    point: lastCaret,
    color: penColor,
    phase: "rest",
    visible: true,
  });

  const finalElement = lastIdx >= 0 ? scene[lastIdx] : null;
  return {
    rest: lastCaret,
    appended: finalElement ? [finalElement] : [],
  };
}

async function glideToCaret({
  penFrom,
  target,
  setPen,
  signal,
  duration = 260,
}: {
  penFrom: Point;
  target: Point;
  setPen: Setter;
  signal?: AbortSignal;
  duration?: number;
}) {
  const fps = 60;
  const frames = Math.max(6, Math.round((duration / 1000) * fps));
  const start = performance.now();
  const dist = Math.hypot(target.x - penFrom.x, target.y - penFrom.y);
  if (dist < 1) {
    setPen({
      point: target,
      color: "neutral",
      phase: "approach",
      visible: true,
    });
    return;
  }
  for (let i = 1; i <= frames; i++) {
    if (signal?.aborted) return;
    const elapsed = performance.now() - start;
    const t = Math.min(1, elapsed / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    setPen({
      point: {
        x: penFrom.x + (target.x - penFrom.x) * eased,
        y: penFrom.y + (target.y - penFrom.y) * eased,
      },
      color: "neutral",
      phase: "approach",
      visible: true,
    });
    await new Promise((r) => setTimeout(r, 1000 / fps));
    if (t >= 1) break;
  }
}
