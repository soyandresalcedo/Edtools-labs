"use client";

import { useEffect, useState } from "react";
import {
  Plus,
  PanelLeftClose,
  Expand,
  Volume2,
  VolumeX,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AgentStatus } from "./AgentStatus";
import { ConversationLog } from "./ConversationLog";
import { QuestionChips } from "./QuestionChips";
import { QuestionInput } from "./QuestionInput";
import type {
  AgentStatus as AgentStatusValue,
  LogEntry,
} from "@/lib/useLessonStream";
import { useTiltEvents, type TiltEvent } from "@/lib/useTiltEvents";
import {
  KOKORO_SKIPPED_MOBILE,
  type KokoroVoiceId,
  type KokoroVoicesCatalog,
  type SpeechEngine,
  type SpeechPhase,
  type SpeechStatus,
} from "@/lib/useSpeech";

function buildHandoffContext(entries: LogEntry[]): string {
  const tail = entries.slice(-8);
  return tail
    .map((e) => {
      const role = e.role === "user" ? "user" : "agent";
      const text = e.text.replace(/\s+/g, " ").trim();
      return `${role}: ${text}`;
    })
    .join("\n");
}

function dirLabel(d: TiltEvent["direction"]): string {
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

function buildSensorSummary(events: TiltEvent[]): string {
  const parts = events.slice(-6).map((e) => {
    const deg =
      Math.abs(e.maxGamma) >= Math.abs(e.maxBeta)
        ? Math.round(Math.abs(e.maxGamma))
        : Math.round(Math.abs(e.maxBeta));
    return `${dirLabel(e.direction)} (~${deg}°, ${e.holdMs} ms)`;
  });
  return parts.join(" → ");
}

type LabMission = {
  id: string;
  direction: TiltEvent["direction"];
  label: string;
};

const LAB_MISSIONS: LabMission[] = [
  { id: "right", direction: "right", label: "Inclina a la DERECHA" },
  { id: "left", direction: "left", label: "Inclina a la IZQUIERDA" },
  { id: "forward", direction: "forward", label: "Inclina hacia ADELANTE" },
];

export function AgentSidebar({
  status,
  caption,
  log,
  apiKeyHint,
  muted,
  setMuted,
  speechStatus,
  speechEngine,
  speechPhase,
  kokoroStatus,
  kokoroProgress,
  kokoroInitError,
  retryKokoro,
  voice,
  setVoice,
  voices,
  onAsk,
  onAskLab,
  onStop,
  onNewLesson,
  onCollapse,
  isAudioSpeaking,
  onUserGesture,
  showLabReturn = false,
  onReturnToTeach,
}: {
  status: AgentStatusValue;
  caption: string;
  log: LogEntry[];
  apiKeyHint: string | null;
  muted: boolean;
  setMuted: (value: boolean) => void;
  speechStatus: SpeechStatus;
  speechEngine: SpeechEngine;
  speechPhase: SpeechPhase;
  kokoroStatus: "idle" | "loading" | "ready" | "failed";
  kokoroProgress: number | null;
  kokoroInitError: string | null;
  retryKokoro: () => void;
  voice: KokoroVoiceId;
  setVoice: (id: KokoroVoiceId) => void;
  voices: KokoroVoicesCatalog;
  onAsk: (q: string) => void;
  onAskLab: (input: {
    question: string;
    handoffContext?: string;
    sensorSummary?: string;
  }) => void;
  onStop: () => void;
  onNewLesson: () => void;
  onCollapse?: () => void;
  isAudioSpeaking: boolean;
  onUserGesture: () => void;
  showLabReturn?: boolean;
  onReturnToTeach?: () => void;
}) {
  const isBusy =
    status === "thinking" || status === "speaking" || status === "drawing";

  const tilt = useTiltEvents({ threshold: 15, minHoldMs: 300 });
  const [labOpen, setLabOpen] = useState(false);
  const [missionIdx, setMissionIdx] = useState(0);
  const [labEvents, setLabEvents] = useState<TiltEvent[]>([]);
  const completed = missionIdx >= LAB_MISSIONS.length;

  useEffect(() => {
    if (!labOpen) return;
    if (!tilt.lastEvent) return;
    const expected = LAB_MISSIONS[missionIdx];
    if (!expected) return;
    if (tilt.lastEvent.direction !== expected.direction) return;
    setLabEvents((prev) => [...prev, tilt.lastEvent!]);
    setMissionIdx((i) => i + 1);
  }, [labOpen, tilt.lastEvent, missionIdx]);

  useEffect(() => {
    if (!labOpen) return;
    if (!completed) return;
    if (labEvents.length === 0) return;
    const handoffContext = buildHandoffContext(log);
    const sensorSummary = buildSensorSummary(labEvents);
    const question = [
      "Lab mode handoff:",
      `sensorSummary: ${sensorSummary}`,
      "In 2–3 short Spanish sentences, acknowledge the motion and connect it to velocity direction/sign.",
      "End with 1 short question.",
      "Use only the speak tool; do not draw.",
    ].join("\n");
    onUserGesture();
    onAskLab({ question, handoffContext, sensorSummary });
  }, [completed, labEvents, labOpen, log, onAskLab, onUserGesture]);

  const voiceLabel =
    speechStatus === "loading"
      ? "Loading natural voice..."
      : speechStatus === "unavailable"
        ? "Voice unavailable on this device"
        : speechEngine === "kokoro"
          ? muted
            ? "Voice muted (Kokoro) - click to unmute"
            : "Natural voice (Kokoro) - click to mute"
          : muted
            ? "Voice muted (browser) - click to unmute"
            : "Browser voice - click to mute";

  const voiceDisabled =
    speechStatus === "loading" || speechStatus === "unavailable";

  const VoiceIcon =
    speechStatus === "loading"
      ? Loader2
      : muted || speechStatus === "unavailable"
        ? VolumeX
        : Volume2;

  return (
    <aside className="flex h-full min-h-0 w-full flex-col border-r bg-card">
      <header className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-xs font-semibold text-primary-foreground">
            EL
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold leading-none">
              Edtools Labs
            </span>
            <span className="text-[11px] text-muted-foreground">
              Kinematics tutor · Opus 4.7
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setMuted(!muted)}
                disabled={voiceDisabled}
                aria-label={voiceLabel}
                aria-pressed={!muted && speechStatus === "ready"}
              >
                <VoiceIcon
                  className={
                    speechStatus === "loading"
                      ? "h-4 w-4 animate-spin"
                      : "h-4 w-4"
                  }
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{voiceLabel}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onNewLesson}
                disabled={isBusy && log.length === 0}
                aria-label="New lesson"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>New lesson</TooltipContent>
          </Tooltip>
          {onCollapse ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={onCollapse}
                  aria-label="Focus mode"
                  className="hidden md:inline-flex"
                >
                  <PanelLeftClose className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Focus mode (hide sidebar)</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      </header>

      {speechEngine === "webspeech" && kokoroStatus === "loading" ? (
        <div className="border-b px-4 py-2 text-[11px] leading-snug text-muted-foreground">
          <p className="mb-1">
            Loading Kokoro in the background. You can keep using the app with your
            system voice in the meantime.
          </p>
          <p className="mb-1 text-[10px] text-muted-foreground/90">
            First load on mobile can take a couple minutes (large model download).
          </p>
          {typeof kokoroProgress === "number" ? (
            <p className="text-[10px] text-muted-foreground/90">
              Progress: <strong>{Math.round(kokoroProgress * 100)}%</strong>
            </p>
          ) : null}
        </div>
      ) : null}

      {speechEngine === "kokoro" && speechStatus === "ready" ? (
        <div className="border-b px-4 py-2">
          <label
            htmlFor="kokoro-voice-select"
            className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
          >
            Kokoro voice
          </label>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="block w-full">
                <select
                  id="kokoro-voice-select"
                  className="h-9 w-full cursor-pointer rounded-md border border-input bg-background px-2 text-xs text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={voice}
                  onChange={(e) => setVoice(e.target.value as KokoroVoiceId)}
                  disabled={status === "speaking"}
                  aria-label="Kokoro voice — preview on next caption"
                >
                  {voices.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </span>
            </TooltipTrigger>
            <TooltipContent>Voice — preview on next caption</TooltipContent>
          </Tooltip>
        </div>
      ) : speechEngine === "webspeech" && speechStatus === "ready" ? (
        <div className="border-b px-4 py-2 text-[11px] leading-snug text-muted-foreground">
          {kokoroInitError === KOKORO_SKIPPED_MOBILE ? (
            <p className="mb-2">
              En móvil usamos la <strong>voz del sistema en español</strong> (Lab)
              o en inglés (lección) sin cargar Kokoro. Así la app responde al
              instante.
            </p>
          ) : (
            <>
              <p className="mb-2">
                Kokoro is not available right now, so you are hearing your
                system&apos;s built-in speech instead. You can keep using the
                app normally.
              </p>
              <p className="mb-2 text-[10px] text-muted-foreground/90">
                Tip: on mobile, the first Kokoro load can take a while. If it
                keeps failing, try Wi‑Fi vs data, disable Data Saver/VPN/DNS
                blockers, then tap Retry.
              </p>
            </>
          )}
          {kokoroInitError && kokoroInitError !== KOKORO_SKIPPED_MOBILE ? (
            <pre className="mb-2 max-h-28 overflow-auto whitespace-pre-wrap break-words rounded-md border border-destructive/30 bg-destructive/5 p-2 font-mono text-[10px] leading-tight text-destructive">
              {kokoroInitError}
            </pre>
          ) : null}
          {kokoroInitError !== KOKORO_SKIPPED_MOBILE ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 w-full text-xs"
              onClick={() => retryKokoro()}
            >
              Retry Kokoro
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="px-4 py-2">
        <AgentStatus status={status} speechPhase={speechPhase} />
        {apiKeyHint ? (
          <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
            {apiKeyHint}
          </p>
        ) : null}
      </div>

      {showLabReturn && onReturnToTeach ? (
        <div className="border-b border-primary/20 bg-primary/5 px-4 py-2">
          <p className="mb-2 text-[11px] leading-snug text-foreground">
            Lab completado. Vuelve a la lección en inglés: el contexto del lab se
            envía al tutor automáticamente.
          </p>
          <Button
            type="button"
            size="sm"
            className="h-8 w-full text-xs"
            onClick={() => {
              onUserGesture();
              onReturnToTeach();
            }}
            disabled={isBusy}
          >
            Volver a la lección
          </Button>
        </div>
      ) : null}

      <Separator />

      {labOpen ? (
        <div className="border-b bg-background px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Lab (sensor)
              </p>
              <p className="text-[11px] text-muted-foreground">
                {completed
                  ? "Misión completa — enviando handoff…"
                  : `Paso ${missionIdx + 1}/${LAB_MISSIONS.length}`}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs"
              onClick={() => {
                setLabOpen(false);
                setMissionIdx(0);
                setLabEvents([]);
                tilt.resetEvents();
              }}
            >
              Cerrar
            </Button>
          </div>

          <div className="mt-3 flex flex-col gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => tilt.enable()}
              disabled={tilt.perm === "granted" || tilt.perm === "unsupported"}
            >
              {tilt.perm === "granted" ? "Motion activo" : "Enable motion"}
            </Button>
            <div className="text-[11px] text-muted-foreground">
              permiso: <code>{tilt.perm}</code> · eventos:{" "}
              <code>{tilt.events.length}</code>
            </div>

            {!completed ? (
              <div className="rounded-md border bg-muted/20 px-3 py-2 text-sm">
                <div className="font-medium">
                  {LAB_MISSIONS[missionIdx]?.label ?? "—"}
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">
                  Mantén &gt;15° por ~0.3s.
                </div>
              </div>
            ) : null}

            {labEvents.length > 0 ? (
              <div className="text-[11px] text-muted-foreground">
                sensorSummary: <code>{buildSensorSummary(labEvents)}</code>
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="border-b bg-background px-4 py-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 w-full text-xs"
            onClick={() => {
              onUserGesture();
              setLabOpen(true);
              setMissionIdx(0);
              setLabEvents([]);
              tilt.resetEvents();
            }}
            disabled={isBusy || speechStatus !== "ready"}
          >
            Start Lab (tilt mission)
          </Button>
        </div>
      )}

      <div className="flex-1 min-h-0">
        <ConversationLog
          entries={log}
          currentCaption={caption}
          isSpeaking={isAudioSpeaking}
        />
      </div>

      <div className="flex flex-col gap-3 border-t bg-background px-4 py-3">
        <QuestionChips
          onSelect={(q) => {
            onUserGesture();
            onAsk(q);
          }}
          disabled={isBusy || speechStatus !== "ready"}
        />
        <QuestionInput
          onUserGesture={onUserGesture}
          onSubmit={onAsk}
          onStop={onStop}
          status={status}
          disabled={speechStatus !== "ready"}
        />
      </div>
    </aside>
  );
}

export function FocusOpenButton({ onOpen }: { onOpen: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          size="icon"
          onClick={onOpen}
          aria-label="Show sidebar"
          className="absolute left-4 top-4 z-20 shadow"
        >
          <Expand className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">Show sidebar</TooltipContent>
    </Tooltip>
  );
}
