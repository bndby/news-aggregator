export type FeedArticle = {
  url: string;
  title: string;
  summary: string;
  source: string;
  topic: string;
  publishedAt?: string;
};

export type Article = {
  id: number;
  url: string;
  source: string;
  topic: string;
  publishedAt: string | null;
  createdAt: string;
  title: string;
  summary: string;
};

export type Translation = Pick<Article, "title" | "summary">;

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  OPENROUTER_API_KEY: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
}
