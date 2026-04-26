import type { AppLang } from "@/lib/lang";

/**
 * Heuristica para detectar si un mensaje del usuario corresponde a MODE 2
 * (peticion de lección visual sobre un tema concreto) tal como lo define
 * `src/prompts/system.ts`. Se usa client-side para decidir si auto-reintentar
 * cuando el modelo respondio solo con `speak` y omitio los `draw_*`.
 *
 * Reglas clave:
 * - No es exhaustiva: puede dar falsos negativos en frases muy creativas, lo
 *   cual es deseable porque preferimos NO reintentar antes que reintentar
 *   ante un saludo o un pequeno follow-up conversacional.
 * - Es generosa con los falsos positivos en mensajes que claramente piden
 *   contenido kinematico (verbos de explicacion + sustantivo).
 * - Insensible a mayusculas/diacriticos para ES y EN.
 */
const TRIGGERS_ES = [
  "no entiendo",
  "no comprendo",
  "no me queda claro",
  "explica",
  "explicame",
  "ensena",
  "ensename",
  "muestra",
  "muestrame",
  "ensename",
  "dibuja",
  "dibujame",
  "grafica",
  "grafico",
  "que es",
  "como funciona",
  "como se",
  "ayudame con",
  "puedes mostrar",
  "puedes graficar",
  "podrias mostrar",
  "hazme una grafica",
];

const TRIGGERS_EN = [
  "i don't understand",
  "i dont understand",
  "i do not understand",
  "explain",
  "show me",
  "show the",
  "draw",
  "graph",
  "plot",
  "what is",
  "what's",
  "what does",
  "how does",
  "how do",
  "help me with",
  "can you show",
  "can you draw",
  "can you graph",
];

/**
 * Normaliza una frase: minusculas + sin diacriticos. Intencionalmente NO
 * tocamos signos de puntuacion (matchamos por inclusion de substring).
 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

export function isLikelyMode2Question(text: string, lang: AppLang): boolean {
  const norm = normalize(text);
  if (norm.length < 3) return false;
  const triggers = lang === "es" ? TRIGGERS_ES : TRIGGERS_EN;
  if (triggers.some((t) => norm.includes(t))) return true;
  // Cross-language safety net: usuarios bilingues a veces escriben mezclado.
  const other = lang === "es" ? TRIGGERS_EN : TRIGGERS_ES;
  return other.some((t) => norm.includes(t));
}
