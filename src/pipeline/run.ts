import { config } from "../config";
import {
  getArticle,
  getMeta,
  hasTranslation,
  listPendingArticles,
  markTelegramPost,
  saveTranslation,
  setMeta,
  upsertArticle,
  wasPostedToChannel,
} from "../db";
import { translateArticle } from "../llm/client";
import { fetchGoogleNews } from "../sources/google-news";
import { fetchRssFeed } from "../sources/rss";
import { publishToTelegram } from "../telegram/client";
import type { Env, FeedArticle, Translation } from "../types";

/** Overlap guard only. Hourly cron is the real interval; a 60-minute lock skipped every other hour. */
const MIN_RERUN_INTERVAL_MS = 5 * 60_000;

export async function runPipeline(
  env: Env,
  options: { force?: boolean } = {},
): Promise<{ added: number; failures: string[] }> {
  if (!options.force && await ranTooRecently(env.DB)) return { added: 0, failures: [] };
  await setMeta(env.DB, "last_run_at", new Date().toISOString());

  const results = await Promise.allSettled([
    ...config.topics.map(fetchGoogleNews),
    ...config.rssFeeds.map(fetchRssFeed),
  ]);
  const failures = results
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => String(result.reason));
  const selectedFeeds = selectArticlesForRun(
    results
      .filter((result): result is PromiseFulfilledResult<FeedArticle[]> => result.status === "fulfilled")
      .flatMap((result) => result.value),
    config.maxArticlesPerRun,
  );
  const pending = await listPendingArticles(
    env.DB,
    config.languages.source,
    config.languages.supported,
    config.maxArticlesPerRun,
  );
  const articles = mergeArticlesForRun(pending, selectedFeeds, config.maxArticlesPerRun);

  let added = 0;
  for (const article of articles) {
    try {
      if (await processArticle(env, article, failures)) added++;
    } catch (error) {
      failures.push(`${article.url}: ${String(error)}`);
    }
  }

  return { added, failures };
}

export function selectArticlesForRun(articles: FeedArticle[], limit: number): FeedArticle[] {
  const seen = new Set<string>();
  const unique = articles.filter((article) => {
    if (seen.has(article.url)) return false;
    seen.add(article.url);
    return true;
  });

  unique.sort((left, right) => {
    const leftTime = left.publishedAt ? Date.parse(left.publishedAt) : 0;
    const rightTime = right.publishedAt ? Date.parse(right.publishedAt) : 0;
    return rightTime - leftTime;
  });

  return unique.slice(0, Math.max(0, limit));
}

/** Pending rows first so incomplete translations and Telegram posts are retried even after they leave the RSS window. */
export function mergeArticlesForRun(
  pending: FeedArticle[],
  fromFeeds: FeedArticle[],
  limit: number,
): FeedArticle[] {
  const feedByUrl = new Map(fromFeeds.map((article) => [article.url, article]));
  const merged: FeedArticle[] = [];
  const seen = new Set<string>();

  for (const article of pending) {
    if (merged.length >= limit) break;
    const chosen = feedByUrl.get(article.url) ?? article;
    if (!chosen.title) continue;
    merged.push(chosen);
    seen.add(chosen.url);
  }

  for (const article of fromFeeds) {
    if (merged.length >= limit) break;
    if (seen.has(article.url)) continue;
    merged.push(article);
    seen.add(article.url);
  }

  return merged;
}

async function processArticle(env: Env, article: FeedArticle, failures: string[]): Promise<boolean> {
  const { id: articleId, created } = await upsertArticle(env.DB, article, await sha256(article.url));
  let changed = created;

  const ensureLanguage = async (language: string): Promise<void> => {
    if (await hasTranslation(env.DB, articleId, language)) return;
    const translation = await translationForLanguage(article, language, env.OPENROUTER_API_KEY, failures);
    await saveTranslation(env.DB, articleId, language, translation);
    changed = true;
  };

  // Persist the source text before calling the LLM so a later run can recover it.
  await ensureLanguage(config.languages.source);
  await ensureLanguage(config.languages.default);
  await publishDefaultLanguage(env, articleId, article.url, failures);

  for (const language of config.languages.supported) {
    if (language === config.languages.default || language === config.languages.source) continue;
    await ensureLanguage(language);
  }

  return changed;
}

async function translationForLanguage(
  article: FeedArticle,
  language: string,
  apiKey: string,
  failures: string[],
): Promise<Translation> {
  if (language === config.languages.source) return fallbackTranslation(article);
  if (!apiKey) {
    failures.push(`${article.url} [${language}]: missing OPENROUTER_API_KEY`);
    return fallbackTranslation(article);
  }
  try {
    return await translateArticle(article, language, apiKey);
  } catch (error) {
    failures.push(`${article.url} [${language}]: ${String(error)}`);
    return fallbackTranslation(article);
  }
}

function fallbackTranslation(article: FeedArticle): Translation {
  const title = article.title.trim();
  const summary = article.summary.trim() || title;
  if (!title) throw new Error("Article has no title to store as a fallback translation");
  return { title, summary };
}

async function publishDefaultLanguage(
  env: Env,
  articleId: number,
  articleUrl: string,
  failures: string[],
): Promise<void> {
  const defaultArticle = await getArticle(env.DB, articleId, config.languages.default);
  if (!defaultArticle) {
    failures.push(`${articleUrl}: missing ${config.languages.default} translation`);
    return;
  }
  try {
    await publishToChannels(env, defaultArticle);
  } catch (error) {
    failures.push(`${articleUrl} [telegram]: ${String(error)}`);
  }
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
  return Date.now() - new Date(lastRun).valueOf() < MIN_RERUN_INTERVAL_MS;
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
