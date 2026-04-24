import type { AppLang } from "@/lib/lang";

type Emit = (event: string, data: unknown) => void;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function normalize(q: string) {
  return q
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

export type DemoScene = "mru" | "mrua" | "freefall" | "v_vs_a";

/** Classify the user's question into one of the four canned demo scenes. */
export function pickDemoScene(question: string): DemoScene {
  const q = normalize(question);
  if (!q.trim()) return "v_vs_a";

  if (/\bscene\s*4\b/.test(q)) return "freefall";
  if (/\bscene\s*3\b/.test(q)) return "mrua";
  if (/\bscene\s*2\b/.test(q)) return "mru";
  if (/\bscene\s*1\b/.test(q)) return "v_vs_a";

  if (/\bmrua\b/.test(q)) return "mrua";
  if (/\bmruv\b/.test(q)) return "mrua";
  if (/uniformly accelerated/.test(q)) return "mrua";
  if (/accelerated motion/.test(q)) return "mrua";
  if (/\bv[-\s]*t\b/.test(q) && /graph/.test(q)) return "mrua";
  if (/velocity[-\s]*time/.test(q)) return "mrua";

  if (/\bfree ?fall\b/.test(q)) return "freefall";
  if (/\bgravity\b/.test(q)) return "freefall";
  if (/\bdrop(ping|ped)?\b/.test(q)) return "freefall";

  if (/\bmru\b/.test(q)) return "mru";
  if (/uniform (rectilinear )?motion/.test(q)) return "mru";
  if (/constant (velocity|speed)/.test(q)) return "mru";
  if (/position[-\s]*time/.test(q)) return "mru";
  if (/\bx[-\s]*t\b/.test(q) && /graph/.test(q)) return "mru";

  // Spanish (normalize() already strips accents)
  if (/movimiento\s*uniformemente\s*acelerado|mruv|aceleracion\s*uniforme/.test(q)) {
    return "mrua";
  }
  if (/caida\s*libre|gravedad|soltar\s*vertical|objeto\s*en\s*caida/.test(q)) {
    return "freefall";
  }
  if (
    /movimiento\s*rectilineo\s*uniforme|rectilineo\s*uniforme|grafica.*posicion.*tiempo|posicion.*tiempo.*(auto|coche|carro)/.test(
      q,
    )
  ) {
    return "mru";
  }
  if (
    /rapidez.*velocidad|velocidad.*rapidez|escalar.*vector|vector.*escalar|misma\s+rapidez/.test(
      q,
    )
  ) {
    return "v_vs_a";
  }

  return "v_vs_a";
}

/** Scene 1: speed vs acceleration (ball on the ground). Speech Variant interleaved. */
export async function runVelocityVsAccelerationDemo(emit: Emit, lang: AppLang) {
  emit("tool_call", {
    name: "speak",
    input: {
      text: "Let's see the difference between velocity and acceleration using a ball on the ground.",
    },
  });
  await sleep(400);
  emit("tool_call", { name: "clear_canvas", input: {} });
  await sleep(350);
  emit("tool_call", {
    name: "speak",
    input: {
      text: "First I draw the ground as a reference line so the ball has something to rest on.",
    },
  });
  await sleep(400);
  emit("tool_call", {
    name: "draw_line",
    input: { from: [80, 520], to: [720, 520], style: "solid" },
  });
  await sleep(350);
  emit("tool_call", {
    name: "speak",
    input: {
      text: "Here is the ball—we treat it as a particle so the shape does not distract us.",
    },
  });
  await sleep(400);
  emit("tool_call", {
    name: "draw_circle",
    input: { x: 200, y: 480, r: 18, label: "ball", color: "#ef4444" },
  });
  await sleep(350);
  emit("tool_call", {
    name: "speak",
    input: {
      text: "The blue arrow is the velocity: direction and how fast the ball moves that way.",
    },
  });
  await sleep(450);
  emit("tool_call", {
    name: "draw_arrow",
    input: {
      from: [200, 480],
      to: [320, 480],
      kind: "velocity",
      label: "v",
    },
  });
  await sleep(350);
  emit("tool_call", {
    name: "speak",
    input: {
      text: "The red arrow is the acceleration: it tells us if the velocity is speeding up, slowing down or turning.",
    },
  });
  await sleep(450);
  emit("tool_call", {
    name: "draw_arrow",
    input: {
      from: [200, 480],
      to: [200, 560],
      kind: "acceleration",
      label: "a",
    },
  });
  await sleep(350);
  emit("tool_call", {
    name: "speak",
    input: {
      text: "On top I add a short title so you remember the color code of the board.",
    },
  });
  await sleep(400);
  emit("tool_call", {
    name: "draw_text",
    input: {
      x: 420,
      y: 120,
      text: "Velocity (blue) vs acceleration (red)",
      size: 20,
    },
  });
  await sleep(350);
  emit("tool_call", {
    name: "speak",
    input: {
      text: "If the red arrow pointed opposite to the blue one, what would happen to the ball's motion?",
    },
  });
  await sleep(350);
  const reason =
    lang === "es"
      ? "Inclinar el teléfono ayuda a sentir dos direcciones opuestas como dos velocidades distintas."
      : "Tilting the phone helps you feel two opposite directions as two different velocities.";
  emit("tool_call", {
    name: "suggest_lab",
    input: {
      topic: "velocity-direction",
      reason,
      predict: {
        question:
          lang === "es"
            ? "Antes de inclinar: ¿los dos lados se van a “anular” o van a sentirse opuestos?"
            : "Before you tilt: will the two sides feel like they cancel, or like opposites?",
        options:
          lang === "es"
            ? ["Se anulan", "Se sienten opuestos", "Será igual"]
            : ["They cancel out", "They feel opposite", "They feel the same"],
      },
    },
  });
  await sleep(200);
  emit("tool_call", {
    name: "speak",
    input: {
      text:
        lang === "es"
          ? "Abre la tarjeta del lab cuando quieras; luego dime si tu predicción coincidió."
          : "Open the lab card when you are ready—then tell me if your prediction matched what you felt.",
    },
  });
}

/** Scene 2: MRU — t and x axes, x(t) line, car with constant v. Speech Variant interleaved. */
export async function runMruGraphDemo(emit: Emit) {
  emit("tool_call", {
    name: "speak",
    input: {
      text: "In uniform motion the velocity is constant; let's see it on the ground and on a position-vs-time graph.",
    },
  });
  await sleep(450);
  emit("tool_call", { name: "clear_canvas", input: {} });
  await sleep(350);

  emit("tool_call", {
    name: "speak",
    input: {
      text: "First the title, so you know the slope of x versus t will stay the same in this case.",
    },
  });
  await sleep(400);
  emit("tool_call", {
    name: "draw_text",
    input: { x: 60, y: 60, text: "MRU: constant velocity → x(t) is a straight line", size: 18 },
  });
  await sleep(300);

  emit("tool_call", {
    name: "speak",
    input: {
      text: "At the bottom I draw the straight road as a reference for one-dimensional motion.",
    },
  });
  await sleep(400);
  emit("tool_call", {
    name: "draw_line",
    input: { from: [80, 500], to: [720, 500], style: "solid" },
  });
  await sleep(250);

  emit("tool_call", {
    name: "speak",
    input: {
      text: "This rectangle is a car that keeps moving at the same pace, without braking or speeding up.",
    },
  });
  await sleep(450);
  emit("tool_call", {
    name: "draw_rect",
    input: { x: 140, y: 456, w: 56, h: 28, label: "car" },
  });
  await sleep(250);
  emit("tool_call", {
    name: "speak",
    input: {
      text: "The blue arrow shows the constant velocity to the right, like a clear open lane.",
    },
  });
  await sleep(450);
  emit("tool_call", {
    name: "draw_arrow",
    input: {
      from: [168, 470],
      to: [300, 470],
      kind: "velocity",
      label: "constant v",
    },
  });
  await sleep(350);

  emit("tool_call", {
    name: "speak",
    input: {
      text: "On the right I open the graph panel: time on the horizontal axis, position on the vertical.",
    },
  });
  await sleep(450);
  emit("tool_call", {
    name: "draw_text",
    input: { x: 400, y: 200, text: "Position vs time graph", size: 16 },
  });
  await sleep(200);

  const Ox = 420;
  const Oy = 420;
  emit("tool_call", {
    name: "speak",
    input: {
      text: "I draw the t axis and the x axis with the origin at the corner of the graph.",
    },
  });
  await sleep(450);
  emit("tool_call", {
    name: "draw_line",
    input: { from: [Ox, Oy], to: [640, Oy], style: "solid" },
  });
  await sleep(200);
  emit("tool_call", {
    name: "draw_line",
    input: { from: [Ox, Oy], to: [Ox, 240], style: "solid" },
  });
  await sleep(200);
  emit("tool_call", {
    name: "speak",
    input: {
      text: "I label t and x so you know which axis you are reading when we talk about slope.",
    },
  });
  await sleep(400);
  emit("tool_call", {
    name: "draw_text",
    input: { x: 648, y: 412, text: "t", size: 18 },
  });
  await sleep(150);
  emit("tool_call", {
    name: "draw_text",
    input: { x: 400, y: 228, text: "x", size: 18 },
  });
  await sleep(200);

  emit("tool_call", {
    name: "speak",
    input: {
      text: "Now I trace x versus t in short segments: in MRU the slope never changes.",
    },
  });
  await sleep(450);
  const pts: [number, number][] = [
    [440, 400],
    [480, 368],
    [520, 336],
    [560, 304],
    [600, 272],
  ];
  for (let i = 0; i < pts.length - 1; i++) {
    emit("tool_call", {
      name: "draw_line",
      input: { from: pts[i], to: pts[i + 1], style: "solid" },
    });
    await sleep(220);
  }

  emit("tool_call", {
    name: "speak",
    input: {
      text: "That slope is the velocity; if you double the velocity, would the line look steeper or flatter?",
    },
  });
}

/** Scene 3: MRUA — v–t graph, axes, labels, inclined line. Speech Variant interleaved. */
export async function runMruaGraphDemo(emit: Emit) {
  emit("tool_call", {
    name: "speak",
    input: {
      text: "Uniformly accelerated motion means velocity changes at a steady rate. Let's see it on a v–t graph.",
    },
  });
  await sleep(450);
  emit("tool_call", { name: "clear_canvas", input: {} });
  await sleep(300);

  emit("tool_call", {
    name: "speak",
    input: {
      text: "I draw both axes and label them: time at the bottom, velocity on the left.",
    },
  });
  await sleep(400);
  emit("tool_call", {
    name: "draw_line",
    input: { from: [120, 500], to: [700, 500], style: "solid" },
  });
  await sleep(200);
  emit("tool_call", {
    name: "draw_line",
    input: { from: [120, 500], to: [120, 100], style: "solid" },
  });
  await sleep(250);

  emit("tool_call", {
    name: "draw_text",
    input: { x: 690, y: 520, text: "t", size: 18 },
  });
  await sleep(180);
  emit("tool_call", {
    name: "draw_text",
    input: { x: 90, y: 110, text: "v", size: 18 },
  });
  await sleep(250);

  emit("tool_call", {
    name: "speak",
    input: {
      text: "When acceleration is constant, v(t) is a straight line whose slope equals the acceleration a.",
    },
  });
  await sleep(450);
  emit("tool_call", {
    name: "draw_line",
    input: { from: [120, 500], to: [600, 200], style: "solid" },
  });
  await sleep(350);

  emit("tool_call", {
    name: "draw_text",
    input: { x: 540, y: 180, text: "v(t)", size: 16 },
  });
  await sleep(250);

  emit("tool_call", {
    name: "speak",
    input: {
      text: "If the acceleration were twice as large, would this line look steeper or flatter?",
    },
  });
}

/** Scene 4: free fall — ledge, ball, gravity arrow. Speech Variant interleaved. */
export async function runFreeFallDemo(emit: Emit) {
  emit("tool_call", {
    name: "speak",
    input: {
      text: "In free fall we drop an object and only gravity acts. We ignore air resistance.",
    },
  });
  await sleep(450);
  emit("tool_call", { name: "clear_canvas", input: {} });
  await sleep(300);

  emit("tool_call", {
    name: "speak",
    input: {
      text: "I draw a short ledge near the top as the starting edge.",
    },
  });
  await sleep(400);
  emit("tool_call", {
    name: "draw_line",
    input: { from: [300, 120], to: [500, 120], style: "solid" },
  });
  await sleep(300);

  emit("tool_call", {
    name: "speak",
    input: {
      text: "I place the ball right below the ledge, ready to fall.",
    },
  });
  await sleep(400);
  emit("tool_call", {
    name: "draw_circle",
    input: { x: 400, y: 160, r: 18, label: "ball", color: "#ef4444" },
  });
  await sleep(350);

  emit("tool_call", {
    name: "speak",
    input: {
      text: "The gravity acceleration g always points straight down with the same magnitude.",
    },
  });
  await sleep(450);
  emit("tool_call", {
    name: "draw_arrow",
    input: {
      from: [400, 178],
      to: [400, 520],
      kind: "acceleration",
      label: "g",
    },
  });
  await sleep(350);

  emit("tool_call", {
    name: "speak",
    input: {
      text: "If the initial velocity were zero, what happens to the velocity after one second?",
    },
  });
}

export async function runDemoMode(
  emit: Emit,
  question: string,
  lang: AppLang = "en",
) {
  const scene = pickDemoScene(question);
  switch (scene) {
    case "mru":
      await runMruGraphDemo(emit);
      break;
    case "mrua":
      await runMruaGraphDemo(emit);
      break;
    case "freefall":
      await runFreeFallDemo(emit);
      break;
    case "v_vs_a":
    default:
      await runVelocityVsAccelerationDemo(emit, lang);
      break;
  }
  emit("done", { ok: true, demo: true, scene });
}
