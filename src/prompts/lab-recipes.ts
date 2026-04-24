import type { TiltDirection } from "@/lib/useTiltEvents";
import type { AppLang } from "@/lib/lang";

export const LAB_TOPIC_VALUES = [
  "velocity-direction",
  "mru-constant-velocity",
  "mrua-acceleration",
  "free-fall",
  "displacement-vs-distance",
] as const;

export type LabTopic = (typeof LAB_TOPIC_VALUES)[number];

export type LabMissionStep = {
  direction: TiltDirection;
  /** Degrees above neutral to count as tilt (passed to useTiltEvents). */
  threshold: number;
  minHoldMs: number;
  debounceMs?: number;
  label: Record<AppLang, string>;
  hint: Record<AppLang, string>;
};

export type LabRecipe = {
  title: Record<AppLang, string>;
  intro: Record<AppLang, string>;
  missions: LabMissionStep[];
};

export const LAB_RECIPES: Record<LabTopic, LabRecipe> = {
  "velocity-direction": {
    title: {
      en: "Feel velocity direction",
      es: "Siente la dirección de la velocidad",
    },
    intro: {
      en: "Tilt the phone like you are tipping an arrow. Each hold is one “direction sample.”",
      es: "Inclina el teléfono como si inclinaras una flecha. Cada sostén es una muestra de dirección.",
    },
    missions: [
      {
        direction: "right",
        threshold: 15,
        minHoldMs: 300,
        label: {
          en: "Tilt to the RIGHT",
          es: "Inclina a la DERECHA",
        },
        hint: {
          en: "Hold steady for about a second, like reading something to your right.",
          es: "Mantén firme un segundo, como si leyeras algo a tu derecha.",
        },
      },
      {
        direction: "left",
        threshold: 15,
        minHoldMs: 300,
        label: {
          en: "Now tilt to the LEFT",
          es: "Ahora inclina a la IZQUIERDA",
        },
        hint: {
          en: "Pass through center, then hold on the other side.",
          es: "Pasa por el centro y sostén del otro lado.",
        },
      },
    ],
  },
  "mru-constant-velocity": {
    title: {
      en: "Constant “velocity” tilt",
      es: "Inclinación = velocidad constante (MRU)",
    },
    intro: {
      en: "Hold one tilt angle steady—like constant velocity on a straight line.",
      es: "Mantén un mismo ángulo de inclinación estable, como una velocidad constante en línea recta.",
    },
    missions: [
      {
        direction: "right",
        threshold: 18,
        minHoldMs: 700,
        label: {
          en: "Tilt right and KEEP the same angle",
          es: "Inclina a la derecha y MANTÉN el mismo ángulo",
        },
        hint: {
          en: "Do not rock—imagine cruise control.",
          es: "Sin balancear: imagina crucero de velocidad fija.",
        },
      },
    ],
  },
  "mrua-acceleration": {
    title: {
      en: "Growing tilt (MRUA intuition)",
      es: "Inclinación creciente (intuición MRUA)",
    },
    intro: {
      en: "Two holds: gentle tilt, then clearly stronger—like velocity changing faster.",
      es: "Dos sostenes: primero suave, luego más fuerte, como si la velocidad cambiara más rápido.",
    },
    missions: [
      {
        direction: "forward",
        threshold: 18,
        minHoldMs: 400,
        label: {
          en: "First: gentle tilt FORWARD",
          es: "Primero: inclinación suave hacia ADELANTE",
        },
        hint: {
          en: "Tip the top of the phone slightly toward you.",
          es: "Lleva un poco la parte superior hacia ti.",
        },
      },
      {
        direction: "forward",
        threshold: 28,
        minHoldMs: 500,
        label: {
          en: "Second: tilt FORWARD more strongly",
          es: "Segundo: inclina más hacia ADELANTE",
        },
        hint: {
          en: "Same direction, bigger angle—like acceleration in the same sense.",
          es: "Misma dirección, más ángulo: como aceleración en el mismo sentido.",
        },
      },
    ],
  },
  "free-fall": {
    title: {
      en: "Gravity direction on the device",
      es: "Dirección de la gravedad en el dispositivo",
    },
    intro: {
      en: "One hold: tilt forward so the screen faces more “into the table” (careful with the phone!).",
      es: "Un sostén: inclina hacia adelante como si la pantalla mirara más hacia la mesa (¡cuidado con el teléfono!).",
    },
    missions: [
      {
        direction: "forward",
        threshold: 22,
        minHoldMs: 450,
        label: {
          en: "Tilt FORWARD (top toward you)",
          es: "Inclina hacia ADELANTE (la parte superior hacia ti)",
        },
        hint: {
          en: "Hold until the meter fills; use two hands if needed.",
          es: "Sostén hasta que se llene la barra; usa dos manos si hace falta.",
        },
      },
    ],
  },
  "displacement-vs-distance": {
    title: {
      en: "Out and back",
      es: "Ida y vuelta",
    },
    intro: {
      en: "Tilt right, then left about the same amount—net displacement vs path length.",
      es: "Inclina a la derecha y luego a la izquierda con ángulo parecido: desplazamiento neto vs recorrido.",
    },
    missions: [
      {
        direction: "right",
        threshold: 16,
        minHoldMs: 350,
        label: {
          en: "Tilt RIGHT",
          es: "Inclina a la DERECHA",
        },
        hint: {
          en: "Remember roughly how strong this tilt felt.",
          es: "Recuerda más o menos qué tan fuerte fue la inclinación.",
        },
      },
      {
        direction: "left",
        threshold: 16,
        minHoldMs: 350,
        label: {
          en: "Tilt LEFT a similar amount",
          es: "Inclina a la IZQUIERDA parecido",
        },
        hint: {
          en: "Try to mirror the first tilt.",
          es: "Intenta espejar la primera inclinación.",
        },
      },
    ],
  },
};

export function isLabTopic(s: string): s is LabTopic {
  return (LAB_TOPIC_VALUES as readonly string[]).includes(s);
}

export function getLabRecipe(topic: LabTopic): LabRecipe {
  return LAB_RECIPES[topic];
}
