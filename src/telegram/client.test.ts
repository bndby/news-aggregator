import { afterEach, describe, expect, it, vi } from "vitest";
import { config } from "../config";
import type { Article } from "../types";
import { publishToTelegram, verifyTelegramSecret } from "./client";

const article: Article = {
  id: 42,
  url: "https://example.com/news?a=1&b=2",
  source: "Example <News>",
  topic: "frontend",
  publishedAt: "2026-08-01T10:00:00.000Z",
  createdAt: "2026-08-01T11:00:00.000Z",
  title: "Title with <tags> & quotes\"",
  summary: "Summary & more",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("verifyTelegramSecret", () => {
  it("allows all requests when secret is not configured", () => {
    const request = new Request("https://example.com/telegram/webhook");
    expect(verifyTelegramSecret(request)).toBe(true);
    expect(verifyTelegramSecret(request, "")).toBe(true);
  });

  it("accepts matching secret header", () => {
    const request = new Request("https://example.com/telegram/webhook", {
      headers: { "X-Telegram-Bot-Api-Secret-Token": "secret" },
    });
    expect(verifyTelegramSecret(request, "secret")).toBe(true);
  });

  it("rejects mismatched or missing secret header", () => {
    const request = new Request("https://example.com/telegram/webhook");
    expect(verifyTelegramSecret(request, "secret")).toBe(false);

    const wrong = new Request("https://example.com/telegram/webhook", {
      headers: { "X-Telegram-Bot-Api-Secret-Token": "wrong" },
    });
    expect(verifyTelegramSecret(wrong, "secret")).toBe(false);
  });
});

describe("publishToTelegram", () => {
  it("posts an escaped HTML message and returns message id", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => Response.json({ ok: true, result: { message_id: 99 } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const messageId = await publishToTelegram("token", "@channel", article, "ru");

    expect(messageId).toBe(99);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.telegram.org/bottoken/sendMessage");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({ "Content-Type": "application/json" });

    const body = JSON.parse(String(init?.body)) as {
      chat_id: string;
      text: string;
      parse_mode: string;
      disable_web_page_preview: boolean;
    };
    expect(body.chat_id).toBe("@channel");
    expect(body.parse_mode).toBe("HTML");
    expect(body.disable_web_page_preview).toBe(true);
    expect(body.text).toBe(
      [
        "<b>Title with &lt;tags&gt; &amp; quotes&quot;</b>",
        "",
        "Summary &amp; more",
        "",
        `<a href="https://example.com/news?a=1&amp;b=2">Источник: Example &lt;News&gt;</a> · <a href="${config.site.url}/ru/article/42">Читать на сайте</a>`,
      ].join("\n"),
    );
    expect(body.text.length).toBeLessThanOrEqual(4096);
  });

  it("truncates messages to Telegram's 4096 character limit", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => Response.json({ ok: true, result: { message_id: 1 } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await publishToTelegram("token", "@channel", {
      ...article,
      title: "T".repeat(5000),
    }, "en");

    const init = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(String(init?.body)) as { text: string };
    expect(body.text).toHaveLength(4096);
  });

  it("posts a short excerpt instead of the full article body", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => Response.json({ ok: true, result: { message_id: 2 } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await publishToTelegram("token", "@channel", {
      ...article,
      summary: `${"A detailed paragraph of the article. ".repeat(30)}UNIQUE_ENDING`,
    }, "ru");

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { text: string };
    expect(body.text).not.toContain("UNIQUE_ENDING");
    expect(body.text).toContain("Читать на сайте");
    expect(body.text.length).toBeLessThan(4096);
  });

  it("replaces &nbsp; with a regular space in the Telegram payload", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => Response.json({ ok: true, result: { message_id: 3 } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await publishToTelegram("token", "@channel", {
      ...article,
      title: "Hello&nbsp;there",
      summary: "Line&nbsp;one",
      source: "Wired&nbsp;News",
    }, "ru");

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { text: string };
    expect(body.text).toContain("Hello there");
    expect(body.text).toContain("Line one");
    expect(body.text).toContain("Wired News");
    expect(body.text).not.toContain("&nbsp;");
    expect(body.text).not.toContain("&amp;nbsp;");
  });

  it("throws when Telegram API returns an error status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    await expect(publishToTelegram("token", "@channel", article, "en")).rejects.toThrow(
      /Telegram returned 500/,
    );
  });

  it("throws when Telegram response has no usable message id", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: false })));
    await expect(publishToTelegram("token", "@channel", article, "en")).rejects.toThrow(
      /did not return message id/,
    );

    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true })));
    await expect(publishToTelegram("token", "@channel", article, "en")).rejects.toThrow(
      /did not return message id/,
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ ok: false, result: { message_id: 7 } })),
    );
    await expect(publishToTelegram("token", "@channel", article, "en")).rejects.toThrow(
      /did not return message id/,
    );
  });
});
