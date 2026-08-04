import { afterEach, describe, expect, it, vi } from "vitest";
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

    const body = JSON.parse(String(init?.body)) as {
      chat_id: string;
      text: string;
      parse_mode: string;
      disable_web_page_preview: boolean;
    };
    expect(body.chat_id).toBe("@channel");
    expect(body.parse_mode).toBe("HTML");
    expect(body.disable_web_page_preview).toBe(true);
    expect(body.text).toContain("<b>Title with &lt;tags&gt; &amp; quotes&quot;</b>");
    expect(body.text).toContain("Summary &amp; more");
    expect(body.text).toContain("Источник: Example &lt;News&gt;");
    expect(body.text).toContain("/ru/article/42");
    expect(body.text.length).toBeLessThanOrEqual(4096);
  });

  it("throws when Telegram API returns an error status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    await expect(publishToTelegram("token", "@channel", article, "en")).rejects.toThrow(
      /Telegram returned 500/,
    );
  });

  it("throws when Telegram response has no message id", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: false })));
    await expect(publishToTelegram("token", "@channel", article, "en")).rejects.toThrow(
      /did not return message id/,
    );
  });
});
