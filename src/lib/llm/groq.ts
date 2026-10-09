import Groq from "groq-sdk";
import type { ZodType } from "zod";
import { env, hasGroq } from "@/lib/env";
import { ApiError } from "@/lib/http";

let client: Groq | null = null;

function groq(): Groq {
  if (!hasGroq()) {
    throw new ApiError(
      503,
      "The AI interviewer isn't configured. Set GROQ_API_KEY in your environment.",
      "GROQ_UNCONFIGURED",
    );
  }
  client ??= new Groq({ apiKey: env.GROQ_API_KEY });
  return client;
}

export type Speed = "fast" | "quality";

function pickModel(speed: Speed): string {
  return speed === "quality" ? env.GROQ_MODEL_QUALITY : env.GROQ_MODEL_FAST;
}

/**
 * Reasoning models (gpt-oss, qwen3) spend hidden reasoning tokens out of
 * max_tokens before writing the answer. Keep reasoning short for live-voice
 * latency and add headroom so the visible answer is never truncated.
 */
const REASONING_TOKEN_BUDGET = 1024;

function modelParams(speed: Speed, maxTokens: number) {
  const model = pickModel(speed);
  if (!/gpt-oss|qwen3/i.test(model)) return { model, max_tokens: maxTokens };
  return {
    model,
    max_tokens: maxTokens + REASONING_TOKEN_BUDGET,
    reasoning_effort: "low" as const,
  };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface BaseOpts {
  speed?: Speed;
  temperature?: number;
  maxTokens?: number;
}

/** Free-form text completion (used by the Interviewer agent). */
export async function chatText(
  messages: ChatMessage[],
  opts: BaseOpts = {},
): Promise<string> {
  const res = await groq().chat.completions.create({
    ...modelParams(opts.speed ?? "quality", opts.maxTokens ?? 400),
    messages,
    temperature: opts.temperature ?? 0.7,
  });
  return res.choices[0]?.message?.content?.trim() ?? "";
}

/** Streaming text completion — yields token deltas as they arrive. */
export async function* chatStream(
  messages: ChatMessage[],
  opts: BaseOpts = {},
): AsyncGenerator<string> {
  const stream = await groq().chat.completions.create({
    ...modelParams(opts.speed ?? "quality", opts.maxTokens ?? 400),
    messages,
    temperature: opts.temperature ?? 0.7,
    stream: true,
  });
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) yield delta;
  }
}

function parseJsonLoose(raw: string): unknown {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  return JSON.parse(cleaned);
}

/**
 * JSON-mode completion validated against a zod schema (Evaluator/Planner/Resume).
 * Groq requires the literal word "json" somewhere in the prompt for JSON mode,
 * which our system prompts guarantee.
 */
export async function chatJSON<T>(
  messages: ChatMessage[],
  schema: ZodType<T>,
  opts: BaseOpts = {},
): Promise<T> {
  const res = await groq().chat.completions.create({
    ...modelParams(opts.speed ?? "fast", opts.maxTokens ?? 1024),
    messages,
    temperature: opts.temperature ?? 0.2,
    response_format: { type: "json_object" },
  });
  const raw = res.choices[0]?.message?.content ?? "{}";
  return schema.parse(parseJsonLoose(raw));
}
