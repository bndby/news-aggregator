import { config } from "../config";
import type { FeedArticle, Translation } from "../types";

type ChatCompletion = { choices?: Array<{ message?: { content?: string } }> };

const LLM_TIMEOUT_MS = 25_000;
const LLM_MAX_TOKENS = 1200;

export async function translateArticle(
  article: FeedArticle,
  targetLanguage: string,
  apiKey: string,
): Promise<Translation> {
  const response = await fetch(`${config.llm.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": config.site.url,
      "X-OpenRouter-Title": config.site.name,
    },
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    body: JSON.stringify({
      model: config.llm.model,
      ...(config.llm.fallbackModels.length ? { models: config.llm.fallbackModels } : {}),
      temperature: config.llm.temperature,
      max_tokens: LLM_MAX_TOKENS,
      ...(config.llm.openrouterProviders.length
        ? { provider: { order: config.llm.openrouterProviders } }
        : {}),
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You translate technology news faithfully into ${targetLanguage}. Return JSON only: {"title":"...","summary":"..."}. Keep facts, names, URLs and technical terms accurate. Do not add commentary.`,
        },
        {
          role: "user",
          content: JSON.stringify({ title: article.title, summary: article.summary }),
        },
      ],
    }),
  });
  if (!response.ok) throw new Error(`LLM returned ${response.status}: ${await response.text()}`);

  const completion = await response.json<ChatCompletion>();
  const content = completion.choices?.[0]?.message?.content;
  if (!content) throw new Error("LLM returned no content");
  return parseTranslationContent(content);
}

export function parseTranslationContent(content: string): Translation {
  const stripped = stripCodeFence(content);
  const candidates = [stripped];
  const embedded = stripped.match(/\{[\s\S]*\}/);
  if (embedded && embedded[0] !== stripped) candidates.push(embedded[0]);

  for (const candidate of candidates) {
    try {
      const translation = JSON.parse(candidate) as Partial<Translation>;
      if (isUsableTranslation(translation)) {
        return { title: translation.title.trim(), summary: translation.summary.trim() };
      }
    } catch {
      // Try the next candidate; the model often wraps JSON in prose.
    }
  }

  throw new Error("LLM returned invalid translation");
}

function isUsableTranslation(
  translation: Partial<Translation>,
): translation is Translation {
  return typeof translation.title === "string" && translation.title.trim().length > 0
    && typeof translation.summary === "string" && translation.summary.trim().length > 0;
}

function stripCodeFence(value: string): string {
  return value.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}
