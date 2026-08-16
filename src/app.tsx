import { Hono } from "hono";
import { config, isSupportedLanguage } from "./config";
import { getArticle, listArticles } from "./db";
import { t } from "./i18n/ui";
import { runPipeline } from "./pipeline/run";
import { verifyTelegramSecret } from "./telegram/client";
import { excerpt, FEED_EXCERPT_LENGTH, normalizeText, paragraphs } from "./text";
import type { Article, Env } from "./types";

export const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => c.redirect(`/${config.languages.default}`));

app.get("/:lang", async (c) => {
  const language = c.req.param("lang");
  if (!isSupportedLanguage(language)) return c.notFound();
  const topic = c.req.query("topic");
  const articles = await listArticles(c.env.DB, language, topic);
  return c.html(<FeedPage language={language} articles={articles} activeTopic={topic} />);
});

app.get("/:lang/article/:id", async (c) => {
  const language = c.req.param("lang");
  const id = Number(c.req.param("id"));
  if (!isSupportedLanguage(language) || !Number.isSafeInteger(id)) return c.notFound();
  const article = await getArticle(c.env.DB, id, language);
  if (!article) return c.notFound();
  return c.html(<ArticlePage language={language} article={article} />);
});

app.post("/internal/run", async (c) => {
  const secret = c.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || !verifyTelegramSecret(c.req.raw, secret)) return c.text("Forbidden", 403);
  const limit = parsePositiveInt(c.req.query("limit"));
  return c.json(await runPipeline(c.env, limit ? { force: true, limit } : { force: true }));
});

app.post("/telegram/webhook", async (c) => {
  if (!verifyTelegramSecret(c.req.raw, c.env.TELEGRAM_WEBHOOK_SECRET)) return c.text("Forbidden", 403);
  const update = await c.req.json<{ message?: { chat?: { id?: number }; text?: string } }>();
  if (update.message?.text === "/start" && update.message.chat?.id && c.env.TELEGRAM_BOT_TOKEN) {
    await fetch(`https://api.telegram.org/bot${c.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: update.message.chat.id, text: "Бот News Aggregator работает." }),
    });
  }
  return c.json({ ok: true });
});

function Layout(props: { title: string; language: string; children: unknown }) {
  return (
    <html lang={props.language}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#edf1ec" />
        <title>{props.title}</title>
        <link rel="stylesheet" href="/styles.css" />
      </head>
      <body>
        <header class="site-header">
          <a class="wordmark" href={`/${props.language}`}>{config.site.name}</a>
        </header>
        <main>{props.children}</main>
      </body>
    </html>
  );
}

function FeedPage(props: { language: string; articles: Article[]; activeTopic?: string }) {
  const text = t(props.language);
  return (
    <Layout title={`${text.latest} — ${config.site.name}`} language={props.language}>
      <section class="intro">
        <p class="eyebrow">Signal</p>
        <h1>{text.latest}</h1>
        <p>Отобранные новости на стыке frontend и искусственного интеллекта, переведённые для вас.</p>
      </section>
      <nav class="topic-nav" aria-label="Topics">
        <a href={`/${props.language}`} class={!props.activeTopic ? "current" : ""}>{text.allTopics}</a>
        {config.topics.map((topic) => (
          <a href={`/${props.language}?topic=${topic.id}`} class={props.activeTopic === topic.id ? "current" : ""}>
            {text[topic.id as keyof typeof text] ?? topic.id}
          </a>
        ))}
      </nav>
      <section class="news-list" aria-live="polite">
        {props.articles.length ? props.articles.map((article) => <ArticlePreview article={article} language={props.language} />) : (
          <p class="empty">{text.noNews}</p>
        )}
      </section>
    </Layout>
  );
}

function ArticlePreview(props: { article: Article; language: string }) {
  const { article, language } = props;
  return (
    <article class="news-item">
      <p class="meta">{formatDate(article.publishedAt ?? article.createdAt, language)} <span>·</span> {article.topic}</p>
      <h2><a href={`/${language}/article/${article.id}`}>{normalizeText(article.title)}</a></h2>
      <p>{excerpt(article.summary, FEED_EXCERPT_LENGTH)}</p>
      <span class="source">{normalizeText(article.source)}</span>
    </article>
  );
}

function ArticlePage(props: { language: string; article: Article }) {
  const text = t(props.language);
  const { article, language } = props;
  return (
    <Layout title={`${article.title} — ${config.site.name}`} language={language}>
      <article class="article-detail">
        <a class="back" href={`/${language}`}>← {text.back}</a>
        <p class="meta">{formatDate(article.publishedAt ?? article.createdAt, language)} <span>·</span> {article.topic}</p>
        <h1>{normalizeText(article.title)}</h1>
        <div class="article-body">
          {paragraphs(article.summary).map((paragraph) => <p>{paragraph}</p>)}
        </div>
        <p class="origin">{text.source}: {normalizeText(article.source)} · <a href={article.url} target="_blank" rel="noreferrer">{text.readOriginal} ↗</a></p>
      </article>
    </Layout>
  );
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return undefined;
  return parsed;
}

function formatDate(value: string, language: string): string {
  return new Intl.DateTimeFormat(language, { day: "numeric", month: "long", year: "numeric" }).format(new Date(value));
}
