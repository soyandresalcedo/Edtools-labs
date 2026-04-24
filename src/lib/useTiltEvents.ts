"use client";

/**
 * Hook que convierte lecturas crudas de `DeviceOrientationEvent` en
 * "tilt events" de alto nivel (direction + holdMs + ángulo máximo).
 *
 * Aislado bajo /lib porque lo quiero reusar desde la PoC 2 y, más adelante,
 * desde el modo lab real sin depender del contrato visual de la PoC 1.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export type TiltDirection = "right" | "left" | "forward" | "back";

export type TiltEvent = {
  id: number;
  direction: TiltDirection;
  /** gamma máximo observado durante el hold (signed). */
  maxGamma: number;
  /** beta máximo observado durante el hold (signed). */
  maxBeta: number;
  /** duración en ms por encima del umbral antes de regresar a neutral. */
  holdMs: number;
  /** Date.now() del cierre del gesto. */
  ts: number;
};

export type TiltPermState =
  | "unknown"
  | "requesting"
  | "granted"
  | "denied"
  | "unsupported";

type Options = {
  /** umbral en grados para empezar a contar un tilt (default 15). */
  threshold?: number;
  /** hold mínimo en ms para emitir (default 300). */
  minHoldMs?: number;
  /** ventana anti-rebote entre eventos consecutivos (default 350 ms). */
  debounceMs?: number;
};

function hasOrientationAPI(): boolean {
  return typeof window !== "undefined" && "DeviceOrientationEvent" in window;
}

function needsIOSPermission(): boolean {
  if (!hasOrientationAPI()) return false;
  const E = (window as unknown as { DeviceOrientationEvent?: unknown })
    .DeviceOrientationEvent as
    | { requestPermission?: () => Promise<"granted" | "denied"> }
    | undefined;
  return typeof E?.requestPermission === "function";
}

export type UseTiltEvents = {
  perm: TiltPermState;
  enable: () => Promise<void>;
  supported: boolean;
  /** últimas lecturas crudas (null hasta primer evento). */
  gamma: number | null;
  beta: number | null;
  alpha: number | null;
  /** último evento normalizado (null hasta el primero). */
  lastEvent: TiltEvent | null;
  /** historial acotado (máx. 20) del orden en que llegaron. */
  events: TiltEvent[];
  /** resetea el historial sin desuscribir. */
  resetEvents: () => void;
};

export function useTiltEvents(options: Options = {}): UseTiltEvents {
  const threshold = options.threshold ?? 15;
  const minHoldMs = options.minHoldMs ?? 300;
  const debounceMs = options.debounceMs ?? 350;

  const [perm, setPerm] = useState<TiltPermState>("unknown");
  const [gamma, setGamma] = useState<number | null>(null);
  const [beta, setBeta] = useState<number | null>(null);
  const [alpha, setAlpha] = useState<number | null>(null);
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
  const attachedRef = useRef(false);

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

  const onOrientation = useCallback(
    (ev: DeviceOrientationEvent) => {
      const g = ev.gamma;
      const b = ev.beta;
      setAlpha(ev.alpha ?? null);
      setBeta(b ?? null);
      setGamma(g ?? null);

      if (g === null || b === null) return;

      let dir: TiltDirection | null = null;
      // Decide por el eje dominante para evitar oscilaciones cruzadas
      if (Math.abs(g) >= Math.abs(b)) {
        if (g > threshold) dir = "right";
        else if (g < -threshold) dir = "left";
      } else {
        if (b > threshold) dir = "forward";
        else if (b < -threshold) dir = "back";
      }

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
    [emitCurrent, threshold],
  );

  useEffect(() => {
    if (!hasOrientationAPI()) {
      setPerm("unsupported");
    }
    return () => {
      if (attachedRef.current) {
        window.removeEventListener("deviceorientation", onOrientation);
        attachedRef.current = false;
      }
    };
  }, [onOrientation]);

  const attach = useCallback(() => {
    if (attachedRef.current) return;
    window.addEventListener("deviceorientation", onOrientation, {
      passive: true,
    });
    attachedRef.current = true;
  }, [onOrientation]);

  const enable = useCallback(async () => {
    if (!hasOrientationAPI()) {
      setPerm("unsupported");
      return;
    }
    if (!needsIOSPermission()) {
      attach();
      setPerm("granted");
      return;
    }
    setPerm("requesting");
    try {
      const E = (
        window as unknown as {
          DeviceOrientationEvent: {
            requestPermission: () => Promise<"granted" | "denied">;
          };
        }
      ).DeviceOrientationEvent;
      const res = await E.requestPermission();
      if (res === "granted") {
        attach();
        setPerm("granted");
      } else {
        setPerm("denied");
      }
    } catch {
      setPerm("denied");
    }
  }, [attach]);

  const resetEvents = useCallback(() => {
    setEvents([]);
    setLastEvent(null);
    activeRef.current = null;
  }, []);

  return {
    perm,
    enable,
    supported: hasOrientationAPI(),
    gamma,
    beta,
    alpha,
    lastEvent,
    events,
    resetEvents,
  };
}
