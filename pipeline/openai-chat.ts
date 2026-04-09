import type OpenAI from "openai";
import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";

export async function completionText(
  client: OpenAI,
  model: string,
  messages: ChatCompletionMessageParam[],
  maxCompletionTokens: number | undefined,
  extra?: Partial<ChatCompletionCreateParamsNonStreaming>,
): Promise<string> {
  const body: ChatCompletionCreateParamsNonStreaming = {
    model,
    messages,
    ...extra,
  };
  if (maxCompletionTokens !== undefined && maxCompletionTokens > 0) {
    body.max_completion_tokens = maxCompletionTokens;
  }
  const res = await client.chat.completions.create(body);
  const text = res.choices[0]?.message?.content;
  if (!text) throw new Error("OpenAI returned empty completion.");
  return text;
}
