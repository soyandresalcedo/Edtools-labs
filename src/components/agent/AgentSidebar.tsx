"use client";

import { useEffect, useMemo, useState } from "react";
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
import {
  KOKORO_SKIPPED_MOBILE,
  type ElevenLabsStatus,
  type EnginePref,
  type KokoroVoiceId,
  type KokoroVoicesCatalog,
  type SpeechEngine,
  type SpeechPhase,
  type SpeechStatus,
} from "@/lib/useSpeech";
import type { AppLang } from "@/lib/lang";
import { readLabProgress } from "@/lib/progressStore";
import { LAB_TOPIC_VALUES } from "@/prompts/lab-recipes";

const TOPIC_SHORT: Record<string, Record<AppLang, string>> = {
  "velocity-direction": { en: "vel·dir", es: "vel·dir" },
  "mru-constant-velocity": { en: "MRU", es: "MRU" },
  "mrua-acceleration": { en: "MRUA", es: "MRUA" },
  "free-fall": { en: "fall", es: "caída" },
  "displacement-vs-distance": { en: "Δx vs d", es: "Δx vs d" },
};

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
  enginePref,
  setEnginePref,
  elevenLabsStatus,
  lang,
  setLang,
  onAsk,
  onAskLab,
  onStop,
  onNewLesson,
  onCollapse,
  isAudioSpeaking,
  onUserGesture,
  showLabReturn = false,
  onReturnToTeach,
  patchLabSuggestion,
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
  enginePref: EnginePref;
  setEnginePref: (next: EnginePref) => void;
  elevenLabsStatus: ElevenLabsStatus;
  lang: AppLang;
  setLang: (lang: AppLang) => void;
  onAsk: (q: string) => void;
  onAskLab: (input: {
    question: string;
    handoffContext?: string;
    sensorSummary?: string;
    predictionChoice?: string;
  }) => void | Promise<void>;
  onStop: () => void;
  onNewLesson: () => void;
  onCollapse?: () => void;
  isAudioSpeaking: boolean;
  onUserGesture: () => void;
  showLabReturn?: boolean;
  onReturnToTeach?: () => void;
  patchLabSuggestion: (
    id: string,
    patch: Partial<
      Pick<
        Extract<LogEntry, { role: "lab_suggestion" }>,
        "state" | "predictionChoice"
      >
    >,
  ) => void;
}) {
  const isBusy =
    status === "thinking" || status === "speaking" || status === "drawing";

  const [progressSnap, setProgressSnap] = useState(() => readLabProgress());
  useEffect(() => {
    setProgressSnap(readLabProgress());
  }, [log]);

  const progressChips = useMemo(() => {
    return LAB_TOPIC_VALUES.map((topic) => {
      const n = progressSnap[topic]?.completions ?? 0;
      if (n === 0) return null;
      const short = TOPIC_SHORT[topic]?.[lang] ?? topic.slice(0, 6);
      return (
        <span
          key={topic}
          className="inline-flex items-center rounded-full border bg-muted/50 px-2 py-0.5 text-[10px] text-muted-foreground"
        >
          {short} · {n}
        </span>
      );
    }).filter(Boolean);
  }, [progressSnap, lang]);

  const activeEngineLabel =
    enginePref === "elevenlabs" && elevenLabsStatus === "ready"
      ? "ElevenLabs"
      : speechEngine === "kokoro"
        ? "Kokoro"
        : lang === "es"
          ? "navegador"
          : "browser";

  const voiceLabel =
    speechStatus === "loading"
      ? lang === "es"
        ? "Cargando voz natural..."
        : "Loading natural voice..."
      : speechStatus === "unavailable"
        ? lang === "es"
          ? "Voz no disponible en este dispositivo"
          : "Voice unavailable on this device"
        : muted
          ? lang === "es"
            ? `Voz silenciada (${activeEngineLabel}) — clic para activar`
            : `Voice muted (${activeEngineLabel}) - click to unmute`
          : lang === "es"
            ? `Voz (${activeEngineLabel}) — clic para silenciar`
            : `Voice (${activeEngineLabel}) - click to mute`;

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
          <div className="mr-1 flex rounded-md border p-0.5">
            <Button
              type="button"
              variant={lang === "en" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 px-2 text-[10px]"
              onClick={() => setLang("en")}
            >
              EN
            </Button>
            <Button
              type="button"
              variant={lang === "es" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 px-2 text-[10px]"
              onClick={() => setLang("es")}
            >
              ES
            </Button>
          </div>
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
                aria-label={lang === "es" ? "Nueva lección" : "New lesson"}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {lang === "es" ? "Nueva lección" : "New lesson"}
            </TooltipContent>
          </Tooltip>
          {onCollapse ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={onCollapse}
                  aria-label={
                    lang === "es" ? "Modo enfocado" : "Focus mode"
                  }
                  className="hidden md:inline-flex"
                >
                  <PanelLeftClose className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {lang === "es"
                  ? "Modo enfocado (ocultar barra)"
                  : "Focus mode (hide sidebar)"}
              </TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      </header>

      {elevenLabsStatus === "ready" || enginePref === "elevenlabs" ? (
        <div className="border-b px-4 py-2">
          <label
            htmlFor="engine-pref-select"
            className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
          >
            {lang === "es" ? "Motor de voz" : "Voice engine"}
          </label>
          <select
            id="engine-pref-select"
            className="h-9 w-full cursor-pointer rounded-md border border-input bg-background px-2 text-xs text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={enginePref}
            onChange={(e) => setEnginePref(e.target.value as EnginePref)}
            disabled={status === "speaking"}
            aria-label={lang === "es" ? "Motor de voz" : "Voice engine"}
          >
            <option value="auto">
              {lang === "es" ? "Automático (Kokoro / Sistema)" : "Auto (Kokoro / System)"}
            </option>
            <option value="elevenlabs" disabled={elevenLabsStatus !== "ready"}>
              ElevenLabs{elevenLabsStatus !== "ready"
                ? lang === "es"
                  ? " (no disponible)"
                  : " (unavailable)"
                : ""}
            </option>
          </select>
          {enginePref === "elevenlabs" && elevenLabsStatus === "ready" ? (
            <p className="mt-2 text-[10px] leading-snug text-muted-foreground">
              {lang === "es"
                ? "ElevenLabs activo. Genera audio en la nube en EN y ES; consume cuota de tu cuenta."
                : "ElevenLabs active. Cloud-generated audio in EN and ES; counts against your account quota."}
            </p>
          ) : null}
          {enginePref === "elevenlabs" && elevenLabsStatus === "blocked" ? (
            <p className="mt-2 text-[10px] leading-snug text-destructive">
              {lang === "es"
                ? "ElevenLabs falló en el último turno; usando voz de respaldo. Revisa la consola o tu cuota."
                : "ElevenLabs failed on the last turn; using backup voice. Check the console or your quota."}
            </p>
          ) : null}
        </div>
      ) : null}

      {speechEngine === "webspeech" && kokoroStatus === "loading" ? (
        <div className="border-b px-4 py-2 text-[11px] leading-snug text-muted-foreground">
          <p className="mb-1">
            {lang === "es"
              ? "Cargando Kokoro en segundo plano. Mientras tanto puedes usar la app con la voz de tu sistema."
              : "Loading Kokoro in the background. You can keep using the app with your system voice in the meantime."}
          </p>
          <p className="mb-1 text-[10px] text-muted-foreground/90">
            {lang === "es"
              ? "La primera carga en móvil puede tomar un par de minutos (modelo grande)."
              : "First load on mobile can take a couple minutes (large model download)."}
          </p>
          {typeof kokoroProgress === "number" ? (
            <p className="text-[10px] text-muted-foreground/90">
              {lang === "es" ? "Progreso: " : "Progress: "}
              <strong>{Math.round(kokoroProgress * 100)}%</strong>
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
            {lang === "es" ? "Voz Kokoro" : "Kokoro voice"}
          </label>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="block w-full">
                <select
                  id="kokoro-voice-select"
                  className="h-9 w-full cursor-pointer rounded-md border border-input bg-background px-2 text-xs text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={voice}
                  onChange={(e) => setVoice(e.target.value as KokoroVoiceId)}
                  disabled={status === "speaking" || lang === "es"}
                  aria-label={
                    lang === "es"
                      ? "Voz Kokoro — vista previa en la próxima frase"
                      : "Kokoro voice — preview on next caption"
                  }
                >
                  {voices.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {lang === "es"
                ? "Voz — vista previa en la próxima frase"
                : "Voice — preview on next caption"}
            </TooltipContent>
          </Tooltip>
          {lang === "es" ? (
            <p className="mt-2 text-[10px] leading-snug text-muted-foreground">
              Kokoro solo está disponible en inglés. Para español usamos la voz
              del sistema automáticamente.
            </p>
          ) : null}
        </div>
      ) : speechEngine === "webspeech" && speechStatus === "ready" ? (
        <div className="border-b px-4 py-2 text-[11px] leading-snug text-muted-foreground">
          {kokoroInitError === KOKORO_SKIPPED_MOBILE ? (
            <p className="mb-2">
              {lang === "es" ? (
                <>
                  En móvil usamos la <strong>voz del sistema</strong> (idioma según
                  selector EN/ES) sin cargar Kokoro.
                </>
              ) : (
                <>
                  On mobile we use your <strong>system voice</strong> (language
                  follows EN/ES toggle) without loading Kokoro.
                </>
              )}
            </p>
          ) : (
            <>
              <p className="mb-2">
                {lang === "es"
                  ? "Kokoro no está disponible ahora mismo, así que estás oyendo la voz integrada del sistema. Puedes seguir usando la app con normalidad."
                  : "Kokoro is not available right now, so you are hearing your system's built-in speech instead. You can keep using the app normally."}
              </p>
              <p className="mb-2 text-[10px] text-muted-foreground/90">
                {lang === "es"
                  ? "Tip: en móvil, la primera carga de Kokoro puede tardar. Si sigue fallando, prueba Wi‑Fi vs datos, desactiva Ahorro de datos/VPN/bloqueadores de DNS y toca Reintentar."
                  : "Tip: on mobile, the first Kokoro load can take a while. If it keeps failing, try Wi‑Fi vs data, disable Data Saver/VPN/DNS blockers, then tap Retry."}
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
              {lang === "es" ? "Reintentar Kokoro" : "Retry Kokoro"}
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

      {progressChips.length > 0 ? (
        <div className="flex flex-wrap gap-1 border-b px-4 py-2">
          <span className="w-full text-[10px] font-medium uppercase text-muted-foreground">
            {lang === "es" ? "Labs completados" : "Labs completed"}
          </span>
          {progressChips}
        </div>
      ) : null}

      {showLabReturn && onReturnToTeach ? (
        <div className="border-b border-primary/20 bg-primary/5 px-4 py-2">
          <p className="mb-2 text-[11px] leading-snug text-foreground">
            {lang === "es"
              ? "Lab listo. Si no avanzó solo, pulsa para enviar el contexto al tutor."
              : "Lab ready. If the lesson did not continue automatically, tap to send context to the tutor."}
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
            {lang === "es" ? "Volver a la lección" : "Return to lesson"}
          </Button>
        </div>
      ) : null}

      <Separator />

      <div className="flex-1 min-h-0">
        <ConversationLog
          entries={log}
          currentCaption={caption}
          isSpeaking={isAudioSpeaking}
          lang={lang}
          agentStatus={status}
          patchLabSuggestion={patchLabSuggestion}
          askLab={onAskLab}
          unlockAudio={onUserGesture}
        />
      </div>

      <div className="flex flex-col gap-3 border-t bg-background px-4 py-3">
        <QuestionChips
          lang={lang}
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

export function FocusOpenButton({
  onOpen,
  lang = "en",
}: {
  onOpen: () => void;
  lang?: AppLang;
}) {
  const label = lang === "es" ? "Mostrar barra" : "Show sidebar";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          size="icon"
          onClick={onOpen}
          aria-label={label}
          className="absolute left-4 top-4 z-20 shadow"
        >
          <Expand className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}
