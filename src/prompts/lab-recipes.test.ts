import { describe, it, expect } from "vitest";
import {
  LAB_RECIPES,
  LAB_TOPIC_VALUES,
  getLabRecipe,
  isLabTopic,
} from "@/prompts/lab-recipes";

describe("lab-recipes", () => {
  it("has a recipe for every topic value", () => {
    for (const t of LAB_TOPIC_VALUES) {
      expect(LAB_RECIPES[t].missions.length).toBeGreaterThan(0);
      expect(getLabRecipe(t).title.en.length).toBeGreaterThan(3);
    }
  });

  it("isLabTopic narrows correctly", () => {
    expect(isLabTopic("velocity-direction")).toBe(true);
    expect(isLabTopic("nope")).toBe(false);
  });
});
