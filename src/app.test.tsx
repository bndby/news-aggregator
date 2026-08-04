import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Article, Env } from "./types";
import { createMockD1 } from "./test/mock-d1";

const listArticles = vi.fn();
const getArticle = vi.fn();
const verifyTelegramSecret = vi.fn();

vi.mock("./db", () => ({ listArticles, getArticle }));
vi.mock("./telegram/client", () => ({ verifyTelegramSecret }));

const { app } = await import("./app");

const sampleArticle: Article = {
  id: 3,
  url: "https://example.com/story",
  source: "Example",
  topic: "frontend",
  publishedAt: "2026-08-01T00:00:00.000Z",
  createdAt: "2026-08-01T01:00:00.000Z",
  title: "Пример",
  summary: "Краткое содержание",
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
  listArticles.mockResolvedValue([sampleArticle]);
  getArticle.mockResolvedValue(sampleArticle);
  verifyTelegramSecret.mockReturnValue(true);
});

describe("app routes", () => {
  it("redirects / to the default language", async () => {
    const response = await app.request("http://localhost/", {}, createEnv());
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/ru");
  });

  it("renders the feed for supported languages and filters by topic", async () => {
    const env = createEnv();
    const response = await app.request("http://localhost/ru?topic=frontend", {}, env);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(listArticles).toHaveBeenCalledWith(env.DB, "ru", "frontend");
    expect(html).toContain("Signal / News");
    expect(html).toContain("Пример");
    expect(html).toContain("Последние новости");
  });

  it("returns 404 for unsupported language routes", async () => {
    const response = await app.request("http://localhost/de", {}, createEnv());
    expect(response.status).toBe(404);
    expect(listArticles).not.toHaveBeenCalled();
  });

  it("renders an article page and 404s for missing articles", async () => {
    const env = createEnv();
    const ok = await app.request("http://localhost/en/article/3", {}, env);
    expect(ok.status).toBe(200);
    expect(getArticle).toHaveBeenCalledWith(env.DB, 3, "en");
    expect(await ok.text()).toContain("Краткое содержание");

    getArticle.mockResolvedValueOnce(null);
    const missing = await app.request("http://localhost/en/article/999", {}, env);
    expect(missing.status).toBe(404);
  });

  it("rejects invalid article ids", async () => {
    const response = await app.request("http://localhost/ru/article/not-a-number", {}, createEnv());
    expect(response.status).toBe(404);
    expect(getArticle).not.toHaveBeenCalled();
  });

  it("rejects telegram webhooks with invalid secrets", async () => {
    verifyTelegramSecret.mockReturnValue(false);
    const response = await app.request("http://localhost/telegram/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }, createEnv());
    expect(response.status).toBe(403);
  });

  it("answers /start and acknowledges valid webhook updates", async () => {
    const fetchMock = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await app.request("http://localhost/telegram/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: { text: "/start", chat: { id: 123 } } }),
    }, createEnv());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.telegram.org/bottg-token/sendMessage",
      expect.objectContaining({ method: "POST" }),
    );

    vi.unstubAllGlobals();
  });

  it("shows empty-state copy when there are no articles", async () => {
    listArticles.mockResolvedValueOnce([]);
    const response = await app.request("http://localhost/en", {}, createEnv());
    expect(await response.text()).toContain("No news yet");
  });
});
