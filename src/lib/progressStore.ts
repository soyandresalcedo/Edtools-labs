import type { LabTopic } from "@/prompts/lab-recipes";

const KEY = "physicsboard.labProgress";

export type TopicProgress = {
  completions: number;
  lastAt: number;
};

export type LabProgressMap = Partial<Record<LabTopic, TopicProgress>>;

export function readLabProgress(): LabProgressMap {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") return parsed as LabProgressMap;
  } catch {
    // ignore
  }
  return {};
}

export function incrementLabCompletion(topic: LabTopic): LabProgressMap {
  const prev = readLabProgress();
  const cur = prev[topic];
  const next: LabProgressMap = {
    ...prev,
    [topic]: {
      completions: (cur?.completions ?? 0) + 1,
      lastAt: Date.now(),
    },
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  return next;
}

/** Compact string for system prompt injection. */
export function formatProgressForPrompt(p: LabProgressMap): string {
  const entries = Object.entries(p).filter(
    ([, v]) => v && (v as TopicProgress).completions > 0,
  ) as [LabTopic, TopicProgress][];
  if (!entries.length) return "(none)";
  return entries
    .map(([t, v]) => `${t}: ${v.completions} completion(s), last=${new Date(v.lastAt).toISOString().slice(0, 10)}`)
    .join("; ");
}
