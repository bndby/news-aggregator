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

  it("skips publishing when the default-language article is missing", async () => {
    getArticle.mockResolvedValue(null);
    const result = await runPipeline(createEnv());
    expect(result.added).toBe(1);
    expect(publishToTelegram).not.toHaveBeenCalled();
    expect(setMeta).toHaveBeenCalled();
  });

  it("uses a strict fetch-interval boundary for ranTooRecently", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-04T12:00:00.000Z"));

    getMeta.mockResolvedValue("2026-08-04T11:01:00.000Z");
    await expect(runPipeline(createEnv())).resolves.toEqual({ added: 0, failures: [] });
    expect(fetchGoogleNews).not.toHaveBeenCalled();

    getMeta.mockResolvedValue("2026-08-04T11:00:00.000Z");
    fetchGoogleNews.mockResolvedValue([]);
    fetchRssFeed.mockResolvedValue([]);
    const atBoundary = await runPipeline(createEnv());
    expect(atBoundary).toEqual({ added: 0, failures: [] });
    expect(fetchGoogleNews).toHaveBeenCalledOnce();
    expect(setMeta).toHaveBeenCalledWith(expect.anything(), "last_run_at", "2026-08-04T12:00:00.000Z");

    vi.clearAllMocks();
    getMeta.mockResolvedValue("2026-08-04T10:59:59.000Z");
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

    expect(saveArticle).toHaveBeenCalledWith(env.DB, feedArticle, expected);
  });
});