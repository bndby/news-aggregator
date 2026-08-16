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
            <description><![CDATA[<p>Hello <b>world</b> frontend AI</p>]]></description>
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
      summary: "Hello world frontend AI",
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
          <summary>Short summary of frontend LLM tools</summary>
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
        summary: "Short summary of frontend LLM tools",
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
          <content type="html"><![CDATA[<p>From <em>content</em> about React Copilot</p>]]></content>
          <updated>2026-08-03T10:00:00Z</updated>
        </entry>
      </feed>`;

    vi.stubGlobal("fetch", vi.fn(async () => new Response(xml)));

    const articles = await fetchRssFeed({ url: "https://atom.example/typed", topic: "frontend" });
    expect(articles).toEqual([
      {
        url: "https://related.example/x",
        title: "Object title",
        summary: "From content about React Copilot",
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
            <content>Plain content body about JavaScript and ChatGPT</content>
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
        summary: "Plain content body about JavaScript and ChatGPT",
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
      <description>frontend artificial intelligence</description>
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

  it("prefers the full content:encoded body over a short description", async () => {
    const xml = `<?xml version="1.0"?>
      <rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
        <channel>
          <title>Long Form</title>
          <item>
            <title>Full post</title>
            <link>https://blog.example/full</link>
            <description><![CDATA[<p>Short teaser</p>]]></description>
            <content:encoded><![CDATA[<p>First full paragraph about frontend Copilot.</p><p>Second full paragraph.</p>]]></content:encoded>
          </item>
        </channel>
      </rss>`;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(xml)));

    const articles = await fetchRssFeed({ url: "https://blog.example/feed.xml", topic: "frontend" });
    expect(articles[0]?.summary).toBe("First full paragraph about frontend Copilot.\n\nSecond full paragraph.");
    expect(articles[0]?.summary).not.toBe("Short teaser");
  });

  it("keeps only items that mention frontend and AI together", async () => {
    const xml = `<?xml version="1.0"?>
      <rss><channel>
        <item>
          <title>Flexbox guide</title>
          <link>https://blog.example/css</link>
          <description>Pure frontend layout, no models.</description>
        </item>
        <item>
          <title>GPT-5 launch</title>
          <link>https://blog.example/ai</link>
          <description>Artificial intelligence research only.</description>
        </item>
        <item>
          <title>ChatGPT for React forms</title>
          <link>https://blog.example/both</link>
          <description>Using an LLM in a frontend app.</description>
        </item>
      </channel></rss>`;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(xml)));

    const articles = await fetchRssFeed({ url: "https://blog.example/feed.xml", topic: "frontend" });
    expect(articles).toHaveLength(1);
    expect(articles[0]?.url).toBe("https://blog.example/both");
  });

  it("replaces &nbsp; with a regular space in titles and bodies", async () => {
    const xml = `<?xml version="1.0"?>
      <rss><channel><title>Feed</title><item>
        <title>Hello&amp;nbsp;there</title>
        <link>https://blog.example/nbsp</link>
        <description><![CDATA[Line&nbsp;one about frontend AI]]></description>
      </item></channel></rss>`;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(xml)));

    const articles = await fetchRssFeed({ url: "https://blog.example/feed.xml", topic: "ai" });
    expect(articles[0]?.title).toBe("Hello there");
    expect(articles[0]?.summary).toBe("Line one about frontend AI");
  });
});
