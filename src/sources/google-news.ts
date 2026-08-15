import { XMLParser } from "fast-xml-parser";
import type { Topic } from "../config";
import type { FeedArticle } from "../types";
import { fetchFeed } from "./fetch";

const parser = new XMLParser({ ignoreAttributes: false, trimValues: true });

type RssItem = {
  title?: string;
  link?: string;
  pubDate?: string;
  source?: string | { "#text"?: string };
  description?: string;
};

export async function fetchGoogleNews(topic: Topic): Promise<FeedArticle[]> {
  const url = new URL("https://news.google.com/rss/search");
  url.searchParams.set("q", topic.query);
  url.searchParams.set("hl", "en-US");
  url.searchParams.set("gl", "US");
  url.searchParams.set("ceid", "US:en");

  const response = await fetchFeed(url);
  if (!response.ok) throw new Error(`Google News returned ${response.status}`);

  const feed = parser.parse(await response.text()) as { rss?: { channel?: { item?: RssItem | RssItem[] } } };
  const rawItems = feed.rss?.channel?.item ?? [];
  const items = Array.isArray(rawItems) ? rawItems : [rawItems];
  return items
    .filter((item) => item.link && item.title)
    .map((item) => ({
      url: item.link!,
      title: cleanHtml(item.title!),
      summary: cleanHtml(item.description ?? ""),
      source: typeof item.source === "string" ? item.source : item.source?.["#text"] || "Google News",
      topic: topic.id,
      publishedAt: toIsoDate(item.pubDate),
    }));
}

function cleanHtml(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function toIsoDate(value?: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? undefined : date.toISOString();
}
