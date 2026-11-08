import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import OpenAI from "openai";
import { z } from "zod/v4";
import { refineLevels, ReviewSchema, REVIEWER_SYSTEM, reviewPrompt, type ReviewInput, type SignalReview } from "@/app/lib/ai-review";
import { readOwnerRecord, writeOwnerRecord } from "@/app/server/telegram-delivery";

export type AiProvider = "anthropic" | "openai" | "off";
export type AiSettings = { provider: AiProvider; anthropicModel: string; openaiModel: string };

const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";
const DEFAULT_OPENAI_MODEL = "gpt-5";

/** Provider choice: the owner's setting, else whichever key is configured (Anthropic first). */
export async function aiSettings(): Promise<AiSettings & { available: AiProvider[] }> {
  let saved: Partial<AiSettings> = {};
  try { saved = JSON.parse((await readOwnerRecord("ai-settings")) ?? "{}"); } catch { /* defaults */ }
  const available: AiProvider[] = [];
  if (process.env.ANTHROPIC_API_KEY) available.push("anthropic");
  if (process.env.OPENAI_API_KEY) available.push("openai");
  const wanted = saved.provider && ["anthropic", "openai", "off"].includes(saved.provider) ? saved.provider : undefined;
  const provider: AiProvider = wanted === "off" ? "off" : wanted && available.includes(wanted) ? wanted : available[0] ?? "off";
  return { provider, available, anthropicModel: saved.anthropicModel || process.env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL, openaiModel: saved.openaiModel || process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL };
}

export async function saveAiSettings(patch: Partial<AiSettings>) {
  const current = await aiSettings();
  const next = { provider: patch.provider ?? current.provider, anthropicModel: patch.anthropicModel ?? current.anthropicModel, openaiModel: patch.openaiModel ?? current.openaiModel };
  await writeOwnerRecord("ai-settings", JSON.stringify(next));
  return next;
}

/** One structured call to the chosen provider. Anthropic uses the official SDK with structured output; OpenAI its official SDK with a strict JSON schema. */
async function structured<T>(schema: z.ZodType<T>, schemaName: string, system: string, user: string): Promise<{ value: T; provider: string; model: string }> {
  const settings = await aiSettings();
  if (settings.provider === "anthropic") {
    // Always authenticate with the API key header; a stray ANTHROPIC_AUTH_TOKEN would otherwise be sent as a bearer token.
    const client = new Anthropic({ apiKey: (process.env.ANTHROPIC_API_KEY ?? "").trim(), authToken: null, timeout: 50_000, maxRetries: 1 });
    const format = zodOutputFormat(schema as never);
    const request = { model: settings.anthropicModel, max_tokens: 4000, system, messages: [{ role: "user" as const, content: user }], output_config: { effort: "high" as const, format } };
    let text = "";
    try {
      // Server-side refusal fallback keeps a declined review from stalling the push; retried without it if the account lacks the beta.
      const response = await client.beta.messages.create({ ...request, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } as never) as Anthropic.Beta.BetaMessage;
      if (response.stop_reason === "refusal") throw new Error("The reviewer declined to assess this plan.");
      text = response.content.map(block => block.type === "text" ? block.text : "").join("");
    } catch (error) {
      if (!(error instanceof Anthropic.BadRequestError)) throw error;
      const response = await client.messages.create(request as never) as Anthropic.Message;
      if (response.stop_reason === "refusal") throw new Error("The reviewer declined to assess this plan.");
      text = response.content.map(block => block.type === "text" ? block.text : "").join("");
    }
    return { value: schema.parse(JSON.parse(text)), provider: "Claude", model: settings.anthropicModel };
  }
  if (settings.provider === "openai") {
    const client = new OpenAI({ apiKey: (process.env.OPENAI_API_KEY ?? "").trim(), timeout: 50_000, maxRetries: 1 });
    const jsonSchema = z.toJSONSchema(schema as never) as Record<string, unknown>;
    const completion = await client.chat.completions.create({
      model: settings.openaiModel,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      response_format: { type: "json_schema", json_schema: { name: schemaName, schema: jsonSchema as Record<string, unknown>, strict: false } },
    });
    const text = completion.choices[0]?.message?.content ?? "";
    return { value: schema.parse(JSON.parse(text)), provider: "OpenAI", model: settings.openaiModel };
  }
  throw new Error("No AI provider configured. Add ANTHROPIC_API_KEY (or OPENAI_API_KEY) in Vercel.");
}

type ReviewStore = Record<string, SignalReview>;
async function readReviews(): Promise<ReviewStore> { try { return JSON.parse((await readOwnerRecord("ai-reviews")) ?? "{}"); } catch { return {}; } }

/** Review a plan once per plan key; the stored result is reused by the app, the scan and the monitor. */
export async function reviewSignal(input: ReviewInput, planKey: string, force = false): Promise<SignalReview | null> {
  const settings = await aiSettings();
  if (settings.provider === "off") return null;
  const store = await readReviews();
  if (!force && store[planKey] && Date.now() - store[planKey].at < 6 * 3_600_000) return store[planKey];
  const { value, provider, model } = await structured(ReviewSchema, "signal_review", REVIEWER_SYSTEM, reviewPrompt(input));
  const { applied, rejected } = refineLevels(input.row, value.levels);
  const review: SignalReview = { ...value, provider, model, at: Date.now(), planKey, symbol: input.row.symbol, applied, rejectedLevels: rejected };
  const entries = Object.entries({ ...store, [planKey]: review }).sort((a, b) => b[1].at - a[1].at).slice(0, 60);
  try { await writeOwnerRecord("ai-reviews", JSON.stringify(Object.fromEntries(entries))); } catch { /* cache only */ }
  return review;
}

export async function storedReviews(): Promise<ReviewStore> { return readReviews(); }

const ExplainSchema = z.object({ explanation: z.string(), what_would_change_my_mind: z.array(z.string()) });

/** Plain-English read of a pair for /why: what the engine sees, what the reviewer thinks, in a few short paragraphs. */
export async function explainSetup(input: ReviewInput): Promise<{ text: string; provider: string }> {
  const system = REVIEWER_SYSTEM + "\n\nFor this request write a plain-English explanation for the trader instead of a verdict: what the chart and the engine show, the single most important risk, and how to handle the entry and exits. Four short paragraphs at most, no headings, no bullet symbols, prices exactly as given.";
  const { value, provider } = await structured(ExplainSchema, "setup_explanation", system, reviewPrompt(input));
  return { text: value.explanation + (value.what_would_change_my_mind.length ? "\n\nWhat would change the read: " + value.what_would_change_my_mind.slice(0, 3).join("; ") + "." : ""), provider };
}
