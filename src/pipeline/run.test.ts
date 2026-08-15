import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Article, Env, FeedArticle } from "../types";
import { createMockD1 } from "../test/mock-d1";

const fetchGoogleNews = vi.fn();
const fetchRssFeed = vi.fn();
const translateArticle = vi.fn();
const publishToTelegram = vi.fn();
const getArticle = vi.fn();
const getMeta = vi.fn();
const hasTranslation = vi.fn();
const listPendingArticles = vi.fn();
const markTelegramPost = vi.fn();
const saveTranslation = vi.fn();
const setMeta = vi.fn();
const upsertArticle = vi.fn();
const wasPostedToChannel = vi.fn();

vi.mock("../sources/google-news", () => ({ fetchGoogleNews }));
vi.mock("../sources/rss", () => ({ fetchRssFeed }));
vi.mock("../llm/client", () => ({ translateArticle }));
vi.mock("../telegram/client", () => ({ publishToTelegram }));
vi.mock("../db", () => ({
  getArticle,
  getMeta,
  hasTranslation,
  listPendingArticles,
  markTelegramPost,
  saveTranslation,
  setMeta,
  upsertArticle,
  wasPostedToChannel,
}));

vi.mock("../config", () => ({
  config: {
    fetchIntervalMinutes: 60,
    maxArticlesPerRun: 5,
    topics: [{ id: "frontend", query: "frontend" }],
    rssFeeds: [{ url: "https://example.com/feed", topic: "ai" }],
    languages: { default: "ru", supported: ["ru", "en"], source: "en" },
    telegram: {
      channels: [
        { chatId: "@all", topics: ["*"] },
        { chatId: "@frontend-only", topics: ["frontend"] },
        { chatId: "@ai-only", topics: ["ai"] },
      ],
    },
    site: { name: "Signal", url: "https://example.com", itemsPerPage: 20 },
    llm: {
      provider: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "test-model",
      fallbackModels: [],
      openrouterProviders: [],
      temperature: 0.2,
    },
  },
}));

const { runPipeline, selectArticlesForRun, mergeArticlesForRun } = await import("./run");

const feedArticle: FeedArticle = {
  url: "https://example.com/story",
  title: "Story",
  summary: "Summary",
  source: "Example",
  topic: "frontend",
  publishedAt: "2026-08-01T00:00:00.000Z",
};

const storedArticle: Article = {
  id: 11,
  url: feedArticle.url,
  source: feedArticle.source,
  topic: feedArticle.topic,
  publishedAt: feedArticle.publishedAt ?? null,
  createdAt: "2026-08-01T01:00:00.000Z",
  title: "История",
  summary: "Кратко",
};

function createEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: createMockD1(),
    ASSETS: { fetch: vi.fn() } as unknown as Fetcher,
    OPENROUTER_API_KEY: "llm-key",
    TELEGRAM_BOT_TOKEN: "tg-token",
    TELEGRAM_WEBHOOK_SECRET: "secret",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getMeta.mockImplementation(async (_db, key: string) => {
    if (key === "last_run_at") return null;
    return new Date().toISOString();
  });
  setMeta.mockResolvedValue(undefined);
  fetchGoogleNews.mockResolvedValue([feedArticle]);
  fetchRssFeed.mockResolvedValue([]);
  listPendingArticles.mockResolvedValue([]);
  upsertArticle.mockResolvedValue({ id: 11, created: true });
  hasTranslation.mockResolvedValue(false);
  translateArticle.mockImplementation(async (_article, language: string) => ({
    title: language === "ru" ? "История" : "Story",
    summary: language === "ru" ? "Кратко" : "Summary",
  }));
  saveTranslation.mockResolvedValue(undefined);
  getArticle.mockResolvedValue(storedArticle);
  wasPostedToChannel.mockResolvedValue(false);
  publishToTelegram.mockResolvedValue(501);
  markTelegramPost.mockResolvedValue(undefined);
});

describe("selectArticlesForRun", () => {
  it("deduplicates, sorts by newest publishedAt, and applies the limit", () => {
    const selected = selectArticlesForRun(
      [
        { ...feedArticle, url: "https://example.com/old", publishedAt: "2026-08-01T00:00:00.000Z" },
        { ...feedArticle, url: "https://example.com/new", publishedAt: "2026-08-03T00:00:00.000Z" },
        { ...feedArticle, url: "https://example.com/new", publishedAt: "2026-08-03T00:00:00.000Z" },
        { ...feedArticle, url: "https://example.com/mid", publishedAt: "2026-08-02T00:00:00.000Z" },
      ],
      2,
    );
    expect(selected.map((article) => article.url)).toEqual([
      "https://example.com/new",
      "https://example.com/mid",
    ]);
  });
});

describe("mergeArticlesForRun", () => {
  it("prefers pending articles and replaces them with fresher feed copies", () => {
    const pending = [
      { ...feedArticle, url: "https://example.com/pending", title: "Old pending" },
      { ...feedArticle, url: "https://example.com/both", title: "Stale" },
    ];
    const fromFeeds = [
      { ...feedArticle, url: "https://example.com/both", title: "Fresh from RSS" },
      { ...feedArticle, url: "https://example.com/new", title: "Brand new" },
    ];

    expect(mergeArticlesForRun(pending, fromFeeds, 3).map((article) => [article.url, article.title])).toEqual([
      ["https://example.com/pending", "Old pending"],
      ["https://example.com/both", "Fresh from RSS"],
      ["https://example.com/new", "Brand new"],
    ]);
  });
});

describe("runPipeline", () => {
  it("skips work when the last run was too recent", async () => {
    getMeta.mockImplementation(async (_db, key: string) => {
      if (key === "last_run_at") return new Date().toISOString();
      return null;
    });
    const result = await runPipeline(createEnv());
    expect(result).toEqual({ added: 0, failures: [] });
    expect(fetchGoogleNews).not.toHaveBeenCalled();
    expect(setMeta).not.toHaveBeenCalled();
  });

  it("ignores the overlap guard when force is set", async () => {
    getMeta.mockImplementation(async (_db, key: string) => {
      if (key === "last_run_at") return new Date().toISOString();
      return null;
    });
    await runPipeline(createEnv(), { force: true });
    expect(fetchGoogleNews).toHaveBeenCalledOnce();
    expect(setMeta).toHaveBeenCalled();
  });

  it("ingests feeds, translates the default language, copies the source language, and publishes", async () => {
    const env = createEnv();
    const result = await runPipeline(env);

    expect(result.added).toBe(1);
    expect(result.failures).toEqual([]);
    expect(fetchGoogleNews.mock.calls[0]?.[0]).toEqual({ id: "frontend", query: "frontend" });
    expect(fetchRssFeed.mock.calls[0]?.[0]).toEqual({ url: "https://example.com/feed", topic: "ai" });
    expect(listPendingArticles).toHaveBeenCalledWith(env.DB, "en", ["ru", "en"], 5);
    expect(upsertArticle).toHaveBeenCalledWith(env.DB, feedArticle, expect.any(String));
    expect(translateArticle).toHaveBeenCalledTimes(1);
    expect(translateArticle).toHaveBeenCalledWith(feedArticle, "ru", "llm-key");
    expect(saveTranslation).toHaveBeenCalledTimes(2);
    expect(saveTranslation).toHaveBeenNthCalledWith(1, env.DB, 11, "en", {
      title: "Story",
      summary: "Summary",
    });
    expect(saveTranslation).toHaveBeenNthCalledWith(2, env.DB, 11, "ru", {
      title: "История",
      summary: "Кратко",
    });
    expect(publishToTelegram).toHaveBeenCalledTimes(2);
    expect(publishToTelegram).toHaveBeenCalledWith("tg-token", "@all", storedArticle, "ru");
    expect(publishToTelegram).toHaveBeenCalledWith("tg-token", "@frontend-only", storedArticle, "ru");
    expect(publishToTelegram).not.toHaveBeenCalledWith("tg-token", "@ai-only", expect.anything(), expect.anything());
    expect(markTelegramPost).toHaveBeenCalledWith(env.DB, 11, "@all", 501);
    expect(setMeta).toHaveBeenCalledWith(env.DB, "last_run_at", expect.any(String));
    expect(setMeta.mock.invocationCallOrder[0]).toBeLessThan(upsertArticle.mock.invocationCallOrder[0]);
    expect(saveTranslation.mock.invocationCallOrder[1]).toBeLessThan(publishToTelegram.mock.invocationCallOrder[0]);
  });

  it("retries missing translations for existing articles and still publishes", async () => {
    upsertArticle.mockResolvedValue({ id: 11, created: false });
    hasTranslation.mockImplementation(async (_db, _id, language: string) => language === "en");

    const result = await runPipeline(createEnv());

    expect(result.added).toBe(1);
    expect(translateArticle).toHaveBeenCalledTimes(1);
    expect(translateArticle).toHaveBeenCalledWith(feedArticle, "ru", "llm-key");
    expect(publishToTelegram).toHaveBeenCalled();
  });

  it("skips fully processed duplicates and already-posted channels", async () => {
    upsertArticle.mockResolvedValue({ id: 11, created: false });
    hasTranslation.mockResolvedValue(true);
    wasPostedToChannel.mockResolvedValue(true);

    const result = await runPipeline(createEnv());
    expect(result.added).toBe(0);
    expect(translateArticle).not.toHaveBeenCalled();
    expect(publishToTelegram).not.toHaveBeenCalled();
  });

  it("publishes even when the LLM fails by storing the original text", async () => {
    translateArticle.mockRejectedValue(new Error("llm failed"));

    const env = createEnv();
    const result = await runPipeline(env);

    expect(result.added).toBe(1);
    expect(result.failures.some((failure) => failure.includes("llm failed"))).toBe(true);
    expect(saveTranslation).toHaveBeenCalledWith(env.DB, 11, "ru", {
      title: "Story",
      summary: "Summary",
    });
    expect(saveTranslation).toHaveBeenNthCalledWith(1, env.DB, 11, "en", {
      title: "Story",
      summary: "Summary",
    });
    expect(publishToTelegram).toHaveBeenCalled();
  });

  it("collects feed failures without aborting the run", async () => {
    fetchGoogleNews.mockRejectedValue(new Error("google down"));
    fetchRssFeed.mockResolvedValue([{ ...feedArticle, topic: "ai", url: "https://example.com/ai" }]);
    upsertArticle.mockResolvedValue({ id: 22, created: true });
    getArticle.mockResolvedValue({ ...storedArticle, id: 22, topic: "ai", url: "https://example.com/ai" });

    const result = await runPipeline(createEnv());
    expect(result.added).toBe(1);
    expect(result.failures.some((failure) => failure.includes("google down"))).toBe(true);
    expect(setMeta).toHaveBeenCalled();
  });

  it("does not publish when Telegram token is missing", async () => {
    await runPipeline(createEnv({ TELEGRAM_BOT_TOKEN: "" }));
    expect(publishToTelegram).not.toHaveBeenCalled();
  });

  it("skips publishing when the default-language article is missing", async () => {
    getArticle.mockResolvedValue(null);
    const result = await runPipeline(createEnv());
    expect(result.added).toBe(1);
    expect(result.failures.some((failure) => failure.includes("missing ru translation"))).toBe(true);
    expect(publishToTelegram).not.toHaveBeenCalled();
    expect(setMeta).toHaveBeenCalled();
  });

  it("processes incomplete rows from the database even if they left the RSS window", async () => {
    fetchGoogleNews.mockResolvedValue([]);
    const pending = {
      ...feedArticle,
      url: "https://example.com/stuck",
      title: "Stuck RU title",
      summary: "Stuck RU summary",
    };
    listPendingArticles.mockResolvedValue([pending]);
    upsertArticle.mockResolvedValue({ id: 44, created: false });
    hasTranslation.mockImplementation(async (_db, _id, language: string) => language === "ru");
    getArticle.mockResolvedValue({ ...storedArticle, id: 44, url: pending.url });

    const result = await runPipeline(createEnv());

    expect(result.added).toBe(1);
    expect(upsertArticle).toHaveBeenCalledWith(expect.anything(), pending, expect.any(String));
    expect(translateArticle).not.toHaveBeenCalled();
    expect(saveTranslation).toHaveBeenCalledWith(expect.anything(), 44, "en", {
      title: "Stuck RU title",
      summary: "Stuck RU summary",
    });
    expect(publishToTelegram).toHaveBeenCalled();
  });

  it("limits how many feed items are processed per run", async () => {
    const many = Array.from({ length: 8 }, (_, index) => ({
      ...feedArticle,
      url: `https://example.com/${index}`,
      publishedAt: `2026-08-0${Math.min(index + 1, 9)}T00:00:00.000Z`,
    }));
    fetchGoogleNews.mockResolvedValue(many);
    upsertArticle.mockImplementation(async (_db, article: FeedArticle) => ({
      id: Number(article.url.split("/").pop()),
      created: true,
    }));
    getArticle.mockImplementation(async (_db, id: number) => ({ ...storedArticle, id }));

    await runPipeline(createEnv());
    expect(upsertArticle).toHaveBeenCalledTimes(5);
  });

  it("uses a five-minute overlap guard instead of skipping the next hourly cron", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-04T12:00:00.000Z"));

    getMeta.mockImplementation(async (_db, key: string) => {
      if (key === "last_run_at") return "2026-08-04T11:55:01.000Z";
      return null;
    });
    await expect(runPipeline(createEnv())).resolves.toEqual({ added: 0, failures: [] });
    expect(fetchGoogleNews).not.toHaveBeenCalled();

    getMeta.mockImplementation(async (_db, key: string) => {
      if (key === "last_run_at") return "2026-08-04T11:55:00.000Z";
      return null;
    });
    fetchGoogleNews.mockResolvedValue([]);
    fetchRssFeed.mockResolvedValue([]);
    const atBoundary = await runPipeline(createEnv());
    expect(atBoundary).toEqual({ added: 0, failures: [] });
    expect(fetchGoogleNews).toHaveBeenCalledOnce();
    expect(setMeta).toHaveBeenCalledWith(expect.anything(), "last_run_at", "2026-08-04T12:00:00.000Z");

    vi.clearAllMocks();
    getMeta.mockImplementation(async (_db, key: string) => {
      if (key === "last_run_at") return "2026-08-04T11:54:59.000Z";
      return null;
    });
    fetchGoogleNews.mockResolvedValue([]);
    fetchRssFeed.mockResolvedValue([]);
    setMeta.mockResolvedValue(undefined);
    await runPipeline(createEnv());
    expect(fetchGoogleNews).toHaveBeenCalledOnce();

    vi.useRealTimers();
  });

  it("hashes article urls with sha-256 hex digests", async () => {
    const env = createEnv();
    await runPipeline(env);

    const expected = [...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(feedArticle.url)),
    )].map((byte) => byte.toString(16).padStart(2, "0")).join("");

    expect(upsertArticle).toHaveBeenCalledWith(env.DB, feedArticle, expected);
  });
});
