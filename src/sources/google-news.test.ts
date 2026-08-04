import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchGoogleNews } from "./google-news";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fetchGoogleNews", () => {
  it("requests Google News RSS for the topic query and maps items", async () => {
    const xml = `<?xml version="1.0"?>
      <rss>
        <channel>
          <item>
            <title>AI breakthrough &amp; models</title>
            <link>https://news.google.com/articles/abc</link>
            <description><![CDATA[Details about <em>AI</em>]]></description>
            <source url="https://wired.com">Wired</source>
            <pubDate>Tue, 04 Aug 2026 09:00:00 GMT</pubDate>
          </item>
          <item>
            <title>Missing link</title>
          </item>
        </channel>
      </rss>`;

    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => new Response(xml, { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const articles = await fetchGoogleNews({ id: "ai", query: "artificial intelligence" });

    expect(articles).toHaveLength(1);
    expect(articles[0]).toMatchObject({
      url: "https://news.google.com/articles/abc",
      title: "AI breakthrough & models",
      summary: "Details about AI",
      source: "Wired",
      topic: "ai",
    });
    expect(articles[0]?.publishedAt).toBe(new Date("Tue, 04 Aug 2026 09:00:00 GMT").toISOString());

    const requested = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requested.origin + requested.pathname).toBe("https://news.google.com/rss/search");
    expect(requested.searchParams.get("q")).toBe("artificial intelligence");
    expect(requested.searchParams.get("hl")).toBe("en-US");
    expect(requested.searchParams.get("gl")).toBe("US");
    expect(requested.searchParams.get("ceid")).toBe("US:en");
  });

  it("defaults source to Google News when source is absent", async () => {
    const xml = `<?xml version="1.0"?>
      <rss><channel><item>
        <title>No source</title>
        <link>https://example.com/1</link>
      </item></channel></rss>`;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(xml)));

    const articles = await fetchGoogleNews({ id: "frontend", query: "frontend" });
    expect(articles[0]?.source).toBe("Google News");
    expect(articles[0]?.publishedAt).toBeUndefined();
  });

  it("throws when Google News returns a non-OK status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("err", { status: 503 })));
    await expect(fetchGoogleNews({ id: "ai", query: "ai" })).rejects.toThrow(/Google News returned 503/);
  });
});
