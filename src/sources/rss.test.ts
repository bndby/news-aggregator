import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRssFeed } from "./rss";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fetchRssFeed", () => {
  it("parses classic RSS 2.0 items", async () => {
    const xml = `<?xml version="1.0"?>
      <rss version="2.0">
        <channel>
          <title>Dev Blog</title>
          <item>
            <title>Post &amp; Notes</title>
            <link>https://blog.example/post</link>
            <description><![CDATA[<p>Hello <b>world</b></p>]]></description>
            <pubDate>Mon, 03 Aug 2026 12:00:00 GMT</pubDate>
          </item>
          <item>
            <title></title>
            <link>https://blog.example/skip</link>
          </item>
        </channel>
      </rss>`;

    vi.stubGlobal("fetch", vi.fn(async () => new Response(xml, { status: 200 })));

    const articles = await fetchRssFeed({ url: "https://blog.example/feed.xml", topic: "frontend" });

    expect(articles).toHaveLength(1);
    expect(articles[0]).toMatchObject({
      url: "https://blog.example/post",
      title: "Post & Notes",
      summary: "Hello world",
      source: "Dev Blog",
      topic: "frontend",
    });
    expect(articles[0]?.publishedAt).toBe(new Date("Mon, 03 Aug 2026 12:00:00 GMT").toISOString());
  });

  it("parses Atom feeds with href links", async () => {
    const xml = `<?xml version="1.0"?>
      <feed>
        <title>Atom Source</title>
        <entry>
          <title>Atom Entry</title>
          <link rel="alternate" href="https://atom.example/1"/>
          <summary>Short summary</summary>
          <published>2026-08-02T08:30:00Z</published>
        </entry>
      </feed>`;

    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => new Response(xml, { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const articles = await fetchRssFeed({ url: "https://atom.example/feed", topic: "ai" });

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: { "User-Agent": "NewsAggregator/1.0" },
      signal: expect.any(AbortSignal),
    });
    expect(articles).toEqual([
      {
        url: "https://atom.example/1",
        title: "Atom Entry",
        summary: "Short summary",
        source: "Atom Source",
        topic: "ai",
        publishedAt: "2026-08-02T08:30:00.000Z",
      },
    ]);
  });

  it("picks the first object link href and supports #text/content/updated fields", async () => {
    const xml = `<?xml version="1.0"?>
      <feed>
        <title>Typed Atom</title>
        <entry>
          <title type="text">Object title</title>
          <link>https://should-not-win.example</link>
          <link rel="related" href="https://related.example/x"/>
          <link rel="alternate" href="https://atom.example/preferred"/>
          <content type="html"><![CDATA[<p>From <em>content</em></p>]]></content>
          <updated>2026-08-03T10:00:00Z</updated>
        </entry>
      </feed>`;

    vi.stubGlobal("fetch", vi.fn(async () => new Response(xml)));

    const articles = await fetchRssFeed({ url: "https://atom.example/typed", topic: "frontend" });
    expect(articles).toEqual([
      {
        url: "https://related.example/x",
        title: "Object title",
        summary: "From content",
        source: "Typed Atom",
        topic: "frontend",
        publishedAt: "2026-08-03T10:00:00.000Z",
      },
    ]);
  });

  it("returns an empty list when the channel has no items", async () => {
    const xml = `<?xml version="1.0"?><rss><channel><title>Empty</title></channel></rss>`;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(xml)));
    await expect(fetchRssFeed({ url: "https://example.com/empty.xml", topic: "ai" })).resolves.toEqual([]);
  });

  it("ignores invalid dates and falls back across summary fields", async () => {
    const xml = `<?xml version="1.0"?>
      <rss>
        <channel>
          <item>
            <title>Only content</title>
            <link>https://example.com/content</link>
            <content>Plain content body</content>
            <pubDate>not-a-real-date</pubDate>
          </item>
        </channel>
      </rss>`;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(xml)));

    const articles = await fetchRssFeed({ url: "https://example.com/rss", topic: "ai" });
    expect(articles).toEqual([
      {
        url: "https://example.com/content",
        title: "Only content",
        summary: "Plain content body",
        source: "example.com",
        topic: "ai",
        publishedAt: undefined,
      },
    ]);
  });

  it("falls back to hostname when feed title is missing", async () => {
    const xml = `<?xml version="1.0"?><rss><channel><item>
      <title>Untitled feed item</title>
      <link>https://example.com/a</link>
    </item></channel></rss>`;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(xml)));

    const articles = await fetchRssFeed({ url: "https://news.example/rss", topic: "ai" });
    expect(articles[0]?.source).toBe("news.example");
    expect(articles[0]?.publishedAt).toBeUndefined();
  });

  it("throws when the feed HTTP request fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 404 })));
    await expect(fetchRssFeed({ url: "https://example.com/missing", topic: "ai" })).rejects.toThrow(
      /RSS https:\/\/example.com\/missing returned 404/,
    );
  });
});
