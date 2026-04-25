import voicesDataRaw from "./kokoroVoices.json";

/**
 * Source of truth: src/lib/kokoroVoices.json (compartido con el script de
 * descarga `scripts/copy-kokoro-model.cjs`). Si tocas la lista, hazlo en el
 * JSON: el script CJS y este wrapper TS la consumen del mismo archivo.
 */

export interface KokoroVoiceMeta {
  readonly id: string;
  readonly label: string;
  readonly lang: string;
}

export const KOKORO_MODEL_ID: string = voicesDataRaw.modelId;
export const KOKORO_REVISION: string = voicesDataRaw.revision ?? "main";
export const KOKORO_VOICES: ReadonlyArray<KokoroVoiceMeta> = voicesDataRaw.voices;

/**
 * Antes era una literal-union (e.g. "af_heart" | "af_bella" | ...). Al pasar la
 * lista a JSON perdemos el literal type. Validar con `isKokoroVoiceId` en
 * runtime es el guard real (mismo comportamiento que antes para inputs externos
 * como localStorage o el <select> de UI).
 */
export type KokoroVoiceId = string;
export type KokoroVoicesCatalog = typeof KOKORO_VOICES;

export function isKokoroVoiceId(v: string): v is KokoroVoiceId {
  return KOKORO_VOICES.some((item) => item.id === v);
}

export const DEFAULT_KOKORO_VOICE: KokoroVoiceId =
  KOKORO_VOICES[0]?.id ?? "af_heart";

/** localStorage key compartido entre useSpeech (UI) y kokoroSingleton (pre-warm). */
export const VOICE_KEY = "physicsboard.voice";
