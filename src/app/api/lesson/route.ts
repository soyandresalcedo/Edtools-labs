import { anthropic, MODEL } from "@/lib/anthropic";
import { runDemoMode } from "@/lib/demoMode";
import { ToolInputs, type ToolName, TOOLS } from "@/lib/tools";
import { SYSTEM_PROMPT } from "@/prompts/system";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Emit = (event: string, data: unknown) => void;

const isDemoMode = () => process.env.DEMO_MODE === "1";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as null | { question?: unknown };
  const question = typeof body?.question === "string" ? body.question : "";

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
          await runDemoMode(emit, question);
          controller.close();
          return;
        }

        if (!process.env.ANTHROPIC_API_KEY) {
          emit("error", {
            message:
              "ANTHROPIC_API_KEY no está configurada. Agrega tu key en .env.local para habilitar /api/lesson.",
          });
          controller.close();
          return;
        }

        const response = anthropic.messages.stream({
          model: MODEL,
          max_tokens: 2000,
          system: SYSTEM_PROMPT,
          tools: TOOLS,
          messages: [{ role: "user", content: question || "¿Qué es la velocidad?" }],
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

