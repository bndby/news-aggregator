import { config } from "../config";
import { getArticle, getMeta, markTelegramPost, saveArticle, saveTranslation, setMeta, wasPostedToChannel } from "../db";
import { translateArticle } from "../llm/client";
import { fetchGoogleNews } from "../sources/google-news";
import { fetchRssFeed } from "../sources/rss";
import { publishToTelegram } from "../telegram/client";
import type { Env, FeedArticle } from "../types";

export async function runPipeline(env: Env): Promise<{ added: number; failures: string[] }> {
  if (await ranTooRecently(env.DB)) return { added: 0, failures: [] };

  const results = await Promise.allSettled([
    ...config.topics.map(fetchGoogleNews),
    ...config.rssFeeds.map(fetchRssFeed),
  ]);
  const failures = results
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => String(result.reason));
  const articles = results
    .filter((result): result is PromiseFulfilledResult<FeedArticle[]> => result.status === "fulfilled")
    .flatMap((result) => result.value);

  let added = 0;
  for (const article of articles) {
    try {
      const articleId = await saveArticle(env.DB, article, await sha256(article.url));
      if (!articleId) continue;

      for (const language of config.languages.supported) {
        const translation = await translateArticle(article, language, env.OPENROUTER_API_KEY);
        await saveTranslation(env.DB, articleId, language, translation);
      }

      const defaultArticle = await getArticle(env.DB, articleId, config.languages.default);
      if (defaultArticle) await publishToChannels(env, defaultArticle);
      added++;
    } catch (error) {
      failures.push(`${article.url}: ${String(error)}`);
    }
  }

  await setMeta(env.DB, "last_run_at", new Date().toISOString());
  return { added, failures };
}

async function publishToChannels(env: Env, article: Awaited<ReturnType<typeof getArticle>>): Promise<void> {
  if (!article || !env.TELEGRAM_BOT_TOKEN) return;
  const channels = config.telegram.channels.filter((channel) =>
    channel.topics.includes("*") || channel.topics.includes(article.topic),
  );
  for (const channel of channels) {
    if (await wasPostedToChannel(env.DB, article.id, channel.chatId)) continue;
    const messageId = await publishToTelegram(env.TELEGRAM_BOT_TOKEN, channel.chatId, article, config.languages.default);
    await markTelegramPost(env.DB, article.id, channel.chatId, messageId);
  }
}

async function ranTooRecently(db: D1Database): Promise<boolean> {
  const lastRun = await getMeta(db, "last_run_at");
  if (!lastRun) return false;
  return Date.now() - new Date(lastRun).valueOf() < config.fetchIntervalMinutes * 60_000;
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
