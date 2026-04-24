"use client";

/**
 * PoC 1: tilt sensors (DeviceOrientation).
 *
 * Objetivo: validar permisos e lectura de inclinación en iPhone/Android
 * SIN tocar el flujo de tutor. Esta página está aislada bajo /poc/tilt.
 *
 * Qué prueba:
 * - API disponible en el navegador (`DeviceOrientationEvent`).
 * - Permiso iOS Safari: requestPermission() tras gesto de usuario.
 * - Lectura en vivo (gamma, beta, alpha) con throttle ~10 Hz.
 * - Estado claro si no hay permiso o API no soportada.
 */

import { useCallback, useEffect, useRef, useState } from "react";

type PermState = "unknown" | "requesting" | "granted" | "denied" | "unsupported";

type Reading = {
  alpha: number | null;
  beta: number | null;
  gamma: number | null;
  at: number;
};

function hasOrientationAPI(): boolean {
  return typeof window !== "undefined" && "DeviceOrientationEvent" in window;
}

function needsIOSPermission(): boolean {
  if (!hasOrientationAPI()) return false;
  // Safari iOS (13+) expone requestPermission como método estático del constructor.
  const E = (window as unknown as { DeviceOrientationEvent?: unknown })
    .DeviceOrientationEvent as
    | { requestPermission?: () => Promise<"granted" | "denied"> }
    | undefined;
  return typeof E?.requestPermission === "function";
}

export default function TiltPoc() {
  const [perm, setPerm] = useState<PermState>("unknown");
  const [reading, setReading] = useState<Reading>({
    alpha: null,
    beta: null,
    gamma: null,
    at: 0,
  });
  const [httpsOk, setHttpsOk] = useState<boolean | null>(null);
  const [events, setEvents] = useState(0);
  const [origin, setOrigin] = useState<string | null>(null);
  const [isLanHttp, setIsLanHttp] = useState(false);

  const lastTs = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setOrigin(window.location.origin);
    const h = window.location.hostname;
    const isLocalhost = h === "localhost" || h === "127.0.0.1";
    setHttpsOk(window.location.protocol === "https:" || isLocalhost);
    const isPrivateLan =
      /^10\./.test(h) ||
      /^192\.168\./.test(h) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(h);
    setIsLanHttp(window.location.protocol === "http:" && isPrivateLan);
    if (!hasOrientationAPI()) setPerm("unsupported");
  }, []);

  const onOrientation = useCallback((ev: DeviceOrientationEvent) => {
    const now = performance.now();
    if (now - lastTs.current < 100) return; // ~10 Hz
    lastTs.current = now;
    setEvents((n) => n + 1);
    setReading({
      alpha: ev.alpha,
      beta: ev.beta,
      gamma: ev.gamma,
      at: Date.now(),
    });
  }, []);

  const attachListeners = useCallback(() => {
    window.addEventListener("deviceorientation", onOrientation, {
      passive: true,
    });
  }, [onOrientation]);

  useEffect(() => {
    return () => {
      window.removeEventListener("deviceorientation", onOrientation);
    };
  }, [onOrientation]);

  const requestPermission = useCallback(async () => {
    if (!hasOrientationAPI()) {
      setPerm("unsupported");
      return;
    }
    if (!needsIOSPermission()) {
      attachListeners();
      setPerm("granted");
      return;
    }
    setPerm("requesting");
    try {
      const E = (window as unknown as {
        DeviceOrientationEvent: {
          requestPermission: () => Promise<"granted" | "denied">;
        };
      }).DeviceOrientationEvent;
      const result = await E.requestPermission();
      if (result === "granted") {
        attachListeners();
        setPerm("granted");
      } else {
        setPerm("denied");
      }
    } catch {
      setPerm("denied");
    }
  }, [attachListeners]);

  const fmt = (n: number | null) =>
    n === null || Number.isNaN(n) ? "–" : n.toFixed(1);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 p-6 text-sm">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">PoC tilt sensors</h1>
        <p className="text-muted-foreground">
          Lee <code>DeviceOrientation</code> para validar si el modo lab es
          viable en tu dispositivo.
        </p>
        <p className="pt-1 text-[11px] text-muted-foreground">
          <strong>Red / móvil:</strong> el dev server escucha en{" "}
          <code>0.0.0.0</code> (ver <code>pnpm dev</code>). En el teléfono, misma
          Wi‑Fi, abre <code className="break-all">http://&lt;IP-de-tu-PC&gt;:3000</code>{" "}
          <code className="break-all">/poc/tilt</code>. Origen actual:{" "}
          <code className="break-all">
            {origin ?? "—"}
          </code>
        </p>
      </header>

      <section className="rounded-lg border p-4">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Entorno
        </h2>
        <ul className="space-y-1 text-xs">
          <li>
            HTTPS o localhost:{" "}
            <strong>{httpsOk === null ? "–" : httpsOk ? "OK" : "NO"}</strong>
          </li>
          <li>
            DeviceOrientation API:{" "}
            <strong>{hasOrientationAPI() ? "Sí" : "No"}</strong>
          </li>
          <li>
            Requiere permiso explícito (iOS):{" "}
            <strong>{needsIOSPermission() ? "Sí" : "No"}</strong>
          </li>
          <li>
            HTTP en LAN privada:{" "}
            <strong>{isLanHttp ? "Sí (puede limitar sensores)" : "N/A o no"}</strong>
          </li>
        </ul>
        {isLanHttp ? (
          <p className="mt-2 text-[10px] leading-snug text-muted-foreground">
            Varios navegadores tratan <code>http://192.168.…</code> como contexto
            poco fiable. Si no ves eventos, prueba un túnel con HTTPS (p. ej.{" "}
            <code>cloudflared tunnel --url http://127.0.0.1:3000</code>).
          </p>
        ) : null}
      </section>

      <section className="rounded-lg border p-4">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Permiso
        </h2>
        <p className="mb-3 text-xs">
          Estado: <strong>{perm}</strong>
        </p>
        <button
          type="button"
          onClick={requestPermission}
          disabled={perm === "requesting" || perm === "unsupported"}
          className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
        >
          {perm === "granted"
            ? "Permiso concedido (listeners activos)"
            : "Enable motion"}
        </button>
        {perm === "denied" ? (
          <p className="mt-2 text-xs text-destructive">
            Permiso denegado. En iOS Safari, reiniciar la pestaña o revisar
            Ajustes &gt; Safari &gt; Movimiento y orientación.
          </p>
        ) : null}
        {perm === "unsupported" ? (
          <p className="mt-2 text-xs text-destructive">
            Este navegador/dispositivo no expone DeviceOrientationEvent.
          </p>
        ) : null}
      </section>

      <section className="rounded-lg border p-4">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Lectura en vivo
        </h2>
        <dl className="grid grid-cols-3 gap-3 text-center">
          <div>
            <dt className="text-[10px] uppercase text-muted-foreground">
              alpha
            </dt>
            <dd className="text-lg font-mono">{fmt(reading.alpha)}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase text-muted-foreground">
              beta
            </dt>
            <dd className="text-lg font-mono">{fmt(reading.beta)}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase text-muted-foreground">
              gamma
            </dt>
            <dd className="text-lg font-mono">{fmt(reading.gamma)}</dd>
          </div>
        </dl>
        <p className="mt-3 text-[10px] text-muted-foreground">
          Eventos recibidos: {events} · última lectura:{" "}
          {reading.at ? new Date(reading.at).toLocaleTimeString() : "–"}
        </p>
      </section>

      <section className="rounded-lg border p-4">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Indicador visual (tilt)
        </h2>
        <div className="flex items-center justify-center">
          <div
            aria-hidden
            className="relative h-40 w-40 rounded-full border"
            style={{
              transform: `rotate(${reading.gamma ?? 0}deg)`,
              transition: "transform 90ms linear",
            }}
          >
            <div
              className="absolute left-1/2 top-1/2 h-1 w-20 -translate-x-1/2 -translate-y-1/2 rounded bg-primary"
              style={{
                transform: `rotate(${reading.beta ?? 0}deg)`,
              }}
            />
          </div>
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground">
          El círculo rota con <code>gamma</code> (inclinación izquierda/derecha).
          La barra interior rota con <code>beta</code> (adelante/atrás).
        </p>
      </section>
    </main>
  );
}
