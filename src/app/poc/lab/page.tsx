"use client";

/**
 * PoC 2: "Lab handshake" (sensores → resumen → agente).
 *
 * Objetivo: demostrar el "cambio natural" Teach → Lab sin tocar el flujo real.
 * 1. El usuario activa motion (reutilizamos `useTiltEvents`).
 * 2. Una pequeña misión guiada ("inclina a la derecha y sostén") avanza al
 *    detectar el `TiltEvent` esperado.
 * 3. Cuando la misión se completa, se envía un "resumen" como `question` al
 *    endpoint existente `/api/lesson` (mismo contrato que el modo teach) y se
 *    consumen los eventos SSE quedándonos sólo con `speak` para validar la
 *    ida y vuelta.
 *
 * Se evita depender de `useSpeech` (Kokoro) para que la PoC sea ligera; voz
 * con `speechSynthesis` del navegador como opción opt-in.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useTiltEvents,
  type TiltDirection,
  type TiltEvent,
} from "@/lib/useTiltEvents";

type Mission = {
  id: string;
  direction: TiltDirection;
  prompt: string;
  hint: string;
};

const MISSIONS: Mission[] = [
  {
    id: "right",
    direction: "right",
    prompt: "Inclina el teléfono a la DERECHA",
    hint: "Mantén >15° por ~0.3 s",
  },
  {
    id: "left",
    direction: "left",
    prompt: "Ahora inclínalo a la IZQUIERDA",
    hint: "Regresa y pasa el centro",
  },
  {
    id: "forward",
    direction: "forward",
    prompt: "Por último, inclínalo hacia ADELANTE",
    hint: "Como si miraras la parte superior",
  },
];

type HandshakeStatus =
  | "idle"
  | "running"
  | "done"
  | "error"
  | "no_key";

type SpokenEntry = { id: string; text: string; ts: number };

function dirLabel(d: TiltDirection): string {
  switch (d) {
    case "right":
      return "derecha";
    case "left":
      return "izquierda";
    case "forward":
      return "adelante";
    case "back":
      return "atrás";
  }
}

function buildSummary(log: TiltEvent[]): string {
  // Pensado para el SYSTEM_PROMPT actual (tutor de cinemática). Encuadro el
  // resumen como un experimento del estudiante para que el agente reaccione
  // con 1–2 `speak` cortos y sin `draw_*`. Si más tarde cambiamos el system
  // prompt a uno "lab", este texto sigue siendo descriptivo.
  const parts = log.map((e) => {
    const deg =
      Math.abs(e.maxGamma) >= Math.abs(e.maxBeta)
        ? Math.round(Math.abs(e.maxGamma))
        : Math.round(Math.abs(e.maxBeta));
    return `${dirLabel(e.direction)} (~${deg}°, ${e.holdMs} ms)`;
  });
  return [
    "Student finished a quick lab drill tilting a phone.",
    `Motions captured in order: ${parts.join(" → ")}.`,
    "Acknowledge briefly in 1–2 short Spanish sentences using the `speak` tool.",
    "Then ask one short question that connects the motion with velocity direction.",
    "Do not draw on the canvas; use only `speak`.",
  ].join(" ");
}

export default function LabPoc() {
  const tilt = useTiltEvents({ threshold: 15, minHoldMs: 300 });
  const [missionIdx, setMissionIdx] = useState(0);
  const [log, setLog] = useState<TiltEvent[]>([]);
  const [status, setStatus] = useState<HandshakeStatus>("idle");
  const [spoken, setSpoken] = useState<SpokenEntry[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [origin, setOrigin] = useState<string | null>(null);
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [isLanHttp, setIsLanHttp] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const lastEventIdRef = useRef<number>(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setOrigin(window.location.origin);
    const h = window.location.hostname;
    const isPrivateLan =
      /^10\./.test(h) ||
      /^192\.168\./.test(h) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(h);
    setIsLanHttp(window.location.protocol === "http:" && isPrivateLan);
  }, []);

  const currentMission = MISSIONS[missionIdx] ?? null;
  const completed = missionIdx >= MISSIONS.length;

  const callAgent = useCallback(async (question: string) => {
    setStatus("running");
    setErrorMsg(null);
    setSpoken([]);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/lesson", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";
        for (const block of blocks) {
          const lines = block.split("\n");
          const eventLine = lines.find((l) => l.startsWith("event: "));
          const dataLine = lines.find((l) => l.startsWith("data: "));
          if (!eventLine || !dataLine) continue;
          const event = eventLine.slice(7).trim();
          let data: unknown = null;
          try {
            data = JSON.parse(dataLine.slice(6));
          } catch {
            continue;
          }
          if (event === "tool_call") {
            const payload = data as { name?: string; input?: { text?: string } };
            if (payload?.name === "speak" && payload.input?.text) {
              const text = payload.input.text;
              setSpoken((prev) => [
                ...prev,
                { id: `${Date.now()}-${prev.length}`, text, ts: Date.now() },
              ]);
              if (ttsEnabled && typeof window !== "undefined") {
                try {
                  const utter = new SpeechSynthesisUtterance(text);
                  utter.lang = "es-MX";
                  window.speechSynthesis.speak(utter);
                } catch {
                  // TTS del navegador opcional; ignoramos fallos.
                }
              }
            }
          } else if (event === "error") {
            const msg =
              (data as { message?: string })?.message ?? "agent error";
            if (/ANTHROPIC_API_KEY/i.test(msg)) {
              setStatus("no_key");
            } else {
              setStatus("error");
              setErrorMsg(msg);
            }
            return;
          } else if (event === "done") {
            setStatus("done");
            return;
          }
        }
      }
      setStatus("done");
    } catch (err) {
      if (controller.signal.aborted) return;
      setStatus("error");
      setErrorMsg(String(err));
    }
  }, [ttsEnabled]);

  // Cuando llega un nuevo TiltEvent, si coincide con la dirección esperada,
  // lo agregamos al log y avanzamos la misión.
  useEffect(() => {
    const ev = tilt.lastEvent;
    if (!ev) return;
    if (ev.id === lastEventIdRef.current) return;
    lastEventIdRef.current = ev.id;
    if (!currentMission) return;
    if (ev.direction !== currentMission.direction) return;
    setLog((prev) => [...prev, ev]);
    setMissionIdx((i) => i + 1);
  }, [tilt.lastEvent, currentMission]);

  // Cuando completa todas las misiones, dispara el handshake una sola vez.
  useEffect(() => {
    if (!completed) return;
    if (status !== "idle") return;
    if (log.length === 0) return;
    void callAgent(buildSummary(log));
  }, [completed, status, log, callAgent]);

  const restart = useCallback(() => {
    abortRef.current?.abort();
    setMissionIdx(0);
    setLog([]);
    setSpoken([]);
    setStatus("idle");
    setErrorMsg(null);
    tilt.resetEvents();
    lastEventIdRef.current = 0;
  }, [tilt]);

  const statusLabel = useMemo(() => {
    if (tilt.perm === "unsupported") return "Sensores no soportados";
    if (tilt.perm !== "granted") return "Esperando permiso de motion";
    if (!completed) return `Misión ${missionIdx + 1}/${MISSIONS.length}`;
    if (status === "running") return "Hablando con el agente…";
    if (status === "no_key") return "ANTHROPIC_API_KEY faltante";
    if (status === "error") return "Error en el agente";
    if (status === "done") return "Handshake completo";
    return "Preparando handshake";
  }, [tilt.perm, completed, missionIdx, status]);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 p-6 text-sm">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">PoC lab handshake</h1>
        <p className="text-muted-foreground">
          Sensor → misión → resumen → <code>/api/lesson</code>. Aislado bajo{" "}
          <code>/poc/lab</code>, no toca el flujo teach.
        </p>
        <p className="pt-1 text-[11px] text-muted-foreground">
          Origen: <code className="break-all">{origin ?? "—"}</code>
        </p>
      </header>

      <section className="rounded-lg border p-4">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Estado
        </h2>
        <p className="text-sm">
          <strong>{statusLabel}</strong>
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          permiso: <code>{tilt.perm}</code> · eventos crudos:{" "}
          <code>{tilt.events.length}</code> · misiones completas:{" "}
          <code>{log.length}</code> · handshake: <code>{status}</code>
        </p>
        {isLanHttp ? (
          <p className="mt-2 text-[10px] leading-snug text-muted-foreground">
            En <code>http://192.168.…</code> los sensores pueden no exponerse.
            Si no ves eventos, usa un túnel HTTPS (p. ej.{" "}
            <code>cloudflared tunnel --url http://127.0.0.1:3000</code>).
          </p>
        ) : null}
      </section>

      <section className="rounded-lg border p-4">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Motion
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={tilt.enable}
            disabled={tilt.perm === "granted" || tilt.perm === "unsupported"}
            className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            {tilt.perm === "granted" ? "Motion activo" : "Enable motion"}
          </button>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={ttsEnabled}
              onChange={(e) => setTtsEnabled(e.target.checked)}
            />
            <span>Voz del navegador (speechSynthesis)</span>
          </label>
        </div>
        {tilt.perm === "denied" ? (
          <p className="mt-2 text-xs text-destructive">
            Permiso denegado. Recarga la pestaña o revisa Ajustes &gt; Safari
            &gt; Movimiento y orientación.
          </p>
        ) : null}
      </section>

      <section className="rounded-lg border p-4">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Misión guiada
        </h2>
        {!completed && currentMission ? (
          <div className="space-y-2">
            <p className="text-base font-medium">{currentMission.prompt}</p>
            <p className="text-xs text-muted-foreground">
              {currentMission.hint}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Misión completa. Ver respuesta del agente abajo.
          </p>
        )}

        <ol className="mt-3 space-y-1 text-xs">
          {MISSIONS.map((m, i) => {
            const state =
              i < missionIdx ? "done" : i === missionIdx ? "current" : "pending";
            return (
              <li
                key={m.id}
                className={
                  state === "done"
                    ? "text-emerald-600"
                    : state === "current"
                    ? "font-medium"
                    : "text-muted-foreground"
                }
              >
                {state === "done" ? "✓ " : state === "current" ? "▸ " : "• "}
                {m.prompt}
              </li>
            );
          })}
        </ol>
      </section>

      <section className="rounded-lg border p-4">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Respuesta del agente (speak)
        </h2>
        {status === "idle" ? (
          <p className="text-xs text-muted-foreground">
            Se enviará un resumen al completar la misión.
          </p>
        ) : null}
        {status === "running" && spoken.length === 0 ? (
          <p className="text-xs text-muted-foreground">Esperando stream…</p>
        ) : null}
        {status === "no_key" ? (
          <p className="text-xs text-destructive">
            Falta <code>ANTHROPIC_API_KEY</code>. Configúrala en{" "}
            <code>.env.local</code> o activa <code>DEMO_MODE=1</code>.
          </p>
        ) : null}
        {status === "error" ? (
          <p className="text-xs text-destructive">{errorMsg ?? "error"}</p>
        ) : null}
        <ul className="mt-2 space-y-2 text-sm">
          {spoken.map((s) => (
            <li
              key={s.id}
              className="rounded-md bg-muted/40 px-3 py-2 leading-snug"
            >
              {s.text}
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-lg border p-4">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Resumen enviado (debug)
        </h2>
        {log.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Aún no se envía ningún resumen.
          </p>
        ) : (
          <pre className="whitespace-pre-wrap break-words rounded-md bg-muted/40 p-2 text-[11px]">
            {buildSummary(log)}
          </pre>
        )}
      </section>

      <section className="flex items-center justify-between rounded-lg border p-4">
        <p className="text-xs text-muted-foreground">
          Reinicia para repetir la misión completa.
        </p>
        <button
          type="button"
          onClick={restart}
          className="rounded-md border px-3 py-2 text-xs hover:bg-accent"
        >
          Reiniciar
        </button>
      </section>
    </main>
  );
}
