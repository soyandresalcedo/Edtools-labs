import type { ToolName } from "@/lib/tools";

/**
 * One completed turn of the tutor conversation. Sent from the client to
 * /api/lesson so Claude can keep multi-turn context (topic, drawings already
 * on the canvas, last spoken caption) across questions.
 *
 * `assistantToolUses` mirrors what the model emitted last turn: every entry
 * keeps the tool name, the validated input (already passed by zod on the
 * server), and the original `id` so the request can be reconstructed as
 * proper Anthropic `tool_use` blocks paired with `tool_result` blocks.
 */
export type SessionToolUse = {
  id: string;
  name: ToolName;
  input: unknown;
};

export type SessionTurn = {
  userText: string;
  assistantToolUses: SessionToolUse[];
};

export const MAX_HISTORY_TURNS = 6;
