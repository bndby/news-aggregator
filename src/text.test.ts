import { describe, expect, it } from "vitest";
import {
  cleanHtml,
  decodeHtmlEntities,
  excerpt,
  FEED_EXCERPT_LENGTH,
  normalizeText,
  paragraphs,
} from "./text";

describe("decodeHtmlEntities", () => {
  it("replaces &nbsp; and numeric NBSP with a regular space", () => {
    expect(decodeHtmlEntities("Hello&nbsp;world")).toBe("Hello world");
    expect(decodeHtmlEntities("Hello&NBSP;world")).toBe("Hello world");
    expect(decodeHtmlEntities("Hello&#160;world")).toBe("Hello world");
    expect(decodeHtmlEntities("Hello&#xA0;world")).toBe("Hello world");
    expect(decodeHtmlEntities("Hello\u00A0world")).toBe("Hello world");
  });

  it("decodes double-encoded &amp;nbsp; used in Google News RSS", () => {
    expect(decodeHtmlEntities("Title&amp;nbsp;&amp;nbsp;Source")).toBe("Title  Source");
  });

  it("decodes common named and numeric entities", () => {
    expect(decodeHtmlEntities("A &amp; B")).toBe("A & B");
    expect(decodeHtmlEntities("&lt;tag&gt; &quot;q&quot; &#39;s&#39;")).toBe("<tag> \"q\" 's'");
    expect(decodeHtmlEntities("caf&#233;")).toBe("café");
    expect(decodeHtmlEntities("smile &#x1F600;")).toBe("smile 😀");
  });

  it("leaves unknown entities unchanged", () => {
    expect(decodeHtmlEntities("keep &unknown; here")).toBe("keep &unknown; here");
    expect(decodeHtmlEntities("bad &#x110000; code")).toBe("bad &#x110000; code");
  });
});

describe("normalizeText", () => {
  it("collapses spaces while keeping paragraph breaks", () => {
    expect(normalizeText("  Hello   &nbsp;  world  ")).toBe("Hello world");
    expect(normalizeText("One\n\n\nTwo")).toBe("One\n\nTwo");
  });
});

describe("cleanHtml", () => {
  it("strips tags, scripts, and nbsp entities", () => {
    expect(cleanHtml("<p>Hello&nbsp;<b>world</b></p>")).toBe("Hello world");
    expect(cleanHtml("<script>alert(1)</script><p>Safe</p>")).toBe("Safe");
  });

  it("turns block tags into paragraph breaks", () => {
    expect(cleanHtml("<p>First</p><p>Second</p>")).toBe("First\n\nSecond");
  });
});

describe("excerpt", () => {
  it("returns short text unchanged", () => {
    expect(excerpt("Short lead.")).toBe("Short lead.");
  });

  it("cuts long text at a sentence or word boundary", () => {
    const long = `${"Word ".repeat(80)}End.`;
    const result = excerpt(long, 80);
    expect(result.endsWith("…")).toBe(true);
    expect(result.length).toBeLessThanOrEqual(82);
    expect(result).not.toContain("&nbsp;");

    const sentences = "This is a reasonably long first sentence that ends here. Extra text should drop.";
    expect(excerpt(sentences, 70)).toBe("This is a reasonably long first sentence that ends here.…");
  });

  it("uses the feed excerpt length by default", () => {
    const long = "a".repeat(FEED_EXCERPT_LENGTH + 50);
    expect(excerpt(long).length).toBe(FEED_EXCERPT_LENGTH + 1);
  });
});

describe("paragraphs", () => {
  it("splits on blank lines after normalizing entities", () => {
    expect(paragraphs("One&nbsp;line.\n\nSecond line.")).toEqual(["One line.", "Second line."]);
  });

  it("returns a single paragraph when there are no breaks", () => {
    expect(paragraphs("  Just one  ")).toEqual(["Just one"]);
  });
});
