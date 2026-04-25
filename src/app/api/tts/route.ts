import type { AppLang } from "@/lib/lang";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TEXT = 4000;
const ELEVEN_BASE = "https://api.elevenlabs.io/v1/text-to-speech";
const DEFAULT_MODEL = "eleven_multilingual_v2";

function badRequest(message: string, field?: string): Response {
  return new Response(JSON.stringify({ error: message, field }), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });
}

function parseLang(v: unknown): AppLang {
  return v === "es" ? "es" : "en";
}

function pickVoiceId(lang: AppLang, override?: string): string | null {
  if (override && typeof override === "string" && override.length > 0) {
    return override;
  }
  const env = process.env;
  if (lang === "es") {
    return (
      env.ELEVENLABS_VOICE_ID_ES ?? env.ELEVENLABS_VOICE_ID ?? null
    );
  }
  return env.ELEVENLABS_VOICE_ID_EN ?? env.ELEVENLABS_VOICE_ID ?? null;
}

/**
 * Health probe ligero: el cliente lo usa para saber si el motor ElevenLabs es
 * elegible sin gastar caracteres. No expone la API key.
 */
export async function GET(): Promise<Response> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const hasEn = !!(
    process.env.ELEVENLABS_VOICE_ID_EN ?? process.env.ELEVENLABS_VOICE_ID
  );
  const hasEs = !!(
    process.env.ELEVENLABS_VOICE_ID_ES ?? process.env.ELEVENLABS_VOICE_ID
  );
  const ok = !!apiKey && (hasEn || hasEs);
  return new Response(
    JSON.stringify({
      ok,
      voices: { en: hasEn, es: hasEs },
      model: process.env.ELEVENLABS_MODEL ?? DEFAULT_MODEL,
    }),
    {
      status: ok ? 200 : 503,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    },
  );
}

export async function POST(req: Request): Promise<Response> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "ELEVENLABS_API_KEY is not configured" }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body");
  }
  if (body === null || typeof body !== "object") {
    return badRequest("Body must be a JSON object");
  }
  const b = body as { text?: unknown; lang?: unknown; voiceId?: unknown };

  if (typeof b.text !== "string" || b.text.trim().length === 0) {
    return badRequest("text is required", "text");
  }
  if (b.text.length > MAX_TEXT) {
    return badRequest("text exceeds maximum length", "text");
  }
  if (b.voiceId !== undefined && b.voiceId !== null && typeof b.voiceId !== "string") {
    return badRequest("voiceId must be a string", "voiceId");
  }

  const lang = parseLang(b.lang);
  const voiceId = pickVoiceId(
    lang,
    typeof b.voiceId === "string" ? b.voiceId : undefined,
  );
  if (!voiceId) {
    return new Response(
      JSON.stringify({
        error: `No ElevenLabs voice configured for lang=${lang}. Set ELEVENLABS_VOICE_ID_${lang.toUpperCase()} or ELEVENLABS_VOICE_ID.`,
      }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
  }

  const model = process.env.ELEVENLABS_MODEL ?? DEFAULT_MODEL;
  const url = `${ELEVEN_BASE}/${encodeURIComponent(voiceId)}/stream?optimize_streaming_latency=2&output_format=mp3_44100_128`;

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: b.text,
        model_id: model,
        // ElevenLabs aplica detección de idioma automática en multilingual v2;
        // pasamos `language_code` como pista cuando hay coincidencia clara.
        language_code: lang,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0,
          use_speaker_boost: true,
        },
      }),
    });
  } catch (e) {
    return new Response(
      JSON.stringify({
        error: "Upstream fetch failed",
        detail: e instanceof Error ? e.message : String(e),
      }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    return new Response(
      JSON.stringify({
        error: `ElevenLabs ${upstream.status}`,
        detail: detail.slice(0, 500),
      }),
      {
        status: upstream.status === 401 ? 503 : 502,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store",
      "X-TTS-Engine": "elevenlabs",
      "X-TTS-Lang": lang,
    },
  });
}
