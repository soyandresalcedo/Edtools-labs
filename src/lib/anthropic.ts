import Anthropic from "@anthropic-ai/sdk";

const apiKey = process.env.ANTHROPIC_API_KEY;

if (!apiKey) {
  // Intentionally throw at runtime when API is used; this keeps dev server running
  // even before the user has hackathon credits or a key ready.
  console.warn(
    "ANTHROPIC_API_KEY is not set. Add it to .env.local to enable /api/lesson."
  );
}

export const anthropic = new Anthropic({
  apiKey: apiKey ?? "missing",
});

export const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-4-7";

