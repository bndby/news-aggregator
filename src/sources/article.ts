import { cleanHtml, normalizeText } from "../text";
import type { FeedArticle } from "../types";

export const MIN_FULL_TEXT_LENGTH = 800;
const MAX_HTML_CHARS = 400_000;
export const MAX_ARTICLE_CHARS = 15_000;
const PAGE_TIMEOUT_MS = 10_000;

export async function withFullText(article: FeedArticle): Promise<FeedArticle> {
  const title = normalizeText(article.title);
  const summary = normalizeText(article.summary).slice(0, MAX_ARTICLE_CHARS);
  if (summary.length >= MIN_FULL_TEXT_LENGTH || isGoogleNewsUrl(article.url)) {
    return { ...article, title, summary };
  }

  try {
    const extracted = await fetchArticleText(article.url);
    return {
      ...article,
      title,
      summary: extracted.length > summary.length ? extracted : summary,
    };
  } catch {
    return { ...article, title, summary };
  }
}

export async function fetchArticleText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; NewsAggregator/1.0)",
      Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
  });
  if (!response.ok) return "";
  const html = (await response.text()).slice(0, MAX_HTML_CHARS);
  return extractArticleText(html).slice(0, MAX_ARTICLE_CHARS);
}

export function extractArticleText(html: string): string {
  const withoutChrome = html
    .replace(/<(script|style|noscript|nav|footer|aside|form)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  const article = firstTagContent(withoutChrome, "article")
    ?? firstTagContent(withoutChrome, "main")
    ?? withoutChrome;
  const fromBlocks = cleanHtml(article);
  const fromParagraphs = [...withoutChrome.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => cleanHtml(match[1] ?? ""))
    .filter((paragraph) => paragraph.length > 40)
    .join("\n\n");
  return (fromParagraphs.length > fromBlocks.length ? fromParagraphs : fromBlocks).trim();
}

function firstTagContent(html: string, tag: string): string | undefined {
  const match = html.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return match?.[1];
}

function isGoogleNewsUrl(url: string): boolean {
  try {
    return new URL(url).hostname === "news.google.com";
  } catch {
    return false;
  }
}
