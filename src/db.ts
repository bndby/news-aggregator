import type { Article, FeedArticle, Translation } from "./types";

const now = () => new Date().toISOString();

export async function getMeta(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare("SELECT value FROM meta WHERE key = ?").bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function setMeta(db: D1Database, key: string, value: string): Promise<void> {
  await db.prepare(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).bind(key, value).run();
}

export async function saveArticle(
  db: D1Database,
  article: FeedArticle,
  urlHash: string,
): Promise<number | null> {
  const result = await db.prepare(
    `INSERT INTO articles (url, url_hash, source, topic, published_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(url_hash) DO NOTHING`,
  ).bind(article.url, urlHash, article.source, article.topic, article.publishedAt ?? null, now()).run();

  return result.meta.last_row_id ? Number(result.meta.last_row_id) : null;
}

export async function saveTranslation(
  db: D1Database,
  articleId: number,
  language: string,
  translation: Translation,
): Promise<void> {
  await db.prepare(
    `INSERT INTO translations (article_id, lang, title, summary) VALUES (?, ?, ?, ?)
     ON CONFLICT(article_id, lang) DO UPDATE SET title = excluded.title, summary = excluded.summary`,
  ).bind(articleId, language, translation.title, translation.summary).run();
}

export async function listArticles(db: D1Database, language: string, topic?: string): Promise<Article[]> {
  const query = `
    SELECT a.id, a.url, a.source, a.topic, a.published_at AS publishedAt, a.created_at AS createdAt,
           t.title, t.summary
    FROM articles a
    JOIN translations t ON t.article_id = a.id AND t.lang = ?
    ${topic ? "WHERE a.topic = ?" : ""}
    ORDER BY COALESCE(a.published_at, a.created_at) DESC
    LIMIT 100`;
  const statement = topic ? db.prepare(query).bind(language, topic) : db.prepare(query).bind(language);
  const result = await statement.all<Article>();
  return result.results;
}

export async function getArticle(db: D1Database, id: number, language: string): Promise<Article | null> {
  return db.prepare(
    `SELECT a.id, a.url, a.source, a.topic, a.published_at AS publishedAt, a.created_at AS createdAt,
            t.title, t.summary
     FROM articles a JOIN translations t ON t.article_id = a.id
     WHERE a.id = ? AND t.lang = ?`,
  ).bind(id, language).first<Article>();
}

export async function markTelegramPost(
  db: D1Database,
  articleId: number,
  chatId: string,
  messageId: number,
): Promise<void> {
  await db.prepare(
    "INSERT OR IGNORE INTO telegram_posts (article_id, chat_id, message_id) VALUES (?, ?, ?)",
  ).bind(articleId, chatId, messageId).run();
}

export async function wasPostedToChannel(db: D1Database, articleId: number, chatId: string): Promise<boolean> {
  return Boolean(await db.prepare(
    "SELECT 1 FROM telegram_posts WHERE article_id = ? AND chat_id = ?",
  ).bind(articleId, chatId).first());
}
