import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import type { ToolName } from "./tools";

const VECTOR_COLORS: Record<string, string> = {
  velocity: "#2563eb",
  acceleration: "#dc2626",
  force: "#16a34a",
  displacement: "#7c3aed",
  generic: "#334155",
};

export function toolCallToSkeletons(name: ToolName, input: any): any[] {
  switch (name) {
    case "clear_canvas":
      return [];

    case "draw_circle": {
      const { x, y, r, label, color } = input;
      const base = {
        type: "ellipse" as const,
        x: x - r,
        y: y - r,
        width: r * 2,
        height: r * 2,
        strokeColor: color ?? "#1e293b",
        backgroundColor: "transparent",
        roughness: 1,
        strokeWidth: 2,
      };
      if (!label) return [base];
      return [
        base,
        {
          type: "text" as const,
          x: x + r + 8,
          y: y - 10,
          text: label,
          fontSize: 16,
          strokeColor: "#1e293b",
        },
      ];
    }

    case "draw_rect": {
      const { x, y, w, h, label } = input;
      const base = {
        type: "rectangle" as const,
        x,
        y,
        width: w,
        height: h,
        strokeColor: "#1e293b",
        backgroundColor: "transparent",
        roughness: 1,
        strokeWidth: 2,
      };
      if (!label) return [base];
      return [
        base,
        {
          type: "text" as const,
          x: x + 4,
          y: y - 20,
          text: label,
          fontSize: 16,
          strokeColor: "#1e293b",
        },
      ];
    }

    case "draw_line": {
      const { from, to, style } = input;
      return [
        {
          type: "line" as const,
          x: from[0],
          y: from[1],
          width: to[0] - from[0],
          height: to[1] - from[1],
          points: [
            [0, 0],
            [to[0] - from[0], to[1] - from[1]],
          ],
          strokeColor: "#334155",
          strokeWidth: 2,
          roughness: 1,
          strokeStyle: style === "dashed" ? "dashed" : "solid",
        },
      ];
    }

    case "draw_arrow": {
      const { from, to, kind, label } = input;
      const color = VECTOR_COLORS[kind] ?? VECTOR_COLORS.generic;
      const arrow = {
        type: "arrow" as const,
        x: from[0],
        y: from[1],
        width: to[0] - from[0],
        height: to[1] - from[1],
        points: [
          [0, 0],
          [to[0] - from[0], to[1] - from[1]],
        ],
        strokeColor: color,
        strokeWidth: 2,
        roughness: 1,
      };
      if (!label) return [arrow];
      const mid = { x: (from[0] + to[0]) / 2, y: (from[1] + to[1]) / 2 };
      return [
        arrow,
        {
          type: "text" as const,
          x: mid.x + 8,
          y: mid.y - 20,
          text: label,
          fontSize: 16,
          strokeColor: color,
        },
      ];
    }

    case "draw_text": {
      const { x, y, text, size } = input;
      return [
        {
          type: "text" as const,
          x,
          y,
          text,
          fontSize: size ?? 18,
          strokeColor: "#1e293b",
        },
      ];
    }
  }
  return [];
}

export function buildElementsFromSkeletons(skeletons: any[]) {
  return convertToExcalidrawElements(skeletons);
}

