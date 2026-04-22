type Emit = (event: string, data: unknown) => void;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function normalize(q: string) {
  return q
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

/** Heurística: si la pregunta huele a MRU / gráfica x–t, usamos escena 2. */
export function shouldUseMruDemo(question: string): boolean {
  const q = normalize(question);
  if (!q.trim()) return false;
  if (/\bescena\s*2\b/.test(q)) return true;
  if (/\bmru\b/.test(q)) return true;
  if (/movimiento rectilineo uniforme/.test(q)) return true;
  if (/grafic[ao].*(tiempo|posicion)/.test(q)) return true;
  if (/(tiempo|posicion).*grafic[ao]/.test(q)) return true;
  if (/posicion.*tiempo/.test(q) || /tiempo.*posicion/.test(q)) return true;
  if (/velocidad constante/.test(q) || /rapidez constante/.test(q)) return true;
  return false;
}

/** Escena 1: velocidad vs aceleración (pelota en el piso). Speech Variant intercalado. */
export async function runVelocityVsAccelerationDemo(emit: Emit) {
  emit("tool_call", {
    name: "speak",
    input: {
      text: "Te muestro en el tablero la diferencia entre velocidad y aceleración con una pelota en el suelo.",
    },
  });
  await sleep(400);
  emit("tool_call", { name: "clear_canvas", input: {} });
  await sleep(350);
  emit("tool_call", {
    name: "speak",
    input: {
      text: "Primero dibujo el piso como línea de referencia para que tengamos dónde apoyar la pelota.",
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
      text: "Aquí va la pelota: la usamos como partícula para no distraernos con la forma.",
    },
  });
  await sleep(400);
  emit("tool_call", {
    name: "draw_circle",
    input: { x: 200, y: 480, r: 18, label: "pelota", color: "#ef4444" },
  });
  await sleep(350);
  emit("tool_call", {
    name: "speak",
    input: {
      text: "La flecha azul es la velocidad: indica hacia dónde se mueve y qué tan rápido va en esa dirección.",
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
      text: "La flecha roja es la aceleración: nos dice si esa velocidad se está aumentando, disminuyendo o girando.",
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
      text: "Arriba dejo un título corto para que recuerdes el código de colores del tablero.",
    },
  });
  await sleep(400);
  emit("tool_call", {
    name: "draw_text",
    input: {
      x: 420,
      y: 120,
      text: "Velocidad (azul) vs aceleración (rojo)",
      size: 20,
    },
  });
  await sleep(350);
  emit("tool_call", {
    name: "speak",
    input: {
      text: "Si la flecha roja apuntara al lado contrario de la azul, ¿qué le estaría pasando al movimiento de la pelota?",
    },
  });
}

/** Escena 2: MRU — ejes t y x, gráfica x(t), auto con v constante. Speech Variant intercalado. */
export async function runMruGraphDemo(emit: Emit) {
  emit("tool_call", {
    name: "speak",
    input: {
      text: "En MRU la velocidad es constante; vamos a verlo en el piso y en una gráfica posición contra tiempo.",
    },
  });
  await sleep(450);
  emit("tool_call", { name: "clear_canvas", input: {} });
  await sleep(350);

  emit("tool_call", {
    name: "speak",
    input: {
      text: "Primero el título para saber que la pendiente de x contra t será constante en este caso.",
    },
  });
  await sleep(400);
  emit("tool_call", {
    name: "draw_text",
    input: { x: 60, y: 60, text: "MRU: velocidad constante → x(t) es una línea recta", size: 18 },
  });
  await sleep(300);

  emit("tool_call", {
    name: "speak",
    input: {
      text: "Abajo dibujo el camino recto como referencia del movimiento en una sola dimensión.",
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
      text: "Este rectángulo representa un auto que avanza siempre al mismo ritmo, sin frenar ni acelerar.",
    },
  });
  await sleep(450);
  emit("tool_call", {
    name: "draw_rect",
    input: { x: 140, y: 456, w: 56, h: 28, label: "auto" },
  });
  await sleep(250);
  emit("tool_call", {
    name: "speak",
    input: {
      text: "La flecha azul marca la velocidad constante hacia la derecha, como en un carril sin tráfico.",
    },
  });
  await sleep(450);
  emit("tool_call", {
    name: "draw_arrow",
    input: {
      from: [168, 470],
      to: [300, 470],
      kind: "velocity",
      label: "v constante",
    },
  });
  await sleep(350);

  emit("tool_call", {
    name: "speak",
    input: {
      text: "A la derecha abro el panel de la gráfica: tiempo en horizontal y posición en vertical.",
    },
  });
  await sleep(450);
  emit("tool_call", {
    name: "draw_text",
    input: { x: 400, y: 200, text: "Gráfica posición vs tiempo", size: 16 },
  });
  await sleep(200);

  const Ox = 420;
  const Oy = 420;
  emit("tool_call", {
    name: "speak",
    input: {
      text: "Dibujo el eje del tiempo t y el eje de posición x con origen en la esquina del gráfico.",
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
      text: "Etiqueto t y x para que sepas qué eje miras cuando hablemos de pendiente.",
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
      text: "Ahora trazo la recta de x contra t en segmentos: en MRU la pendiente no cambia.",
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
      text: "La pendiente de esa recta es la velocidad; si duplicas la velocidad, ¿la recta se ve más empinada o más plana?",
    },
  });
}

export async function runDemoMode(emit: Emit, question: string) {
  if (shouldUseMruDemo(question)) {
    await runMruGraphDemo(emit);
  } else {
    await runVelocityVsAccelerationDemo(emit);
  }
  emit("done", { ok: true, demo: true });
}
