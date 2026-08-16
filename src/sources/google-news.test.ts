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
            <description><![CDATA[Details about <em>AI</em> for frontend]]></description>
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
      summary: "Details about AI for frontend",
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
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: { "User-Agent": "NewsAggregator/1.0" },
      signal: expect.any(AbortSignal),
    });
  });

  it("defaults source to Google News when source is absent", async () => {
    const xml = `<?xml version="1.0"?>
      <rss><channel><item>
        <title>No source frontend AI</title>
        <link>https://example.com/1</link>
      </item></channel></rss>`;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(xml)));

    const articles = await fetchGoogleNews({ id: "frontend", query: "frontend" });
    expect(articles[0]?.source).toBe("Google News");
    expect(articles[0]?.publishedAt).toBeUndefined();
    expect(articles[0]?.summary).toBe("");
  });

  it("reads source #text and ignores invalid pubDates", async () => {
    const xml = `<?xml version="1.0"?>
      <rss><channel><item>
        <title>Structured source</title>
        <link>https://example.com/2</link>
        <description>frontend artificial intelligence</description>
        <source url="https://example.com"><![CDATA[Example Desk]]></source>
        <pubDate>definitely-not-a-date</pubDate>
      </item></channel></rss>`;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(xml)));

    const articles = await fetchGoogleNews({ id: "ai", query: "ai" });
    expect(articles).toEqual([
      {
        url: "https://example.com/2",
        title: "Structured source",
        summary: "frontend artificial intelligence",
        source: "Example Desk",
        topic: "ai",
        publishedAt: undefined,
      },
    ]);
  });

  it("drops items that are not about frontend and AI together", async () => {
    const xml = `<?xml version="1.0"?>
      <rss><channel>
        <item>
          <title>OpenAI model launch</title>
          <link>https://example.com/ai-only</link>
          <description>Artificial intelligence with no web UI angle</description>
        </item>
        <item>
          <title>React compiler update</title>
          <link>https://example.com/frontend-only</link>
          <description>Frontend performance, no models</description>
        </item>
        <item>
          <title>Copilot in the browser</title>
          <link>https://example.com/both</link>
          <description>AI for frontend developers</description>
        </item>
      </channel></rss>`;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(xml)));

    const articles = await fetchGoogleNews({ id: "ai", query: "ai" });
    expect(articles).toHaveLength(1);
    expect(articles[0]?.url).toBe("https://example.com/both");
  });

  it("returns an empty list when the channel has no items", async () => {
    const xml = `<?xml version="1.0"?><rss><channel></channel></rss>`;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(xml)));
    await expect(fetchGoogleNews({ id: "ai", query: "ai" })).resolves.toEqual([]);
  });

  it("throws when Google News returns a non-OK status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("err", { status: 503 })));
    await expect(fetchGoogleNews({ id: "ai", query: "ai" })).rejects.toThrow(/Google News returned 503/);
  });

  it("replaces &nbsp; separators from Google News descriptions", async () => {
    const xml = `<?xml version="1.0"?>
      <rss><channel><item>
        <title>AI story</title>
        <link>https://example.com/ai</link>
        <description><![CDATA[<a href="https://example.com/ai">AI frontend story</a>&nbsp;&nbsp;<font>Wired</font>]]></description>
        <source>Wired</source>
      </item></channel></rss>`;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(xml)));

    const articles = await fetchGoogleNews({ id: "ai", query: "ai" });
    expect(articles[0]?.summary).toBe("AI frontend story Wired");
    expect(articles[0]?.summary).not.toContain("&nbsp;");
  });
});
