import { anthropic, MODEL } from "@/lib/anthropic";
import { runDemoMode } from "@/lib/demoMode";
import { ToolInputs, type ToolName, TOOLS } from "@/lib/tools";
import { buildSystemPrompt } from "@/prompts/system";
import { buildLabSystemPrompt } from "@/prompts/lab";
import type { AppLang } from "@/lib/lang";
import {
  MAX_HISTORY_TURNS,
  type SessionToolUse,
  type SessionTurn,
} from "@/lib/sessionTypes";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Emit = (event: string, data: unknown) => void;

const isDemoMode = () => process.env.DEMO_MODE === "1";

const MAX_QUESTION = 2000;
const MAX_HANDOFF = 4000;
const MAX_SENSOR = 1200;
const MAX_PREDICTION = 500;
const MAX_PROGRESS = 800;
const MAX_HISTORY_USER_TEXT = 4000;
const MAX_TOOL_USES_PER_TURN = 16;
const TOOL_NAMES = new Set<ToolName>(
  Object.keys(ToolInputs) as ToolName[],
);

/**
 * Validate the optional `history` field. Returns `null` when absent/empty,
 * a `SessionTurn[]` when valid, or a string error to bubble up as 400.
 *
 * We intentionally accept any unknown shape (the cliente may evolve) and
 * defensively reshape it. Any tool whose name we don't recognize is dropped
 * from the turn rather than failing the whole request.
 */
function parseHistory(raw: unknown): SessionTurn[] | string | null {
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw)) return "history must be an array";
  if (raw.length === 0) return null;
  if (raw.length > MAX_HISTORY_TURNS + 4) {
    return `history exceeds ${MAX_HISTORY_TURNS + 4} turns`;
  }

  const out: SessionTurn[] = [];
  for (let i = 0; i < raw.length; i++) {
    const t = raw[i];
    if (t === null || typeof t !== "object") {
      return `history[${i}] must be an object`;
    }
    const turn = t as { userText?: unknown; assistantToolUses?: unknown };
    if (typeof turn.userText !== "string") {
      return `history[${i}].userText must be a string`;
    }
    if (turn.userText.length > MAX_HISTORY_USER_TEXT) {
      return `history[${i}].userText exceeds maximum length`;
    }
    if (!Array.isArray(turn.assistantToolUses)) {
      return `history[${i}].assistantToolUses must be an array`;
    }
    if (turn.assistantToolUses.length > MAX_TOOL_USES_PER_TURN) {
      return `history[${i}].assistantToolUses exceeds ${MAX_TOOL_USES_PER_TURN} entries`;
    }

    const uses: SessionToolUse[] = [];
    for (let j = 0; j < turn.assistantToolUses.length; j++) {
      const u = turn.assistantToolUses[j];
      if (u === null || typeof u !== "object") continue;
      const use = u as { id?: unknown; name?: unknown; input?: unknown };
      if (typeof use.id !== "string" || use.id.length === 0) continue;
      if (typeof use.name !== "string") continue;
      if (!TOOL_NAMES.has(use.name as ToolName)) continue;

      const schema = ToolInputs[use.name as ToolName];
      const parsed = schema?.safeParse(use.input ?? {});
      if (!parsed?.success) continue;

      uses.push({
        id: use.id.slice(0, 64),
        name: use.name as ToolName,
        input: parsed.data,
      });
    }

    out.push({ userText: turn.userText, assistantToolUses: uses });
  }

  return out.slice(-MAX_HISTORY_TURNS);
}

/**
 * Build the Anthropic `messages` array from prior turns + the current user
 * input. Each prior turn is a `user` message (the question) followed by an
 * `assistant` message (with the validated `tool_use` blocks the model
 * emitted) and a `user` message containing one `tool_result` per `tool_use`
 * — Anthropic's tool API requires a result for every tool call.
 *
 * Tool results carry a short string summarizing the side effect (rather
 * than the literal "ok") so the model has a tiny anchor about what each
 * call actually did to the canvas / caption stream.
 */
function buildMessages(
  history: SessionTurn[],
  currentUserContent: string,
): MessageParam[] {
  const messages: MessageParam[] = [];
  for (const turn of history) {
    messages.push({ role: "user", content: turn.userText });

    if (turn.assistantToolUses.length > 0) {
      messages.push({
        role: "assistant",
        content: turn.assistantToolUses.map((u) => ({
          type: "tool_use" as const,
          id: u.id,
          name: u.name,
          input: (u.input ?? {}) as Record<string, unknown>,
        })),
      });
      messages.push({
        role: "user",
        content: turn.assistantToolUses.map((u) => ({
          type: "tool_result" as const,
          tool_use_id: u.id,
          content: toolResultSummary(u.name),
        })),
      });
    }
  }
  messages.push({ role: "user", content: currentUserContent });
  return messages;
}

function toolResultSummary(name: ToolName): string {
  switch (name) {
    case "clear_canvas":
      return "canvas cleared";
    case "speak":
      return "caption rendered to the student";
    case "suggest_lab":
      return "lab card shown in chat";
    case "draw_circle":
    case "draw_rect":
    case "draw_line":
    case "draw_arrow":
    case "draw_text":
      return "drawn on canvas";
    default:
      return "ok";
  }
}

const badRequest = (obj: { error: string; field?: string }) =>
  new Response(JSON.stringify(obj), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });

function parseLang(v: unknown): AppLang {
  if (v === "es") return "es";
  return "en";
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest({ error: "Invalid JSON body" });
  }
  if (body === null || typeof body !== "object") {
    return badRequest({ error: "Body must be a JSON object" });
  }
  const b = body as {
    question?: unknown;
    mode?: unknown;
    handoffContext?: unknown;
    sensorSummary?: unknown;
    lang?: unknown;
    predictionChoice?: unknown;
    labProgressSummary?: unknown;
    history?: unknown;
  };
  if (b.question !== undefined && b.question !== null && typeof b.question !== "string") {
    return badRequest({ error: "question must be a string", field: "question" });
  }
  if (
    b.handoffContext !== undefined &&
    b.handoffContext !== null &&
    typeof b.handoffContext !== "string"
  ) {
    return badRequest({
      error: "handoffContext must be a string",
      field: "handoffContext",
    });
  }
  if (
    b.sensorSummary !== undefined &&
    b.sensorSummary !== null &&
    typeof b.sensorSummary !== "string"
  ) {
    return badRequest({
      error: "sensorSummary must be a string",
      field: "sensorSummary",
    });
  }
  if (
    b.predictionChoice !== undefined &&
    b.predictionChoice !== null &&
    typeof b.predictionChoice !== "string"
  ) {
    return badRequest({
      error: "predictionChoice must be a string",
      field: "predictionChoice",
    });
  }
  if (
    b.labProgressSummary !== undefined &&
    b.labProgressSummary !== null &&
    typeof b.labProgressSummary !== "string"
  ) {
    return badRequest({
      error: "labProgressSummary must be a string",
      field: "labProgressSummary",
    });
  }
  if (b.mode !== undefined && b.mode !== null && b.mode !== "teach" && b.mode !== "lab") {
    return badRequest({ error: "mode must be teach or lab", field: "mode" });
  }

  const question = typeof b.question === "string" ? b.question : "";
  const mode = b.mode === "lab" ? "lab" : "teach";
  const handoffContext = typeof b.handoffContext === "string" ? b.handoffContext : "";
  const sensorSummary = typeof b.sensorSummary === "string" ? b.sensorSummary : "";
  const lang = parseLang(b.lang);
  const predictionChoice =
    typeof b.predictionChoice === "string" ? b.predictionChoice : "";
  const labProgressSummary =
    typeof b.labProgressSummary === "string" ? b.labProgressSummary : "";

  if (question.length > MAX_QUESTION) {
    return badRequest({ error: "question exceeds maximum length", field: "question" });
  }
  if (handoffContext.length > MAX_HANDOFF) {
    return badRequest({ error: "handoffContext exceeds maximum length", field: "handoffContext" });
  }
  if (sensorSummary.length > MAX_SENSOR) {
    return badRequest({ error: "sensorSummary exceeds maximum length", field: "sensorSummary" });
  }
  if (predictionChoice.length > MAX_PREDICTION) {
    return badRequest({ error: "predictionChoice exceeds maximum length", field: "predictionChoice" });
  }
  if (labProgressSummary.length > MAX_PROGRESS) {
    return badRequest({ error: "labProgressSummary exceeds maximum length", field: "labProgressSummary" });
  }

  const parsedHistory = parseHistory(b.history);
  if (typeof parsedHistory === "string") {
    return badRequest({ error: parsedHistory, field: "history" });
  }
  const history: SessionTurn[] = parsedHistory ?? [];

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const emit: Emit = (event, data) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };

      try {
        if (isDemoMode()) {
          await runDemoMode(emit, question, lang);
          controller.close();
          return;
        }

        if (!process.env.ANTHROPIC_API_KEY) {
          emit("error", {
            message:
              "ANTHROPIC_API_KEY is not configured. Add your key to .env.local to enable /api/lesson.",
          });
          controller.close();
          return;
        }

        const system =
          mode === "lab" ? buildLabSystemPrompt(lang) : buildSystemPrompt(lang);
        const userMessageParts = [
          labProgressSummary
            ? `studentLabProgress (topic → completions):\n${labProgressSummary}\n`
            : "",
          question || "What is velocity?",
          handoffContext ? `\n\nhandoffContext:\n${handoffContext}` : "",
          sensorSummary ? `\n\nsensorSummary:\n${sensorSummary}` : "",
          predictionChoice ? `\n\npredictionChoice:\n${predictionChoice}` : "",
        ].filter(Boolean);

        // El cliente envía hasta MAX_HISTORY_TURNS turnos; los reconstruimos
        // como user / assistant(tool_use) / user(tool_result) tríos para que
        // Claude vea su propia choreography previa y mantenga el tema.
        const messages = buildMessages(history, userMessageParts.join(""));

        const response = anthropic.messages.stream({
          model: MODEL,
          max_tokens: 2000,
          system,
          tools: TOOLS,
          messages,
        });

        const pendingInputs = new Map<number, string>();
        const pendingNames = new Map<number, string>();

        for await (const ev of response) {
          if (ev.type === "content_block_start") {
            if (ev.content_block.type === "tool_use") {
              pendingNames.set(ev.index, ev.content_block.name);
              pendingInputs.set(ev.index, "");
            }
          } else if (ev.type === "content_block_delta") {
            if (ev.delta.type === "input_json_delta") {
              const prev = pendingInputs.get(ev.index) ?? "";
              pendingInputs.set(ev.index, prev + ev.delta.partial_json);
            } else if (ev.delta.type === "text_delta") {
              console.warn("[lesson] stray text_delta (ignored for UI)", ev.delta.text);
            }
          } else if (ev.type === "content_block_stop") {
            const name = pendingNames.get(ev.index);
            const rawInput = pendingInputs.get(ev.index);

            if (name && rawInput !== undefined) {
              let parsed: unknown;
              try {
                parsed = JSON.parse(rawInput || "{}");
              } catch {
                emit("tool_error", { name, raw: rawInput, error: "invalid_json" });
                continue;
              }

              const schema = ToolInputs[name as ToolName];
              const validated = schema?.safeParse(parsed);

              if (!validated?.success) {
                emit("tool_error", {
                  name,
                  input: parsed,
                  error: validated?.error?.toString?.() ?? "invalid_input",
                });
              } else {
                emit("tool_call", { name, input: validated.data });
              }
            }
          }
        }

        emit("done", { ok: true });
        controller.close();
      } catch (err) {
        console.error("[lesson] error", err);
        emit("error", { message: String(err) });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
