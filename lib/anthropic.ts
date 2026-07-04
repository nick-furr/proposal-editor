import Anthropic from "@anthropic-ai/sdk";

// Missing configuration fails fast with a readable message instead of a
// cryptic 500. This matters when swapping between a personal key and the
// assessment proxy: both variables live in the environment, never in code.
export class ConfigError extends Error {}

const DEFAULT_MODEL = "claude-sonnet-5";

let cached: { client: Anthropic; model: string } | null = null;

export function getAnthropic(): { client: Anthropic; model: string } {
  if (cached) return cached;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const baseURL = process.env.ANTHROPIC_BASE_URL;
  if (!apiKey || !baseURL) {
    throw new ConfigError(
      "ANTHROPIC_API_KEY and ANTHROPIC_BASE_URL must be set in the environment. See .env.example.",
    );
  }
  cached = {
    // SDK default retries (2) cover transient 429s and 5xx; no custom retry logic.
    client: new Anthropic({ apiKey, baseURL }),
    model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
  };
  return cached;
}
