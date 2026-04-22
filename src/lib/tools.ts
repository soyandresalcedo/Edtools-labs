import { z } from "zod";
import type { Tool } from "@anthropic-ai/sdk/resources/messages";

export const VectorKind = z.enum([
  "velocity",
  "acceleration",
  "force",
  "displacement",
  "generic",
]);

export const LineStyle = z.enum(["solid", "dashed"]);

export const ToolInputs = {
  clear_canvas: z.object({}).strict(),

  /** Speech variant: one short caption before each 1–3 drawing steps (syncs with diagrams; Day 5 = TTS). */
  speak: z
    .object({
      text: z.string().min(10).max(280),
    })
    .strict(),

  draw_circle: z
    .object({
      x: z.number().int(),
      y: z.number().int(),
      r: z.number().int().positive(),
      label: z.string().optional(),
      color: z.string().optional(),
    })
    .strict(),

  draw_rect: z
    .object({
      x: z.number().int(),
      y: z.number().int(),
      w: z.number().int().positive(),
      h: z.number().int().positive(),
      label: z.string().optional(),
    })
    .strict(),

  draw_line: z
    .object({
      from: z.tuple([z.number().int(), z.number().int()]),
      to: z.tuple([z.number().int(), z.number().int()]),
      style: LineStyle.default("solid"),
    })
    .strict(),

  draw_arrow: z
    .object({
      from: z.tuple([z.number().int(), z.number().int()]),
      to: z.tuple([z.number().int(), z.number().int()]),
      kind: VectorKind,
      label: z.string().optional(),
    })
    .strict(),

  draw_text: z
    .object({
      x: z.number().int(),
      y: z.number().int(),
      text: z.string(),
      size: z.number().int().positive().default(18),
    })
    .strict(),
};

export type ToolName = keyof typeof ToolInputs;

export const TOOLS: Tool[] = [
  {
    name: "clear_canvas",
    description: "Clear the canvas. Call at the very start of every new lesson.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "speak",
    description:
      "Say ONE short sentence in Latin American Spanish (10–280 chars). Use BEFORE each group of 1–3 drawing tools to preview or summarize what the student will see next. Never use for long prose—only step captions. Alternate speak and draw throughout the lesson.",
    input_schema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description:
            "Single short sentence, Latin American Spanish, 10–280 characters. No LaTeX.",
        },
      },
      required: ["text"],
    },
  },
  {
    name: "draw_circle",
    description:
      "Draw a circle. Use for balls, particles, masses. Integer coordinates on an 800x600 canvas.",
    input_schema: {
      type: "object",
      properties: {
        x: { type: "integer", description: "Center x in pixels (0-800)" },
        y: { type: "integer", description: "Center y in pixels (0-600)" },
        r: { type: "integer", description: "Radius in pixels (typically 10-40)" },
        label: { type: "string", description: "Short label near the circle" },
        color: { type: "string", description: "Hex color like '#ef4444'" },
      },
      required: ["x", "y", "r"],
    },
  },
  {
    name: "draw_rect",
    description: "Draw a rectangle. Use for blocks, floor segments, boxed regions.",
    input_schema: {
      type: "object",
      properties: {
        x: { type: "integer" },
        y: { type: "integer" },
        w: { type: "integer" },
        h: { type: "integer" },
        label: { type: "string" },
      },
      required: ["x", "y", "w", "h"],
    },
  },
  {
    name: "draw_line",
    description:
      "Draw a line (no arrowhead). Use for axes, ground, construction guides, trajectories with style='dashed'.",
    input_schema: {
      type: "object",
      properties: {
        from: { type: "array", items: { type: "integer" }, minItems: 2, maxItems: 2 },
        to: { type: "array", items: { type: "integer" }, minItems: 2, maxItems: 2 },
        style: { type: "string", enum: ["solid", "dashed"], default: "solid" },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "draw_arrow",
    description:
      "Draw an arrow (vector). ALWAYS set 'kind' so the color matches the physics quantity: velocity=blue, acceleration=red, force=green, displacement=purple, generic=gray.",
    input_schema: {
      type: "object",
      properties: {
        from: { type: "array", items: { type: "integer" }, minItems: 2, maxItems: 2 },
        to: { type: "array", items: { type: "integer" }, minItems: 2, maxItems: 2 },
        kind: {
          type: "string",
          enum: ["velocity", "acceleration", "force", "displacement", "generic"],
        },
        label: { type: "string", description: "Short label like 'v₀', 'a', 'g'" },
      },
      required: ["from", "to", "kind"],
    },
  },
  {
    name: "draw_text",
    description:
      "Draw a short text label. Keep labels short (<25 chars). Use Unicode subscripts/Greek (v₀, θ, Δ).",
    input_schema: {
      type: "object",
      properties: {
        x: { type: "integer" },
        y: { type: "integer" },
        text: { type: "string" },
        size: { type: "integer", default: 18 },
      },
      required: ["x", "y", "text"],
    },
  },
];

