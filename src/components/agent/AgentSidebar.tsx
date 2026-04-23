"use client";

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
import type {
  KokoroVoiceId,
  KokoroVoicesCatalog,
  SpeechEngine,
  SpeechStatus,
} from "@/lib/useSpeech";

export function AgentSidebar({
  status,
  caption,
  log,
  apiKeyHint,
  muted,
  setMuted,
  speechStatus,
  speechEngine,
  kokoroInitError,
  retryKokoro,
  voice,
  setVoice,
  voices,
  onAsk,
  onStop,
  onNewLesson,
  onCollapse,
}: {
  status: AgentStatusValue;
  caption: string;
  log: LogEntry[];
  apiKeyHint: string | null;
  muted: boolean;
  setMuted: (value: boolean) => void;
  speechStatus: SpeechStatus;
  speechEngine: SpeechEngine;
  kokoroInitError: string | null;
  retryKokoro: () => void;
  voice: KokoroVoiceId;
  setVoice: (id: KokoroVoiceId) => void;
  voices: KokoroVoicesCatalog;
  onAsk: (q: string) => void;
  onStop: () => void;
  onNewLesson: () => void;
  onCollapse?: () => void;
}) {
  const isBusy =
    status === "thinking" || status === "speaking" || status === "drawing";

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
            PB
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold leading-none">
              PhysicsBoard
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
          <p className="mb-2">
            Kokoro could not load in this session, so you are hearing your
            system&apos;s built-in speech instead. The Kokoro voice picker only
            appears when the model loads successfully.
          </p>
          <p className="mb-2 text-[10px] text-muted-foreground/90">
            Tip: try the latest <strong>Chrome</strong> or <strong>Edge</strong>{" "}
            on desktop, allow network access to Hugging Face and jsDelivr (disable
            strict ad blockers for localhost), then tap Retry.
          </p>
          {kokoroInitError ? (
            <pre className="mb-2 max-h-28 overflow-auto whitespace-pre-wrap break-words rounded-md border border-destructive/30 bg-destructive/5 p-2 font-mono text-[10px] leading-tight text-destructive">
              {kokoroInitError}
            </pre>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 w-full text-xs"
            onClick={() => retryKokoro()}
          >
            Retry Kokoro
          </Button>
        </div>
      ) : null}

      <div className="px-4 py-2">
        <AgentStatus status={status} />
        {apiKeyHint ? (
          <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
            {apiKeyHint}
          </p>
        ) : null}
      </div>

      <Separator />

      <div className="flex-1 min-h-0">
        <ConversationLog
          entries={log}
          currentCaption={caption}
          isSpeaking={status === "speaking"}
        />
      </div>

      <div className="flex flex-col gap-3 border-t bg-background px-4 py-3">
        <QuestionChips onSelect={onAsk} disabled={isBusy} />
        <QuestionInput onSubmit={onAsk} onStop={onStop} status={status} />
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
