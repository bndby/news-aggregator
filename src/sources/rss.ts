import { XMLParser } from "fast-xml-parser";
import type { RssFeed } from "../config";
import { cleanHtml } from "../text";
import type { FeedArticle } from "../types";
import { fetchFeed } from "./fetch";

const parser = new XMLParser({ ignoreAttributes: false, trimValues: true });

export async function fetchRssFeed(feed: RssFeed): Promise<FeedArticle[]> {
  const response = await fetchFeed(feed.url);
  if (!response.ok) throw new Error(`RSS ${feed.url} returned ${response.status}`);

  const xml = parser.parse(await response.text()) as {
    rss?: { channel?: { title?: string; item?: Record<string, unknown>[] } };
    feed?: { title?: string; entry?: Record<string, unknown>[] };
  };
  const source = xml.rss?.channel?.title ?? xml.feed?.title ?? new URL(feed.url).hostname;
  const rawItems = xml.rss?.channel?.item ?? xml.feed?.entry ?? [];
  const items = Array.isArray(rawItems) ? rawItems : [rawItems];

  return items.flatMap((item) => {
    const url = getLink(item);
    const title = stringField(item, "title");
    if (!url || !title) return [];
    return [{
      url,
      title: cleanHtml(title),
      summary: itemText(item),
      source,
      topic: feed.topic,
      publishedAt: toIsoDate(stringField(item, "pubDate") || stringField(item, "published") || stringField(item, "updated")),
    }];
  });
}

function itemText(item: Record<string, unknown>): string {
  const candidates = [
    stringField(item, "content:encoded"),
    nestedString(item, "content", "encoded"),
    stringField(item, "encoded"),
    stringField(item, "content"),
    stringField(item, "description"),
    stringField(item, "summary"),
  ].map(cleanHtml);
  return candidates.reduce((longest, current) => current.length > longest.length ? current : longest, "");
}

function getLink(item: Record<string, unknown>): string | undefined {
  if (typeof item.link === "string") return item.link;
  const link = Array.isArray(item.link) ? item.link.find((value) => value && typeof value === "object") : item.link;
  if (link && typeof link === "object" && "@_href" in link && typeof link["@_href"] === "string") return link["@_href"];
  return undefined;
}

function stringField(item: Record<string, unknown>, key: string): string {
  return stringifyUnknown(item[key]);
}

function nestedString(item: Record<string, unknown>, parent: string, child: string): string {
  const value = item[parent];
  if (value && typeof value === "object" && child in value) {
    return stringifyUnknown((value as Record<string, unknown>)[child]);
  }
  return "";
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "#text" in value && typeof value["#text"] === "string") return value["#text"];
  return "";
}

function toIsoDate(value: string): string | undefined {
  const date = new Date(value);
  return value && !Number.isNaN(date.valueOf()) ? date.toISOString() : undefined;
}
