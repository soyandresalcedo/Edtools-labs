"use client";

/**
 * Desktop / no-sensor fallback: user drags a slider (gamma for left/right,
 * beta for forward/back). Emits the same TiltEvent shape as useTiltEvents.
 */

import { useCallback, useRef, useState } from "react";
import type { TiltDirection, TiltEvent, TiltPermState } from "@/lib/useTiltEvents";

type Options = {
  threshold?: number;
  minHoldMs?: number;
  debounceMs?: number;
  /** Which axis the slider controls (matches mission tilt plane). */
  control?: "gamma" | "beta";
};

function dirFromGamma(g: number, threshold: number): TiltDirection | null {
  if (g > threshold) return "right";
  if (g < -threshold) return "left";
  return null;
}

function dirFromBeta(b: number, threshold: number): TiltDirection | null {
  if (b > threshold) return "forward";
  if (b < -threshold) return "back";
  return null;
}

export type UseSimulatedTiltEvents = {
  perm: TiltPermState;
  enable: () => Promise<void>;
  supported: boolean;
  gamma: number | null;
  beta: number | null;
  alpha: number | null;
  lastEvent: TiltEvent | null;
  events: TiltEvent[];
  resetEvents: () => void;
  /** Current control axis from options. */
  control: "gamma" | "beta";
  /** Set simulated angle for the active control axis (degrees). */
  setSimulatedAngle: (v: number | null) => void;
};

export function useSimulatedTiltEvents(options: Options = {}): UseSimulatedTiltEvents {
  const threshold = options.threshold ?? 15;
  const minHoldMs = options.minHoldMs ?? 300;
  const debounceMs = options.debounceMs ?? 350;
  const control = options.control ?? "gamma";

  const [perm, setPerm] = useState<TiltPermState>("unknown");
  const [gamma, setGamma] = useState<number | null>(null);
  const [beta, setBeta] = useState<number | null>(null);
  const [lastEvent, setLastEvent] = useState<TiltEvent | null>(null);
  const [events, setEvents] = useState<TiltEvent[]>([]);

  const activeRef = useRef<null | {
    direction: TiltDirection;
    startTs: number;
    maxGamma: number;
    maxBeta: number;
  }>(null);
  const idRef = useRef(0);
  const lastEmitRef = useRef(0);

  const emitCurrent = useCallback(
    (endTs: number) => {
      const active = activeRef.current;
      if (!active) return;
      const dur = endTs - active.startTs;
      if (dur < minHoldMs) return;
      if (endTs - lastEmitRef.current < debounceMs) return;
      lastEmitRef.current = endTs;
      const next: TiltEvent = {
        id: ++idRef.current,
        direction: active.direction,
        maxGamma: active.maxGamma,
        maxBeta: active.maxBeta,
        holdMs: Math.round(dur),
        ts: Date.now(),
      };
      setLastEvent(next);
      setEvents((prev) => [...prev.slice(-19), next]);
    },
    [minHoldMs, debounceMs],
  );

  const setSimulatedAngle = useCallback(
    (v: number | null) => {
      if (control === "gamma") {
        setGamma(v);
        setBeta(0);
      } else {
        setBeta(v);
        setGamma(0);
      }

      if (v === null) {
        const now = performance.now();
        if (activeRef.current) {
          emitCurrent(now);
          activeRef.current = null;
        }
        return;
      }

      const g = control === "gamma" ? v : 0;
      const b = control === "beta" ? v : 0;
      const dir =
        control === "gamma"
          ? dirFromGamma(g, threshold)
          : dirFromBeta(b, threshold);
      const now = performance.now();
      const active = activeRef.current;

      if (dir) {
        if (!active) {
          activeRef.current = {
            direction: dir,
            startTs: now,
            maxGamma: g,
            maxBeta: b,
          };
        } else if (active.direction !== dir) {
          emitCurrent(now);
          activeRef.current = {
            direction: dir,
            startTs: now,
            maxGamma: g,
            maxBeta: b,
          };
        } else {
          if (Math.abs(g) > Math.abs(active.maxGamma)) active.maxGamma = g;
          if (Math.abs(b) > Math.abs(active.maxBeta)) active.maxBeta = b;
        }
      } else if (active) {
        emitCurrent(now);
        activeRef.current = null;
      }
    },
    [emitCurrent, threshold, control],
  );

  const enable = useCallback(async () => {
    setPerm("granted");
  }, []);

  const resetEvents = useCallback(() => {
    setEvents([]);
    setLastEvent(null);
    activeRef.current = null;
  }, []);

  return {
    perm,
    enable,
    supported: true,
    gamma,
    beta,
    alpha: null,
    lastEvent,
    events,
    resetEvents,
    control,
    setSimulatedAngle,
  };
}
