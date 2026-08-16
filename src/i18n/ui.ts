const copy = {
  latest: "Последние новости",
  allTopics: "Все темы",
  source: "Источник",
  readOriginal: "Открыть оригинал",
  noNews: "Новостей пока нет",
  back: "К ленте",
  frontend: "Фронтенд",
  ai: "Искусственный интеллект",
} as const;

export function t(_language?: string) {
  return copy;
}
