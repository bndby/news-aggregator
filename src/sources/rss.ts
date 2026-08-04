import { XMLParser } from "fast-xml-parser";
import type { RssFeed } from "../config";
import type { FeedArticle } from "../types";

const parser = new XMLParser({ ignoreAttributes: false, trimValues: true });

export async function fetchRssFeed(feed: RssFeed): Promise<FeedArticle[]> {
  const response = await fetch(feed.url, { headers: { "User-Agent": "NewsAggregator/1.0" } });
  if (!response.ok) throw new Error(`RSS ${feed.url} returned ${response.status}`);

  const xml = parser.parse(await response.text()) as {
    rss?: { channel?: { title?: string; item?: Record<string, unknown>[] } };
    feed?: { title?: string; entry?: Record<string, unknown>[] };
  };
  const source = xml.rss?.channel?.title ?? xml.feed?.title ?? new URL(feed.url).hostname;
  const items = xml.rss?.channel?.item ?? xml.feed?.entry ?? [];

  return items.flatMap((item) => {
    const url = getLink(item);
    const title = stringField(item, "title");
    if (!url || !title) return [];
    return [{
      url,
      title: cleanHtml(title),
      summary: cleanHtml(stringField(item, "description") || stringField(item, "summary") || stringField(item, "content")),
      source,
      topic: feed.topic,
      publishedAt: toIsoDate(stringField(item, "pubDate") || stringField(item, "published") || stringField(item, "updated")),
    }];
  });
}

function getLink(item: Record<string, unknown>): string | undefined {
  if (typeof item.link === "string") return item.link;
  const link = Array.isArray(item.link) ? item.link.find((value) => value && typeof value === "object") : item.link;
  if (link && typeof link === "object" && "@_href" in link && typeof link["@_href"] === "string") return link["@_href"];
  return undefined;
}

function stringField(item: Record<string, unknown>, key: string): string {
  const value = item[key];
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "#text" in value && typeof value["#text"] === "string") return value["#text"];
  return "";
}

function cleanHtml(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function toIsoDate(value: string): string | undefined {
  const date = new Date(value);
  return value && !Number.isNaN(date.valueOf()) ? date.toISOString() : undefined;
}
