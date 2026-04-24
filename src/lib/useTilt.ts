"use client";

import { useCallback, useMemo, useState } from "react";
import { useTiltEvents, type UseTiltEvents } from "@/lib/useTiltEvents";
import { useSimulatedTiltEvents } from "@/lib/useSimulatedTiltEvents";

type BaseOptions = Parameters<typeof useTiltEvents>[0];
export type TiltOptions = BaseOptions & { control?: "gamma" | "beta" };

export type UseTilt = UseTiltEvents & {
  simulation: boolean;
  setSimulation: (v: boolean) => void;
  setSimulatedAngle?: (v: number | null) => void;
};

/**
 * Real device orientation when available and simulation is off; otherwise
 * drag-driven simulated tilt (same TiltEvent contract).
 */
export function useTilt(options: TiltOptions = {}): UseTilt {
  const { control, ...rest } = options;
  const real = useTiltEvents(rest);
  const sim = useSimulatedTiltEvents({ ...rest, control });
  const [simulation, setSimulation] = useState(false);

  const mustSim =
    simulation ||
    real.perm === "unsupported" ||
    real.perm === "denied";

  const useRealBranch = !mustSim && real.perm === "granted";
  const useSimBranch = mustSim;

  const merged = useMemo(() => {
    if (useRealBranch) {
      return {
        perm: real.perm,
        enable: real.enable,
        supported: real.supported,
        gamma: real.gamma,
        beta: real.beta,
        alpha: real.alpha,
        lastEvent: real.lastEvent,
        events: real.events,
        resetEvents: real.resetEvents,
      };
    }
    if (useSimBranch) {
      return {
        perm: sim.perm,
        enable: sim.enable,
        supported: sim.supported,
        gamma: sim.gamma,
        beta: sim.beta,
        alpha: sim.alpha,
        lastEvent: sim.lastEvent,
        events: sim.events,
        resetEvents: sim.resetEvents,
      };
    }
    return {
      perm: real.perm,
      enable: real.enable,
      supported: real.supported,
      gamma: real.gamma,
      beta: real.beta,
      alpha: real.alpha,
      lastEvent: null,
      events: [],
      resetEvents: () => {
        real.resetEvents();
        sim.resetEvents();
      },
    };
  }, [useRealBranch, useSimBranch, real, sim]);

  const enable = useCallback(async () => {
    if (mustSim) {
      await sim.enable();
    } else {
      await real.enable();
    }
  }, [mustSim, real, sim]);

  const resetEvents = useCallback(() => {
    real.resetEvents();
    sim.resetEvents();
  }, [real, sim]);

  return {
    ...merged,
    enable,
    resetEvents,
    simulation: simulation || real.perm === "unsupported" || real.perm === "denied",
    setSimulation,
    setSimulatedAngle: mustSim ? sim.setSimulatedAngle : undefined,
  };
}
