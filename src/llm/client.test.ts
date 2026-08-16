import { afterEach, describe, expect, it, vi } from "vitest";
import { config } from "../config";
import type { FeedArticle } from "../types";
import { translateArticle, isActualTranslation } from "./client";

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
  config.llm.openrouterProviders.length = 0;
});

function stubJson(payload: unknown) {
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
    async () => Response.json(payload),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("translateArticle", () => {
  it("sends a JSON translation request and parses the response", async () => {
    const fetchMock = stubJson({
      choices: [{ message: { content: JSON.stringify({ title: "Привет", summary: "Мир" }) } }],
    });

    const translation = await translateArticle(article, "ru", "api-key");

    expect(translation).toEqual({ title: "Привет", summary: "Мир" });
    expect(fetchMock).toHaveBeenCalledOnce();

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${config.llm.baseUrl}/chat/completions`);
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({
      Authorization: "Bearer api-key",
      "Content-Type": "application/json",
      "HTTP-Referer": config.site.url,
      "X-OpenRouter-Title": config.site.name,
    });

    const body = JSON.parse(String(init?.body)) as {
      model: string;
      models?: string[];
      temperature: number;
      max_tokens: number;
      response_format: { type: string };
      messages: Array<{ role: string; content: string }>;
      provider?: { order: string[] };
    };
    expect(body.model).toBe(config.llm.model);
    expect(body.models).toEqual(config.llm.fallbackModels);
    expect(body.temperature).toBe(config.llm.temperature);
    expect(body.max_tokens).toBe(4000);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[0]?.role).toBe("system");
    expect(body.messages[0]?.content).toContain("ru");
    expect(body.messages[0]?.content).toContain('{"title":"...","summary":"..."}');
    expect(body.messages[0]?.content).toContain("complete article body");
    expect(JSON.parse(body.messages[1]!.content)).toEqual({ title: "Hello", summary: "World" });
    expect(body.provider).toBeUndefined();
  });

  it("extracts JSON when the model wraps it in prose", async () => {
    stubJson({
      choices: [{
        message: { content: "Sure.\n{\"title\":\"T\",\"summary\":\"S\"}\nThanks." },
      }],
    });
    await expect(translateArticle(article, "en", "key")).resolves.toEqual({
      title: "T",
      summary: "S",
    });
  });

  it("includes OpenRouter provider routing when configured", async () => {
    config.llm.openrouterProviders.push("Together");
    const fetchMock = stubJson({
      choices: [{ message: { content: JSON.stringify({ title: "T", summary: "S" }) } }],
    });

    await translateArticle(article, "en", "key");

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      provider?: { order: string[] };
    };
    expect(body.provider).toEqual({ order: ["Together"] });
  });

  it("strips markdown code fences before parsing", async () => {
    const payloads = [
      "```json\n{\"title\":\"T\",\"summary\":\"S\"}\n```",
      "```JSON\n{\"title\":\"T\",\"summary\":\"S\"}\n```",
      "```\n{\"title\":\"T\",\"summary\":\"S\"}\n```",
      "{\"title\":\"T\",\"summary\":\"S\"}\n```",
    ];

    for (const content of payloads) {
      stubJson({ choices: [{ message: { content } }] });
      await expect(translateArticle(article, "en", "key")).resolves.toEqual({
        title: "T",
        summary: "S",
      });
    }
  });

  it("throws on non-OK HTTP responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("quota", { status: 429 })));
    await expect(translateArticle(article, "en", "key")).rejects.toThrow(/LLM returned 429/);
  });

  it("throws when the model returns empty or malformed choices", async () => {
    stubJson({});
    await expect(translateArticle(article, "en", "key")).rejects.toThrow(/no content/);

    stubJson({ choices: [] });
    await expect(translateArticle(article, "en", "key")).rejects.toThrow(/no content/);

    stubJson({ choices: [{}] });
    await expect(translateArticle(article, "en", "key")).rejects.toThrow(/no content/);

    stubJson({ choices: [{ message: {} }] });
    await expect(translateArticle(article, "en", "key")).rejects.toThrow(/no content/);
  });

  it("throws when translation JSON is missing fields", async () => {
    stubJson({
      choices: [{ message: { content: JSON.stringify({ title: "Only title" }) } }],
    });
    await expect(translateArticle(article, "en", "key")).rejects.toThrow(/invalid translation/);
  });

  it("replaces &nbsp; in translated title and body", async () => {
    stubJson({
      choices: [{
        message: { content: JSON.stringify({ title: "Hello&nbsp;there", summary: "Line&nbsp;one\n\nLine two" }) },
      }],
    });
    await expect(translateArticle(article, "en", "key")).resolves.toEqual({
      title: "Hello there",
      summary: "Line one\n\nLine two",
    });
  });

  it("rejects translations that become empty after decoding &nbsp;", async () => {
    stubJson({
      choices: [{ message: { content: JSON.stringify({ title: "&nbsp;", summary: "Body" }) } }],
    });
    await expect(translateArticle(article, "en", "key")).rejects.toThrow(/invalid translation/);
  });

  it("rejects Russian output that copies the source or has no Cyrillic", async () => {
    stubJson({
      choices: [{ message: { content: JSON.stringify({ title: "Hello", summary: "World" }) } }],
    });
    await expect(translateArticle(article, "ru", "key")).rejects.toThrow(/untranslated text/);

    stubJson({
      choices: [{ message: { content: JSON.stringify({ title: "Hi there", summary: "Updated body" }) } }],
    });
    await expect(translateArticle(article, "ru", "key")).rejects.toThrow(/untranslated text/);
  });
});

describe("isActualTranslation", () => {
  it("accepts Russian text that differs from the source", () => {
    expect(isActualTranslation(article, { title: "Привет", summary: "Мир" }, "ru")).toBe(true);
  });

  it("rejects copies of the source and Latin-only Russian", () => {
    expect(isActualTranslation(article, { title: "Hello", summary: "World" }, "ru")).toBe(false);
    expect(isActualTranslation(article, { title: "Hi", summary: "Everyone" }, "ru")).toBe(false);
    expect(isActualTranslation(article, { title: "", summary: "Мир" }, "ru")).toBe(false);
  });
});
