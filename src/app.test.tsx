import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "./config";
import type { Article, Env } from "./types";
import { createMockD1 } from "./test/mock-d1";

const listArticles = vi.fn();
const getArticle = vi.fn();
const verifyTelegramSecret = vi.fn();
const runPipeline = vi.fn();

vi.mock("./db", () => ({ listArticles, getArticle }));
vi.mock("./telegram/client", () => ({ verifyTelegramSecret }));
vi.mock("./pipeline/run", () => ({ runPipeline }));

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

async function postWebhook(body: unknown, env: Env = createEnv()) {
  return app.request(
    "http://localhost/telegram/webhook",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    env,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  listArticles.mockResolvedValue([sampleArticle]);
  getArticle.mockResolvedValue(sampleArticle);
  verifyTelegramSecret.mockReturnValue(true);
  runPipeline.mockResolvedValue({ added: 2, failures: ["one"] });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("app routes", () => {
  it("redirects / to the default language", async () => {
    const response = await app.request("http://localhost/", {}, createEnv());
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`/${config.languages.default}`);
  });

  it("renders the feed for supported languages and filters by topic", async () => {
    const env = createEnv();
    listArticles.mockResolvedValueOnce([
      { ...sampleArticle, publishedAt: null },
    ]);
    const response = await app.request("http://localhost/ru?topic=frontend", {}, env);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(listArticles).toHaveBeenCalledWith(env.DB, "ru", "frontend");
    expect(html).toContain(`<html lang="ru">`);
    expect(html).toContain(`<title>Последние новости — ${config.site.name}</title>`);
    expect(html).toContain(`href="/styles.css"`);
    expect(html).toContain(`theme-color" content="#edf1ec"`);
    expect(html).toContain(`<a class="wordmark" href="/ru">${config.site.name}</a>`);
    expect(html).toContain(`aria-label="Language"`);
    expect(html).toContain(`<a href="/ru" class="current">RU</a>`);
    expect(html).toContain(`<a href="/en" class="">EN</a>`);
    expect(html).toContain(`<p class="eyebrow">Signal / RU</p>`);
    expect(html).toContain("<h1>Последние новости</h1>");
    expect(html).toContain("Отобранные новости на стыке frontend и искусственного интеллекта, переведённые для вас.");
    expect(html).toContain(`aria-label="Topics"`);
    expect(html).toContain(`<a href="/ru" class="">Все темы</a>`);
    expect(html).toContain(`<a href="/ru?topic=frontend" class="current">`);
    expect(html).toContain("Фронтенд");
    expect(html).toContain(`href="/ru/article/3"`);
    expect(html).toContain("Пример");
    expect(html).toContain("Краткое содержание");
    expect(html).toContain(`<span class="source">Example</span>`);
    expect(html).toContain("frontend");
    const expectedDate = new Intl.DateTimeFormat("ru", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date(sampleArticle.createdAt));
    expect(html).toContain(expectedDate);
  });

  it("marks all-topics as current when no topic filter is set", async () => {
    const html = await (await app.request("http://localhost/en", {}, createEnv())).text();
    expect(html).toContain(`<html lang="en">`);
    expect(html).toContain(`<a href="/en" class="current">EN</a>`);
    expect(html).toContain(`<a href="/en" class="current">All topics</a>`);
    expect(html).toContain(`<a href="/en?topic=frontend" class="">`);
    expect(html).toContain(`<p class="eyebrow">Signal / EN</p>`);
  });

  it("returns 404 for unsupported language routes", async () => {
    const response = await app.request("http://localhost/de", {}, createEnv());
    expect(response.status).toBe(404);
    expect(listArticles).not.toHaveBeenCalled();
  });

  it("renders an article page and 404s for missing articles", async () => {
    const env = createEnv();
    const ok = await app.request("http://localhost/en/article/3", {}, env);
    const html = await ok.text();

    expect(ok.status).toBe(200);
    expect(getArticle).toHaveBeenCalledWith(env.DB, 3, "en");
    expect(html).toContain(`<title>Пример — ${config.site.name}</title>`);
    expect(html).toContain(`<a class="back" href="/en">← Back to feed</a>`);
    expect(html).toContain("<h1>Пример</h1>");
    expect(html).toContain(`class="article-body"`);
    expect(html).toContain("<p>Краткое содержание</p>");
    expect(html).not.toContain(`class="lead"`);
    expect(html).toContain("Source:");
    expect(html).toContain(`href="https://example.com/story"`);
    expect(html).toContain(`target="_blank"`);
    expect(html).toContain(`rel="noreferrer"`);
    expect(html).toContain("Open original");

    getArticle.mockResolvedValueOnce(null);
    const missing = await app.request("http://localhost/en/article/999", {}, env);
    expect(missing.status).toBe(404);
  });

  it("shows the full article on the page and a short excerpt in the feed", async () => {
    getArticle.mockResolvedValueOnce({
      ...sampleArticle,
      summary: "First paragraph of the story.\n\nSecond paragraph continues in detail.",
    });
    const page = await (await app.request("http://localhost/ru/article/3", {}, createEnv())).text();
    expect(page).toContain("First paragraph of the story.");
    expect(page).toContain("Second paragraph continues in detail.");

    listArticles.mockResolvedValueOnce([{
      ...sampleArticle,
      summary: `${"Word ".repeat(120)}ENDMARK`,
    }]);
    const feed = await (await app.request("http://localhost/ru", {}, createEnv())).text();
    expect(feed).not.toContain("ENDMARK");
    expect(feed).toContain("Word Word");
  });

  it("replaces &nbsp; with a regular space on the feed and article page", async () => {
    listArticles.mockResolvedValueOnce([{
      ...sampleArticle,
      title: "A&nbsp;B",
      summary: "Hello&nbsp;world",
    }]);
    const feed = await (await app.request("http://localhost/ru", {}, createEnv())).text();
    expect(feed).toContain("A B");
    expect(feed).toContain("Hello world");
    expect(feed).not.toContain("&amp;nbsp;");
    expect(feed).not.toContain("&nbsp;");

    getArticle.mockResolvedValueOnce({ ...sampleArticle, summary: "Hello&nbsp;world" });
    const page = await (await app.request("http://localhost/ru/article/3", {}, createEnv())).text();
    expect(page).toContain("Hello world");
    expect(page).not.toContain("&amp;nbsp;");
    expect(page).not.toContain("&nbsp;");
  });

  it("falls back to createdAt when publishedAt is missing", async () => {
    getArticle.mockResolvedValueOnce({ ...sampleArticle, publishedAt: null });
    const html = await (await app.request("http://localhost/ru/article/3", {}, createEnv())).text();
    const expected = new Intl.DateTimeFormat("ru", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date(sampleArticle.createdAt));
    expect(html).toContain(expected);
    expect(html).toContain(`<a class="back" href="/ru">← К ленте</a>`);
  });

  it("rejects invalid article ids", async () => {
    const response = await app.request("http://localhost/ru/article/not-a-number", {}, createEnv());
    expect(response.status).toBe(404);
    expect(getArticle).not.toHaveBeenCalled();
  });

  it("rejects telegram webhooks with invalid secrets", async () => {
    verifyTelegramSecret.mockReturnValue(false);
    const response = await postWebhook({});
    expect(response.status).toBe(403);
    expect(await response.text()).toBe("Forbidden");
  });

  it("answers /start and acknowledges valid webhook updates", async () => {
    const fetchMock = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await postWebhook({ message: { text: "/start", chat: { id: 123 } } });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.telegram.org/bottg-token/sendMessage",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: 123,
          text: "Бот News Aggregator работает.",
        }),
      },
    );
  });

  it("acknowledges webhooks without sending a reply when /start guards fail", async () => {
    const fetchMock = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const cases = [
      {},
      { message: { text: "/help", chat: { id: 1 } } },
      { message: { text: "/start" } },
      { message: { text: "/start", chat: {} } },
    ];

    for (const body of cases) {
      const response = await postWebhook(body);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
    }

    const withoutToken = await postWebhook(
      { message: { text: "/start", chat: { id: 99 } } },
      createEnv({ TELEGRAM_BOT_TOKEN: "" }),
    );
    expect(await withoutToken.json()).toEqual({ ok: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows empty-state copy when there are no articles", async () => {
    listArticles.mockResolvedValueOnce([]);
    const html = await (await app.request("http://localhost/en", {}, createEnv())).text();
    expect(html).toContain(`<p class="empty">No news yet</p>`);
    expect(html).not.toContain(`class="news-item"`);
  });

  it("runs the pipeline from the internal endpoint when the shared secret matches", async () => {
    const env = createEnv();
    const response = await app.request(
      "http://localhost/internal/run",
      {
        method: "POST",
        headers: { "X-Telegram-Bot-Api-Secret-Token": "secret" },
      },
      env,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ added: 2, failures: ["one"] });
    expect(verifyTelegramSecret).toHaveBeenCalled();
    expect(runPipeline).toHaveBeenCalledWith(env, { force: true });
  });

  it("rejects internal pipeline runs without a configured or matching secret", async () => {
    verifyTelegramSecret.mockReturnValue(false);
    const forbidden = await app.request("http://localhost/internal/run", { method: "POST" }, createEnv());
    expect(forbidden.status).toBe(403);
    expect(runPipeline).not.toHaveBeenCalled();

    verifyTelegramSecret.mockReturnValue(true);
    const missingSecret = await app.request(
      "http://localhost/internal/run",
      { method: "POST" },
      createEnv({ TELEGRAM_WEBHOOK_SECRET: "" }),
    );
    expect(missingSecret.status).toBe(403);
    expect(runPipeline).not.toHaveBeenCalled();
  });
});
