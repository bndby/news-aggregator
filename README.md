# News Aggregator

Мультиязычный агрегатор новостей о frontend и AI на Cloudflare Workers. Раз в час он получает Google News RSS и дополнительные ленты, переводит новые материалы через OpenRouter, сохраняет их в D1, публикует на сайте и в Telegram.

## Конфигурация

Отредактируйте `config/default.json`:

- `topics` — поисковые запросы Google News;
- `rssFeeds` — дополнительные ленты вида `{ "url": "...", "topic": "frontend" }`;
- `languages.supported` — языки перевода и сайта;
- `llm.model` — бесплатная OpenRouter-модель; `openrouterProviders` ограничивает маршрутизацию провайдерами;
- `telegram.channels` — каналы с `chatId` и разрешёнными `topics` (используйте `["*"]` для всех);
- `site.url` — публичный URL Worker, необходимый для ссылок из Telegram.

Расписание определено как `0 * * * *` в `wrangler.toml`; интервал в конфиге должен оставаться равным 60 минутам.

## Локальный запуск

```sh
npm install
cp .dev.vars.example .dev.vars
npx wrangler d1 migrations apply news-aggregator --local
npm run dev
```

Откройте `http://localhost:8787/ru`. Для тестового запуска pipeline используйте Cloudflare Dashboard → Worker → Triggers → Test.

## Тесты

```sh
npm test
npm run test:mutation
```

Юнит-тесты — Vitest. Мутационное тестирование — [Stryker](https://stryker-mutator.io/) с `@stryker-mutator/vitest-runner`; HTML-отчёт пишется в `reports/mutation/mutation.html`.

В `stryker.config.json` файл `tsconfig.json` исключён из sandbox: Stryker 9.x вызывает `ts.parseConfigFileTextToJson`, которого нет в TypeScript 7. Vitest транспилирует код без tsconfig; после поддержки TS 7 в Stryker этот обход можно убрать ([issue #6110](https://github.com/stryker-mutator/stryker-js/issues/6110)).

## Cloudflare deploy

1. Создайте D1: `npx wrangler d1 create news-aggregator`.
2. Вставьте выданный `database_id` в `wrangler.toml`.
3. Примените миграции: `npx wrangler d1 migrations apply news-aggregator --remote`.
4. Добавьте секреты:

```sh
npx wrangler secret put OPENROUTER_API_KEY
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
```

5. Укажите домен в `config/default.json`, затем выполните `npm run deploy`.
6. Добавьте бота администратором каждого Telegram-канала.
7. Установите webhook:

```sh
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  --data-urlencode "url=https://YOUR_DOMAIN/telegram/webhook" \
  --data-urlencode "secret_token=$TELEGRAM_WEBHOOK_SECRET"
```

## Модель OpenRouter

Сервис использует OpenAI-совместимый endpoint OpenRouter. У бесплатных моделей меняются доступность и лимиты — выберите актуальную модель с суффиксом `:free` в [каталоге OpenRouter](https://openrouter.ai/models) и задайте её в `llm.model`. Текущая конфигурация использует `google/gemma-4-31b-it:free`. За один cron-запуск обрабатывается не больше `maxArticlesPerRun` самых свежих материалов; уже сохранённые статьи без перевода догоняются при повторном появлении в ленте.
