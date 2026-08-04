import { afterEach, describe, expect, it, vi } from "vitest";
import { config } from "../config";
import type { FeedArticle } from "../types";
import { translateArticle } from "./client";

const article: FeedArticle = {
  url: "https://example.com/a",
  title: "Hello",
  summary: "World",
  source: "Example",
  topic: "ai",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("translateArticle", () => {
  it("sends a JSON translation request and parses the response", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () =>
        Response.json({
          choices: [{ message: { content: JSON.stringify({ title: "Привет", summary: "Мир" }) } }],
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const translation = await translateArticle(article, "ru", "api-key");

    expect(translation).toEqual({ title: "Привет", summary: "Мир" });
    expect(fetchMock).toHaveBeenCalledOnce();

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${config.llm.baseUrl}/chat/completions`);
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer api-key");

    const body = JSON.parse(String(init?.body)) as {
      model: string;
      temperature: number;
      response_format: { type: string };
      messages: Array<{ role: string; content: string }>;
      provider?: unknown;
    };
    expect(body.model).toBe(config.llm.model);
    expect(body.temperature).toBe(config.llm.temperature);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[0]?.role).toBe("system");
    expect(body.messages[0]?.content).toContain("ru");
    expect(JSON.parse(body.messages[1]!.content)).toEqual({ title: "Hello", summary: "World" });
    expect(body.provider).toBeUndefined();
  });

  it("strips markdown code fences before parsing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          choices: [{
            message: {
              content: "```json\n{\"title\":\"T\",\"summary\":\"S\"}\n```",
            },
          }],
        }),
      ),
    );

    await expect(translateArticle(article, "en", "key")).resolves.toEqual({
      title: "T",
      summary: "S",
    });
  });

  it("throws on non-OK HTTP responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("quota", { status: 429 })));
    await expect(translateArticle(article, "en", "key")).rejects.toThrow(/LLM returned 429/);
  });

  it("throws when the model returns empty content", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ choices: [{}] })));
    await expect(translateArticle(article, "en", "key")).rejects.toThrow(/no content/);
  });

  it("throws when translation JSON is missing fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          choices: [{ message: { content: JSON.stringify({ title: "Only title" }) } }],
        }),
      ),
    );
    await expect(translateArticle(article, "en", "key")).rejects.toThrow(/invalid translation/);
  });
});
