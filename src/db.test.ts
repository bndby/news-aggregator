import { describe, expect, it } from "vitest";
import {
  getArticle,
  getMeta,
  hasTranslation,
  listArticles,
  markTelegramPost,
  saveArticle,
  saveTranslation,
  setMeta,
  upsertArticle,
  wasPostedToChannel,
} from "./db";
import { createMockD1 } from "./test/mock-d1";
import type { FeedArticle } from "./types";

const feedArticle: FeedArticle = {
  url: "https://example.com/story",
  title: "Story",
  summary: "Summary",
  source: "Example",
  topic: "frontend",
  publishedAt: "2026-08-01T00:00:00.000Z",
};

describe("db helpers", () => {
  it("reads and writes meta values", async () => {
    const db = createMockD1((sql) => {
      if (sql.includes("SELECT value FROM meta")) return { first: { value: "2026-08-04T00:00:00.000Z" } };
      return {};
    });

    await expect(getMeta(db, "last_run_at")).resolves.toBe("2026-08-04T00:00:00.000Z");
    await setMeta(db, "last_run_at", "2026-08-04T01:00:00.000Z");

    expect(db.calls[0]).toMatchObject({ binds: ["last_run_at"] });
    expect(db.calls[1]?.sql).toMatch(/INSERT INTO meta/);
    expect(db.calls[1]?.binds).toEqual(["last_run_at", "2026-08-04T01:00:00.000Z"]);
  });

  it("returns null when meta key is missing", async () => {
    const db = createMockD1(() => ({ first: null }));
    await expect(getMeta(db, "missing")).resolves.toBeNull();
  });

  it("saves a new article and returns last_row_id", async () => {
    const db = createMockD1(() => ({ lastRowId: 7, changes: 1 }));
    const id = await saveArticle(db, feedArticle, "hash-1");

    expect(id).toBe(7);
    expect(db.calls[0]?.sql).toMatch(/INSERT INTO articles/);
    expect(db.calls[0]?.binds.slice(0, 5)).toEqual([
      feedArticle.url,
      "hash-1",
      feedArticle.source,
      feedArticle.topic,
      feedArticle.publishedAt,
    ]);
    expect(db.calls[0]?.binds[5]).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
  });

  it("returns null when article insert is a conflict (no new row)", async () => {
    const db = createMockD1(() => ({ lastRowId: 0, changes: 0 }));
    await expect(saveArticle(db, feedArticle, "hash-1")).resolves.toBeNull();
  });

  it("upserts articles and resolves existing ids on conflict", async () => {
    const created = createMockD1(() => ({ lastRowId: 7, changes: 1 }));
    await expect(upsertArticle(created, feedArticle, "hash-1")).resolves.toEqual({
      id: 7,
      created: true,
    });

    const existing = createMockD1((sql) => {
      if (sql.includes("INSERT INTO articles")) return { lastRowId: 0, changes: 0 };
      if (sql.includes("SELECT id FROM articles")) return { first: { id: 19 } };
      return {};
    });
    await expect(upsertArticle(existing, feedArticle, "hash-1")).resolves.toEqual({
      id: 19,
      created: false,
    });
  });

  it("checks whether a translation already exists", async () => {
    const present = createMockD1(() => ({ first: { present: 1 } }));
    await expect(hasTranslation(present, 3, "ru")).resolves.toBe(true);

    const missing = createMockD1(() => ({ first: null }));
    await expect(hasTranslation(missing, 3, "en")).resolves.toBe(false);
  });

  it("saves translations with upsert SQL", async () => {
    const db = createMockD1();
    await saveTranslation(db, 3, "ru", { title: "Заголовок", summary: "Текст" });
    expect(db.calls[0]?.sql).toMatch(/INSERT INTO translations/);
    expect(db.calls[0]?.binds).toEqual([3, "ru", "Заголовок", "Текст"]);
  });

  it("lists articles for a language and optional topic", async () => {
    const rows = [{
      id: 1,
      url: "https://example.com/1",
      source: "Example",
      topic: "ai",
      publishedAt: null,
      createdAt: "2026-08-01T00:00:00.000Z",
      title: "T",
      summary: "S",
    }];
    const db = createMockD1(() => ({ all: rows }));

    await expect(listArticles(db, "en")).resolves.toEqual(rows);
    expect(db.calls[0]?.binds).toEqual(["en"]);
    expect(normalizeSql(db.calls[0]?.sql)).toBe(normalizeSql(`
      SELECT a.id, a.url, a.source, a.topic, a.published_at AS publishedAt, a.created_at AS createdAt,
             t.title, t.summary
      FROM articles a
      JOIN translations t ON t.article_id = a.id AND t.lang = ?
      ORDER BY COALESCE(a.published_at, a.created_at) DESC
      LIMIT 100`));

    await listArticles(db, "ru", "frontend");
    expect(db.calls[1]?.binds).toEqual(["ru", "frontend"]);
    expect(normalizeSql(db.calls[1]?.sql)).toContain("WHERE a.topic = ?");
    expect(normalizeSql(db.calls[1]?.sql)).toContain("JOIN translations t ON t.article_id = a.id AND t.lang = ?");
  });

  it("loads a single article by id and language", async () => {
    const article = {
      id: 5,
      url: "https://example.com/5",
      source: "Example",
      topic: "frontend",
      publishedAt: "2026-08-01T00:00:00.000Z",
      createdAt: "2026-08-01T01:00:00.000Z",
      title: "Title",
      summary: "Summary",
    };
    const db = createMockD1(() => ({ first: article }));
    await expect(getArticle(db, 5, "en")).resolves.toEqual(article);
    expect(db.calls[0]?.binds).toEqual([5, "en"]);
    expect(normalizeSql(db.calls[0]?.sql)).toBe(normalizeSql(`
      SELECT a.id, a.url, a.source, a.topic, a.published_at AS publishedAt, a.created_at AS createdAt,
             t.title, t.summary
      FROM articles a JOIN translations t ON t.article_id = a.id
      WHERE a.id = ? AND t.lang = ?`));
  });

  it("tracks Telegram posts and deduplicates by channel", async () => {
    const db = createMockD1((sql) => {
      if (sql.includes("SELECT 1 FROM telegram_posts")) return { first: { 1: 1 } };
      return {};
    });

    await markTelegramPost(db, 9, "@channel", 100);
    expect(db.calls[0]?.sql).toBe(
      "INSERT OR IGNORE INTO telegram_posts (article_id, chat_id, message_id) VALUES (?, ?, ?)",
    );
    expect(db.calls[0]?.binds).toEqual([9, "@channel", 100]);

    await expect(wasPostedToChannel(db, 9, "@channel")).resolves.toBe(true);

    const empty = createMockD1(() => ({ first: null }));
    await expect(wasPostedToChannel(empty, 9, "@channel")).resolves.toBe(false);
  });
});

function normalizeSql(sql: string | undefined): string {
  return String(sql).replace(/\s+/g, " ").trim();
}