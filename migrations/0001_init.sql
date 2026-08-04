CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL,
  url_hash TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,
  topic TEXT NOT NULL,
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS translations (
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  lang TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  PRIMARY KEY (article_id, lang)
);

CREATE TABLE IF NOT EXISTS telegram_posts (
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL,
  message_id INTEGER,
  posted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (article_id, chat_id)
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_articles_topic_published ON articles(topic, published_at DESC);
