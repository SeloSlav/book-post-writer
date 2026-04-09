import OpenAI from "openai";

function requireApiKey(): string {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "OPENAI_API_KEY is missing. Set it in your environment or in a .env file at the repo root.",
    );
  }
  return key;
}

export function getOpenAI(): OpenAI {
  return new OpenAI({ apiKey: requireApiKey() });
}
