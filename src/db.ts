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

/** Inserts a new article or returns the existing id when url_hash already exists. */
export async function upsertArticle(
  db: D1Database,
  article: FeedArticle,
  urlHash: string,
): Promise<{ id: number; created: boolean }> {
  const result = await db.prepare(
    `INSERT INTO articles (url, url_hash, source, topic, published_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(url_hash) DO NOTHING`,
  ).bind(article.url, urlHash, article.source, article.topic, article.publishedAt ?? null, now()).run();

  if (result.meta.changes > 0 && result.meta.last_row_id) {
    return { id: Number(result.meta.last_row_id), created: true };
  }

  const existing = await db.prepare("SELECT id FROM articles WHERE url_hash = ?")
    .bind(urlHash)
    .first<{ id: number }>();
  if (!existing) throw new Error(`Failed to upsert article for ${article.url}`);
  return { id: existing.id, created: false };
}

/** @deprecated Prefer upsertArticle — kept for tests that still assert insert-only behaviour. */
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

  if (result.meta.changes > 0 && result.meta.last_row_id) {
    return Number(result.meta.last_row_id);
  }
  return null;
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

export async function hasTranslation(db: D1Database, articleId: number, language: string): Promise<boolean> {
  return Boolean(
    await db.prepare("SELECT 1 AS present FROM translations WHERE article_id = ? AND lang = ?")
      .bind(articleId, language)
      .first(),
  );
}

/** Articles that still need a translation or a Telegram post, using stored text as the source. */
export async function listPendingArticles(
  db: D1Database,
  sourceLanguage: string,
  requiredLanguages: string[],
  limit: number,
): Promise<FeedArticle[]> {
  if (limit <= 0 || requiredLanguages.length === 0) return [];

  const languagePlaceholders = requiredLanguages.map(() => "?").join(", ");
  const query = `
    SELECT a.url, a.source, a.topic, a.published_at AS publishedAt,
           COALESCE(
             (SELECT title FROM translations WHERE article_id = a.id AND lang = ?),
             (SELECT title FROM translations WHERE article_id = a.id LIMIT 1)
           ) AS title,
           COALESCE(
             (SELECT summary FROM translations WHERE article_id = a.id AND lang = ?),
             (SELECT summary FROM translations WHERE article_id = a.id LIMIT 1)
           ) AS summary
    FROM articles a
    WHERE EXISTS (SELECT 1 FROM translations t WHERE t.article_id = a.id)
      AND (
        (SELECT COUNT(*) FROM translations t WHERE t.article_id = a.id AND t.lang IN (${languagePlaceholders})) < ?
        OR EXISTS (
          SELECT 1
          FROM translations target
          JOIN translations source ON source.article_id = target.article_id AND source.lang = ?
          WHERE target.article_id = a.id
            AND target.lang IN (${languagePlaceholders})
            AND target.lang != source.lang
            AND target.title = source.title
            AND target.summary = source.summary
        )
        OR NOT EXISTS (SELECT 1 FROM telegram_posts p WHERE p.article_id = a.id)
      )
    ORDER BY COALESCE(a.published_at, a.created_at) DESC
    LIMIT ?`;

  const result = await db.prepare(query).bind(
    sourceLanguage,
    sourceLanguage,
    ...requiredLanguages,
    requiredLanguages.length,
    sourceLanguage,
    ...requiredLanguages,
    limit,
  ).all<FeedArticle & { publishedAt: string | null }>();

  return result.results
    .filter((row) => row.title)
    .map((row) => ({
      url: row.url,
      title: row.title,
      summary: row.summary || row.title,
      source: row.source,
      topic: row.topic,
      publishedAt: row.publishedAt ?? undefined,
    }));
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
