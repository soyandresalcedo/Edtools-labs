"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { LogEntry } from "@/lib/useLessonStream";
import type { AppLang } from "@/lib/lang";
import { getLabRecipe, type LabMissionStep } from "@/prompts/lab-recipes";
import { useTilt, type TiltOptions } from "@/lib/useTilt";
import type { TiltEvent } from "@/lib/useTiltEvents";
import { buildSensorSummary } from "@/lib/sensorSummary";
import { incrementLabCompletion } from "@/lib/progressStore";
import type { AgentStatus } from "@/lib/useLessonStream";

function buildHandoffContext(entries: LogEntry[]): string {
  const tail = entries
    .filter((e) => e.role === "user" || e.role === "agent")
    .slice(-8);
  return tail
    .map((e) => {
      const role = e.role === "user" ? "user" : "agent";
      const text = e.text.replace(/\s+/g, " ").trim();
      return `${role}: ${text}`;
    })
    .join("\n");
}

function LiveAngleMeter({
  gamma,
  beta,
  threshold,
  control,
  lang,
}: {
  gamma: number | null;
  beta: number | null;
  threshold: number;
  control: "gamma" | "beta";
  lang: AppLang;
}) {
  const v = control === "gamma" ? gamma ?? 0 : beta ?? 0;
  const pct = Math.min(100, Math.round((Math.abs(v) / Math.max(threshold * 2.5, 1)) * 100));
  const label =
    lang === "es"
      ? control === "gamma"
        ? "Gamma (izq/der)"
        : "Beta (adel/atr)"
      : control === "gamma"
        ? "Gamma (L/R)"
        : "Beta (F/B)";
  return (
    <div className="mt-2 space-y-1">
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{label}</span>
        <span>
          {v.toFixed(0)}° / {threshold}°
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full bg-primary transition-all duration-100"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function LabTiltRunner({
  step,
  lang,
  onStepDone,
  unlockAudio,
}: {
  step: LabMissionStep;
  lang: AppLang;
  onStepDone: (ev: TiltEvent) => void;
  unlockAudio: () => void;
}) {
  const control: TiltOptions["control"] =
    step.direction === "left" || step.direction === "right"
      ? "gamma"
      : "beta";

  const tilt = useTilt({
    threshold: step.threshold,
    minHoldMs: step.minHoldMs,
    debounceMs: step.debounceMs ?? 350,
    control,
  });

  const lastId = useRef(0);

  useEffect(() => {
    const ev = tilt.lastEvent;
    if (!ev) return;
    if (ev.id === lastId.current) return;
    if (ev.direction !== step.direction) return;
    lastId.current = ev.id;
    try {
      navigator.vibrate?.(30);
    } catch {
      // ignore
    }
    onStepDone(ev);
  }, [tilt.lastEvent, step.direction, onStepDone]);

  const labels = {
    tryNow: lang === "es" ? "Activar y empezar" : "Enable & start",
    sim: lang === "es" ? "Simulador (arrastra)" : "Simulator (drag)",
    useSim: lang === "es" ? "Usar simulador" : "Use simulator",
  };

  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          onClick={() => {
            unlockAudio();
            void tilt.enable();
          }}
          disabled={
            tilt.perm === "unsupported" ||
            (tilt.perm === "granted" && !tilt.setSimulatedAngle)
          }
        >
          {labels.tryNow}
        </Button>
        {!tilt.simulation && tilt.perm !== "unsupported" && tilt.perm !== "denied" ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            onClick={() => tilt.setSimulation(true)}
          >
            {labels.useSim}
          </Button>
        ) : null}
      </div>

      {tilt.simulation && tilt.setSimulatedAngle ? (
        <label className="block text-[11px] text-muted-foreground">
          <span className="mb-1 block font-medium text-foreground">{labels.sim}</span>
          <input
            type="range"
            min={-60}
            max={60}
            defaultValue={0}
            className="w-full"
            onInput={(e) => {
              const v = Number((e.target as HTMLInputElement).value);
              tilt.setSimulatedAngle?.(v);
            }}
            onPointerUp={() => tilt.setSimulatedAngle?.(null)}
          />
        </label>
      ) : null}

      <LiveAngleMeter
        gamma={tilt.gamma}
        beta={tilt.beta}
        threshold={step.threshold}
        control={control}
        lang={lang}
      />
      <p className="text-[10px] text-muted-foreground">
        {lang === "es" ? "permiso:" : "permission:"}{" "}
        <code>{tilt.perm}</code>
        {tilt.simulation ? (
          <span className="ml-2">
            {lang === "es" ? "· simulación" : "· simulation"}
          </span>
        ) : null}
      </p>
    </div>
  );
}

export function LabCard({
  entry,
  lang,
  log,
  status,
  patchLabSuggestion,
  askLab,
  unlockAudio,
}: {
  entry: Extract<LogEntry, { role: "lab_suggestion" }>;
  lang: AppLang;
  log: LogEntry[];
  status: AgentStatus;
  patchLabSuggestion: (
    id: string,
    patch: Partial<Pick<typeof entry, "state" | "predictionChoice">>,
  ) => void;
  askLab: (input: {
    question: string;
    handoffContext?: string;
    sensorSummary?: string;
    predictionChoice?: string;
  }) => void | Promise<void>;
  unlockAudio: () => void;
}) {
  const recipe = useMemo(() => getLabRecipe(entry.topic), [entry.topic]);
  const [missionIdx, setMissionIdx] = useState(0);
  const [captured, setCaptured] = useState<TiltEvent[]>([]);
  const reflectOnceRef = useRef(false);
  const isBusy =
    status === "thinking" || status === "speaking" || status === "drawing";

  const currentStep = recipe.missions[missionIdx] ?? null;
  const missionsDone = missionIdx >= recipe.missions.length;

  const resetMission = useCallback(() => {
    reflectOnceRef.current = false;
    setMissionIdx(0);
    setCaptured([]);
  }, []);

  const onStepDone = useCallback(
    (ev: TiltEvent) => {
      setCaptured((prev) => [...prev, ev]);
      setMissionIdx((i) => i + 1);
    },
    [],
  );

  useEffect(() => {
    if (entry.state !== "running") return;
    if (missionIdx < recipe.missions.length) return;
    if (captured.length < recipe.missions.length) return;
    if (reflectOnceRef.current) return;
    reflectOnceRef.current = true;

    void (async () => {
      patchLabSuggestion(entry.id, { state: "reflecting" });
      const sensorSummary = buildSensorSummary(captured, lang);
      const handoffContext = buildHandoffContext(log);
      const q =
        lang === "es"
          ? [
              "Modo lab:",
              `topic=${entry.topic}`,
              `sensorSummary: ${sensorSummary}`,
              "En 2–3 frases cortas reconoce el movimiento y conéctalo con cinemática.",
              "Si hay predictionChoice, contrástala con el sensor.",
              "Solo herramienta speak; no dibujar.",
            ].join("\n")
          : [
              "Lab mode:",
              `topic=${entry.topic}`,
              `sensorSummary: ${sensorSummary}`,
              "In 2–3 short sentences acknowledge the motion and connect to kinematics.",
              "If predictionChoice is present, contrast it with the sensor.",
              "Use only speak; do not draw.",
            ].join("\n");
      try {
        await askLab({
          question: q,
          handoffContext,
          sensorSummary,
          predictionChoice: entry.predictionChoice,
        });
        incrementLabCompletion(entry.topic);
        patchLabSuggestion(entry.id, { state: "done" });
      } catch {
        reflectOnceRef.current = false;
        patchLabSuggestion(entry.id, { state: "running" });
      }
    })();
  }, [
    askLab,
    captured.length,
    captured,
    entry.id,
    entry.predictionChoice,
    entry.topic,
    entry.state,
    lang,
    log,
    missionIdx,
    patchLabSuggestion,
    recipe.missions.length,
  ]);

  const title = recipe.title[lang];
  const intro = recipe.intro[lang];

  const strings = {
    skip: lang === "es" ? "Ahora no" : "Not now",
    try: lang === "es" ? "Probar ahora" : "Try now",
    continue: lang === "es" ? "Continuar al sensor" : "Continue to sensor",
    running: lang === "es" ? "Midiendo…" : "Measuring…",
    reflecting: lang === "es" ? "Reflexionando…" : "Reflecting…",
    done: lang === "es" ? "Listo — volviendo a la lección…" : "Done — back to the lesson…",
    skipped: lang === "es" ? "Omitido" : "Skipped",
    predictTitle:
      lang === "es" ? "Antes de mover el teléfono" : "Before you move the phone",
  };

  if (entry.state === "skipped" || entry.state === "done") {
    return (
      <div className="rounded-xl border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        {entry.state === "done" ? strings.done : strings.skipped}
      </div>
    );
  }

  if (entry.state === "reflecting") {
    return (
      <div className="rounded-xl border bg-muted/20 px-3 py-2 text-xs">{strings.reflecting}</div>
    );
  }

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 px-3 py-3 text-sm shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-primary">
        {lang === "es" ? "Laboratorio" : "Lab"}
      </p>
      <h3 className="mt-1 font-semibold leading-tight">{title}</h3>
      <p className="mt-1 text-xs text-muted-foreground">{intro}</p>
      <p className="mt-2 text-xs leading-snug text-foreground">{entry.reason}</p>

      {entry.state === "predicting" && entry.predict ? (
        <div className="mt-3 space-y-2">
          <p className="text-xs font-medium">{strings.predictTitle}</p>
          <p className="text-xs text-muted-foreground">{entry.predict.question}</p>
          <div className="flex flex-col gap-1.5">
            {entry.predict.options.map((opt) => (
              <Button
                key={opt}
                type="button"
                variant="secondary"
                size="sm"
                className="h-auto min-h-8 justify-start whitespace-normal py-1.5 text-left text-xs"
                disabled={isBusy}
                onClick={() => {
                  patchLabSuggestion(entry.id, {
                    predictionChoice: opt,
                    state: "running",
                  });
                  resetMission();
                }}
              >
                {opt}
              </Button>
            ))}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-[11px]"
            onClick={() => patchLabSuggestion(entry.id, { state: "skipped" })}
          >
            {strings.skip}
          </Button>
        </div>
      ) : null}

      {entry.state === "pending" ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            disabled={isBusy}
            onClick={() => {
              patchLabSuggestion(entry.id, { state: "running" });
              resetMission();
              unlockAudio();
            }}
          >
            {strings.try}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            onClick={() => patchLabSuggestion(entry.id, { state: "skipped" })}
          >
            {strings.skip}
          </Button>
        </div>
      ) : null}

      {entry.state === "running" && currentStep ? (
        <div className="mt-3 rounded-lg border bg-background/80 p-2">
          <p className="text-xs font-medium">{currentStep.label[lang]}</p>
          <p className="text-[11px] text-muted-foreground">{currentStep.hint[lang]}</p>
          <LabTiltRunner
            key={`${entry.id}-${missionIdx}-${currentStep.threshold}-${currentStep.minHoldMs}-${currentStep.direction}`}
            step={currentStep}
            lang={lang}
            onStepDone={onStepDone}
            unlockAudio={unlockAudio}
          />
        </div>
      ) : null}
    </div>
  );
}
