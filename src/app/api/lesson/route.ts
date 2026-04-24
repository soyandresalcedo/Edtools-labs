import { anthropic, MODEL } from "@/lib/anthropic";
import { runDemoMode } from "@/lib/demoMode";
import { ToolInputs, type ToolName, TOOLS } from "@/lib/tools";
import { buildSystemPrompt } from "@/prompts/system";
import { buildLabSystemPrompt } from "@/prompts/lab";
import type { AppLang } from "@/lib/lang";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Emit = (event: string, data: unknown) => void;

const isDemoMode = () => process.env.DEMO_MODE === "1";

const MAX_QUESTION = 2000;
const MAX_HANDOFF = 4000;
const MAX_SENSOR = 1200;
const MAX_PREDICTION = 500;
const MAX_PROGRESS = 800;

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

        const response = anthropic.messages.stream({
          model: MODEL,
          max_tokens: 2000,
          system,
          tools: TOOLS,
          messages: [{ role: "user", content: userMessageParts.join("") }],
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
