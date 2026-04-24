import { describe, it, expect } from "vitest";
import { buildSensorSummary } from "@/lib/sensorSummary";
import type { TiltEvent } from "@/lib/useTiltEvents";

function ev(
  partial: Partial<TiltEvent> & Pick<TiltEvent, "direction" | "holdMs">,
): TiltEvent {
  return {
    id: partial.id ?? 1,
    maxGamma: partial.maxGamma ?? 20,
    maxBeta: partial.maxBeta ?? 0,
    ts: partial.ts ?? Date.now(),
    ...partial,
  };
}

describe("buildSensorSummary", () => {
  it("includes peak and approximate rate in English", () => {
    const s = buildSensorSummary(
      [ev({ direction: "right", holdMs: 500, maxGamma: 25, maxBeta: 0 })],
      "en",
    );
    expect(s).toContain("right");
    expect(s).toContain("peak~25");
    expect(s).toContain("°/s");
  });

  it("adds symmetry for opposite pair", () => {
    const s = buildSensorSummary(
      [
        ev({ id: 1, direction: "right", holdMs: 400, maxGamma: 30, maxBeta: 0 }),
        ev({ id: 2, direction: "left", holdMs: 400, maxGamma: -28, maxBeta: 0 }),
      ],
      "en",
    );
    expect(s).toContain("out_back_symmetry=");
  });
});
