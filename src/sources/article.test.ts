import { afterEach, describe, expect, it, vi } from "vitest";
import type { FeedArticle } from "../types";
import { extractArticleText, fetchArticleText, withFullText } from "./article";

const article: FeedArticle = {
  url: "https://blog.example/post",
  title: "Post&nbsp;Title",
  summary: "Short teaser",
  source: "Example",
  topic: "frontend",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("extractArticleText", () => {
  it("prefers article markup and drops scripts", () => {
    const html = `
      <html><body>
        <nav>Menu</nav>
        <article>
          <script>alert(1)</script>
          <p>First paragraph with enough characters to keep.</p>
          <p>Second paragraph also long enough to remain.</p>
        </article>
        <footer>Ignore</footer>
      </body></html>`;
    expect(extractArticleText(html)).toContain("First paragraph");
    expect(extractArticleText(html)).toContain("Second paragraph");
    expect(extractArticleText(html)).not.toContain("alert");
    expect(extractArticleText(html)).not.toContain("Menu");
  });

  it("falls back to main and then to paragraph tags", () => {
    expect(extractArticleText("<main><p>Main column text that is long enough to keep.</p></main>"))
      .toContain("Main column text");
    expect(extractArticleText("<div><p>Only a paragraph tag with enough characters present.</p></div>"))
      .toContain("Only a paragraph tag");
  });
});

describe("fetchArticleText", () => {
  it("returns extracted text from an HTML page", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      "<article><p>Fetched paragraph that is definitely long enough.</p></article>",
      { status: 200, headers: { "Content-Type": "text/html" } },
    )));
    await expect(fetchArticleText("https://blog.example/post")).resolves.toContain("Fetched paragraph");
  });

  it("returns empty text when the page request fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 404 })));
    await expect(fetchArticleText("https://blog.example/missing")).resolves.toBe("");
  });
});

describe("withFullText", () => {
  it("replaces a short RSS teaser with the fetched article body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      "<article><p>Full story paragraph one is long enough to count.</p><p>Full story paragraph two continues the piece.</p></article>",
    )));
    const enriched = await withFullText(article);
    expect(enriched.title).toBe("Post Title");
    expect(enriched.summary).toContain("Full story paragraph one");
  });

  it("keeps already-long feed text and skips Google News urls", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const long = await withFullText({ ...article, summary: "A".repeat(900) });
    expect(long.summary).toHaveLength(900);
    expect(fetchMock).not.toHaveBeenCalled();

    const google = await withFullText({
      ...article,
      url: "https://news.google.com/rss/articles/abc",
      summary: "Title&nbsp;&nbsp;Source",
    });
    expect(google.summary).toBe("Title Source");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to the feed text when fetching throws", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }));
    await expect(withFullText(article)).resolves.toMatchObject({
      title: "Post Title",
      summary: "Short teaser",
    });
  });

  it("keeps the feed teaser when the fetched page is shorter", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<p>Hi</p>")));
    await expect(withFullText({
      ...article,
      summary: "Already a longer teaser than the page",
    })).resolves.toMatchObject({
      summary: "Already a longer teaser than the page",
    });
  });
});
