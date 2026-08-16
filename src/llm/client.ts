import { config } from "../config";
import { normalizeText } from "../text";
import type { FeedArticle, Translation } from "../types";

type ChatCompletion = { choices?: Array<{ message?: { content?: string } }> };

const LLM_TIMEOUT_MS = 45_000;
export const LLM_WATCHDOG_MS = 47_000;
const LLM_MAX_TOKENS = 4000;
const CYRILLIC_RE = /[\u0400-\u04FF]/;
export const TRANSLATE_ATTEMPTS = 2;

export async function translateArticle(
  article: FeedArticle,
  targetLanguage: string,
  apiKey: string,
): Promise<Translation> {
  const response = await fetchWithWatchdog(`${config.llm.baseUrl}/chat/completions`, {
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
          content: `You translate technology news faithfully into ${targetLanguage}. Return JSON only: {"title":"...","summary":"..."}. The summary field is the complete article body, not a teaser: translate every paragraph, keep paragraph breaks as \\n\\n, and do not shorten or omit sections. Keep facts, names, URLs and technical terms accurate. Do not add commentary. Never emit HTML entities such as &nbsp; — use a normal space.`,
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
  const translation = parseTranslationContent(content);
  if (!isActualTranslation(article, translation, targetLanguage)) {
    throw new Error("LLM returned untranslated text");
  }
  return translation;
}

/** True when the output is a real translation, not a copy of the source. */
export function isActualTranslation(
  source: Pick<FeedArticle, "title" | "summary">,
  translation: Translation,
  language: string,
): boolean {
  const title = normalizeText(translation.title);
  const summary = normalizeText(translation.summary);
  if (!title || !summary) return false;
  if (
    normalizeText(source.title) === title
    && normalizeText(source.summary || source.title) === summary
  ) {
    return false;
  }
  if (language === "ru" && !CYRILLIC_RE.test(`${title}\n${summary}`)) return false;
  return true;
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
        const title = normalizeText(translation.title);
        const summary = normalizeText(translation.summary);
        if (title && summary) return { title, summary };
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

async function fetchWithWatchdog(input: string, init: RequestInit): Promise<Response> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fetch(input, init),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("LLM request timed out")), LLM_WATCHDOG_MS);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
