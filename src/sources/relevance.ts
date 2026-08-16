import type { FeedArticle } from "../types";

const FRONTEND_RE =
  /\b(?:frontend|front-end|front end|web development|javascript|typescript|css|html|react(?:js)?|vue(?:\.?js)?|angular|svelte|next\.js|nextjs|nuxt|remix|vite|webpack|tailwind)\b/i;

const AI_RE =
  /\b(?:artificial intelligence|generative ai|genai|machine learning|large language models?|llms?|chatgpt|gpt-?\d+|openai|anthropic|claude|gemini|copilot|a\.i\.|ai)\b/i;

export function isFrontendAiNews(article: Pick<FeedArticle, "title" | "summary">): boolean {
  const text = `${article.title} ${article.summary}`;
  return FRONTEND_RE.test(text) && AI_RE.test(text);
}
