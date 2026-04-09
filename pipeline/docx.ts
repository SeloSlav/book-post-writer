import fs from "node:fs/promises";
import mammoth from "mammoth";

export type ExtractDocxResult = {
  text: string;
  messages: string[];
};

export async function extractTextFromDocx(filePath: string): Promise<ExtractDocxResult> {
  const buffer = await fs.readFile(filePath);
  const result = await mammoth.extractRawText({ buffer });
  const text = normalizeWhitespace(result.value);
  const messages = result.messages.map((m) => m.message);
  return { text, messages };
}

function normalizeWhitespace(s: string): string {
  return s
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
