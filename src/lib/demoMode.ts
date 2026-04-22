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

async function streamNarration(emit: Emit, text: string) {
  const chunks = text.match(/.{1,36}(\s|$)/g) ?? [text];
  for (const chunk of chunks) {
    emit("narration_delta", { text: chunk });
    await sleep(55);
  }
}

/** Escena 1: velocidad vs aceleración (pelota en el piso). */
export async function runVelocityVsAccelerationDemo(emit: Emit) {
  emit("tool_call", { name: "clear_canvas", input: {} });
  await sleep(350);
  emit("tool_call", {
    name: "draw_line",
    input: { from: [80, 520], to: [720, 520], style: "solid" },
  });
  await sleep(350);
  emit("tool_call", {
    name: "draw_circle",
    input: { x: 200, y: 480, r: 18, label: "pelota", color: "#ef4444" },
  });
  await sleep(350);
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
    name: "draw_text",
    input: {
      x: 420,
      y: 120,
      text: "Velocidad (azul) vs aceleración (rojo)",
      size: 20,
    },
  });

  await streamNarration(
    emit,
    "Fíjate: la flecha azul es la velocidad (hacia dónde se mueve) y la roja es la aceleración (qué tanto cambia esa velocidad). Si la azul se hace más larga, vas más rápido. ¿Qué crees que pasa si la flecha roja apunta al lado contrario?"
  );
}

/** Escena 2: MRU — ejes t y x, gráfica x(t) recta, auto con v constante. */
export async function runMruGraphDemo(emit: Emit) {
  emit("tool_call", { name: "clear_canvas", input: {} });
  await sleep(350);

  emit("tool_call", {
    name: "draw_text",
    input: { x: 60, y: 60, text: "MRU: velocidad constante → x(t) es una línea recta", size: 18 },
  });
  await sleep(300);

  // Piso / referencia
  emit("tool_call", {
    name: "draw_line",
    input: { from: [80, 500], to: [720, 500], style: "solid" },
  });
  await sleep(250);

  // “Auto”
  emit("tool_call", {
    name: "draw_rect",
    input: { x: 140, y: 456, w: 56, h: 28, label: "auto" },
  });
  await sleep(250);
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

  // Panel de gráfica: etiqueta
  emit("tool_call", {
    name: "draw_text",
    input: { x: 400, y: 200, text: "Gráfica posición vs tiempo", size: 16 },
  });
  await sleep(200);

  // Eje t (horizontal), eje x (vertical) — origen abajo-izquierda del panel
  const Ox = 420;
  const Oy = 420;
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
    name: "draw_text",
    input: { x: 648, y: 412, text: "t", size: 18 },
  });
  await sleep(150);
  emit("tool_call", {
    name: "draw_text",
    input: { x: 400, y: 228, text: "x", size: 18 },
  });
  await sleep(200);

  // Curva x(t): varios segmentos (pendiente constante = MRU)
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
    name: "draw_text",
    input: { x: 520, y: 248, text: "pendiente = v", size: 16 },
  });

  await streamNarration(
    emit,
    "En movimiento rectilíneo uniforme la velocidad no cambia: por eso en la gráfica de posición contra tiempo la curva es una línea recta. La pendiente de esa línea es justamente la velocidad. Si duplicas la velocidad, ¿qué le pasaría a la inclinación de la recta?"
  );
}

export async function runDemoMode(emit: Emit, question: string) {
  if (shouldUseMruDemo(question)) {
    await runMruGraphDemo(emit);
  } else {
    await runVelocityVsAccelerationDemo(emit);
  }
  emit("done", { ok: true, demo: true });
}
