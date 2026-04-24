export type AppLang = "en" | "es";

const LANG_KEY = "physicsboard.appLang";

export function inferDefaultLang(): AppLang {
  if (typeof navigator === "undefined") return "en";
  const n = navigator.language?.toLowerCase() ?? "en";
  return n.startsWith("es") ? "es" : "en";
}

export function readStoredLang(): AppLang | null {
  try {
    const raw = localStorage.getItem(LANG_KEY);
    if (raw === "en" || raw === "es") return raw;
  } catch {
    // ignore
  }
  return null;
}

export function writeStoredLang(lang: AppLang): void {
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    // ignore
  }
}

export function webSpeechLocaleForLang(lang: AppLang): string {
  return lang === "es" ? "es-419" : "en-US";
}
