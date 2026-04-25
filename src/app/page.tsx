"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { LessonCanvas } from "@/components/LessonCanvas";
import {
  AgentSidebar,
  FocusOpenButton,
} from "@/components/agent/AgentSidebar";
import { CanvasCaptionOverlay } from "@/components/agent/CanvasCaptionOverlay";
import { PenCursor } from "@/components/agent/PenCursor";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { useLessonStream } from "@/lib/useLessonStream";
import { cn } from "@/lib/utils";

export default function Home() {
  const {
    canvasRef,
    status,
    caption,
    log,
    apiKeyHint,
    isAudioSpeaking,
    unlockAudio,
    penState,
    appState,
    setAppState,
    muted,
    setMuted,
    speechStatus,
    speechEngine,
    speechPhase,
    voice,
    setVoice,
    voices,
    enginePref,
    setEnginePref,
    elevenLabsStatus,
    ask,
    askLab,
    stop,
    newLesson,
    showLabReturn,
    returnToTeach,
    lang,
    setLang,
    patchLabSuggestion,
  } = useLessonStream();

  const [focusMode, setFocusMode] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  function handleAsk(q: string) {
    setMobileOpen(false);
    void ask(q);
  }

  return (
    <main
      className={cn(
        "grid h-screen w-screen grid-cols-1 bg-background",
        focusMode ? "md:grid-cols-[0_1fr]" : "md:grid-cols-[360px_1fr]",
      )}
    >
      <div
        className={cn(
          "hidden h-full min-h-0 md:flex",
          focusMode && "md:hidden",
        )}
      >
        <AgentSidebar
          status={status}
          caption={caption}
          log={log}
          apiKeyHint={apiKeyHint}
          muted={muted}
          setMuted={setMuted}
          speechStatus={speechStatus}
          speechEngine={speechEngine}
          speechPhase={speechPhase}
          voice={voice}
          setVoice={setVoice}
          voices={voices}
          enginePref={enginePref}
          setEnginePref={setEnginePref}
          elevenLabsStatus={elevenLabsStatus}
          lang={lang}
          setLang={setLang}
          onAsk={handleAsk}
          onAskLab={(input) => {
            setMobileOpen(false);
            void askLab(input);
          }}
          onStop={stop}
          onNewLesson={newLesson}
          onCollapse={() => setFocusMode(true)}
          isAudioSpeaking={isAudioSpeaking}
          onUserGesture={unlockAudio}
          showLabReturn={showLabReturn}
          onReturnToTeach={returnToTeach}
          patchLabSuggestion={patchLabSuggestion}
        />
      </div>

      <section className="relative h-full min-h-0 overflow-hidden">
        <div className="absolute left-4 top-4 z-20 flex items-center gap-2 md:hidden">
          <Button
            type="button"
            variant="secondary"
            size="icon"
            onClick={() => setMobileOpen(true)}
            aria-label={lang === "es" ? "Abrir barra" : "Open sidebar"}
            className="shadow"
          >
            <Menu className="h-4 w-4" />
          </Button>
        </div>

        {focusMode ? (
          <div className="hidden md:block">
            <FocusOpenButton onOpen={() => setFocusMode(false)} lang={lang} />
          </div>
        ) : null}

        <div className="relative h-full w-full">
          <LessonCanvas
            onReady={(api) => (canvasRef.current = api)}
            onAppStateChange={setAppState}
          />
          <PenCursor state={penState} appState={appState} />
        </div>

        <CanvasCaptionOverlay caption={caption} status={status} />
      </section>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-[320px] p-0">
          <SheetTitle className="sr-only">
            {lang === "es" ? "Agente Edtools Labs" : "Edtools Labs agent"}
          </SheetTitle>
          <SheetDescription className="sr-only">
            {lang === "es"
              ? "Conversación, preguntas predefinidas y entrada para el tutor de Edtools Labs."
              : "Conversation, preset questions and input for the Edtools Labs tutor."}
          </SheetDescription>
          <AgentSidebar
            status={status}
            caption={caption}
            log={log}
            apiKeyHint={apiKeyHint}
            muted={muted}
            setMuted={setMuted}
            speechStatus={speechStatus}
            speechEngine={speechEngine}
            speechPhase={speechPhase}
            voice={voice}
            setVoice={setVoice}
            voices={voices}
            enginePref={enginePref}
            setEnginePref={setEnginePref}
            elevenLabsStatus={elevenLabsStatus}
            lang={lang}
            setLang={setLang}
            onAsk={handleAsk}
            onAskLab={(input) => {
              setMobileOpen(false);
              void askLab(input);
            }}
            onStop={stop}
            onNewLesson={newLesson}
            isAudioSpeaking={isAudioSpeaking}
            onUserGesture={unlockAudio}
            showLabReturn={showLabReturn}
            onReturnToTeach={returnToTeach}
            patchLabSuggestion={patchLabSuggestion}
          />
        </SheetContent>
      </Sheet>
    </main>
  );
}
