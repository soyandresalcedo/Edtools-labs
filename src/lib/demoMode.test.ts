import { describe, it, expect } from "vitest";
import { pickDemoScene } from "@/lib/demoMode";

describe("pickDemoScene", () => {
  it("routes Spanish MRU presets", () => {
    expect(pickDemoScene("Explica el MRU (movimiento rectilíneo uniforme)")).toBe(
      "mru",
    );
    expect(
      pickDemoScene("Gráfica posición–tiempo de un auto a velocidad constante"),
    ).toBe("mru");
  });

  it("routes Spanish speed vs velocity", () => {
    expect(pickDemoScene("¿Rapidez y velocidad son lo mismo?")).toBe("v_vs_a");
    expect(pickDemoScene("¿La misma rapidez significa la misma velocidad?")).toBe(
      "v_vs_a",
    );
  });

  it("routes Spanish MRUA and free fall", () => {
    expect(
      pickDemoScene("¿Qué es el movimiento uniformemente acelerado (MRUA)?"),
    ).toBe("mrua");
    expect(pickDemoScene("Explica la caída libre")).toBe("freefall");
  });
});
