import { config } from "../config";
import type { FeedArticle, Translation } from "../types";

type ChatCompletion = { choices?: Array<{ message?: { content?: string } }> };

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
      "HTTP-Referer": "https://news-aggregator.example",
      "X-OpenRouter-Title": config.site.name,
    },
    body: JSON.stringify({
      model: config.llm.model,
      temperature: config.llm.temperature,
      max_completion_tokens: 500,
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

  const translation = JSON.parse(stripCodeFence(content)) as Partial<Translation>;
  if (!translation.title || !translation.summary) throw new Error("LLM returned invalid translation");
  return { title: translation.title, summary: translation.summary };
}

function stripCodeFence(value: string): string {
  return value.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}
