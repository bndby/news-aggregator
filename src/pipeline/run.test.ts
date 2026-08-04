import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Article, Env, FeedArticle } from "../types";
import { createMockD1 } from "../test/mock-d1";

const fetchGoogleNews = vi.fn();
const fetchRssFeed = vi.fn();
const translateArticle = vi.fn();
const publishToTelegram = vi.fn();
const getArticle = vi.fn();
const getMeta = vi.fn();
const markTelegramPost = vi.fn();
const saveArticle = vi.fn();
const saveTranslation = vi.fn();
const setMeta = vi.fn();
const wasPostedToChannel = vi.fn();

vi.mock("../sources/google-news", () => ({ fetchGoogleNews }));
vi.mock("../sources/rss", () => ({ fetchRssFeed }));
vi.mock("../llm/client", () => ({ translateArticle }));
vi.mock("../telegram/client", () => ({ publishToTelegram }));
vi.mock("../db", () => ({
  getArticle,
  getMeta,
  markTelegramPost,
  saveArticle,
  saveTranslation,
  setMeta,
  wasPostedToChannel,
}));

vi.mock("../config", () => ({
  config: {
    fetchIntervalMinutes: 60,
    topics: [{ id: "frontend", query: "frontend" }],
    rssFeeds: [{ url: "https://example.com/feed", topic: "ai" }],
    languages: { default: "ru", supported: ["ru", "en"] },
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
      openrouterProviders: [],
      temperature: 0.2,
    },
  },
}));

const { runPipeline } = await import("./run");

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
  getMeta.mockResolvedValue(null);
  setMeta.mockResolvedValue(undefined);
  fetchGoogleNews.mockResolvedValue([feedArticle]);
  fetchRssFeed.mockResolvedValue([]);
  saveArticle.mockResolvedValue(11);
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

describe("runPipeline", () => {
  it("skips work when the last run was too recent", async () => {
    getMeta.mockResolvedValue(new Date().toISOString());
    const result = await runPipeline(createEnv());
    expect(result).toEqual({ added: 0, failures: [] });
    expect(fetchGoogleNews).not.toHaveBeenCalled();
    expect(setMeta).not.toHaveBeenCalled();
  });

  it("ingests feeds, translates, publishes, and records last_run_at", async () => {
    const env = createEnv();
    const result = await runPipeline(env);

    expect(result.added).toBe(1);
    expect(result.failures).toEqual([]);
    expect(fetchGoogleNews.mock.calls[0]?.[0]).toEqual({ id: "frontend", query: "frontend" });
    expect(fetchRssFeed.mock.calls[0]?.[0]).toEqual({ url: "https://example.com/feed", topic: "ai" });
    expect(saveArticle).toHaveBeenCalledWith(env.DB, feedArticle, expect.any(String));
    expect(translateArticle).toHaveBeenCalledTimes(2);
    expect(saveTranslation).toHaveBeenCalledTimes(2);
    expect(publishToTelegram).toHaveBeenCalledTimes(2);
    expect(publishToTelegram).toHaveBeenCalledWith("tg-token", "@all", storedArticle, "ru");
    expect(publishToTelegram).toHaveBeenCalledWith("tg-token", "@frontend-only", storedArticle, "ru");
    expect(publishToTelegram).not.toHaveBeenCalledWith("tg-token", "@ai-only", expect.anything(), expect.anything());
    expect(markTelegramPost).toHaveBeenCalledWith(env.DB, 11, "@all", 501);
    expect(setMeta).toHaveBeenCalledWith(env.DB, "last_run_at", expect.any(String));
  });

  it("skips duplicates and already-posted channels", async () => {
    saveArticle.mockResolvedValue(null);
    const result = await runPipeline(createEnv());
    expect(result.added).toBe(0);
    expect(translateArticle).not.toHaveBeenCalled();

    vi.clearAllMocks();
    getMeta.mockResolvedValue(null);
    fetchGoogleNews.mockResolvedValue([feedArticle]);
    fetchRssFeed.mockResolvedValue([]);
    saveArticle.mockResolvedValue(11);
    translateArticle.mockResolvedValue({ title: "T", summary: "S" });
    getArticle.mockResolvedValue(storedArticle);
    wasPostedToChannel.mockResolvedValue(true);
    setMeta.mockResolvedValue(undefined);

    const skipped = await runPipeline(createEnv());
    expect(skipped.added).toBe(1);
    expect(publishToTelegram).not.toHaveBeenCalled();
  });

  it("collects feed and per-article failures without aborting the run", async () => {
    fetchGoogleNews.mockRejectedValue(new Error("google down"));
    fetchRssFeed.mockResolvedValue([{ ...feedArticle, topic: "ai", url: "https://example.com/ai" }]);
    saveArticle.mockResolvedValue(22);
    getArticle.mockResolvedValue({ ...storedArticle, id: 22, topic: "ai", url: "https://example.com/ai" });
    translateArticle.mockRejectedValueOnce(new Error("llm failed"));

    const result = await runPipeline(createEnv());
    expect(result.added).toBe(0);
    expect(result.failures.some((failure) => failure.includes("google down"))).toBe(true);
    expect(result.failures.some((failure) => failure.includes("llm failed"))).toBe(true);
    expect(setMeta).toHaveBeenCalled();
  });

  it("does not publish when Telegram token is missing", async () => {
    await runPipeline(createEnv({ TELEGRAM_BOT_TOKEN: "" }));
    expect(publishToTelegram).not.toHaveBeenCalled();
  });
});
