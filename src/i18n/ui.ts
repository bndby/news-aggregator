const copy = {
  ru: {
    latest: "Последние новости",
    allTopics: "Все темы",
    source: "Источник",
    readOriginal: "Открыть оригинал",
    noNews: "Новостей пока нет",
    back: "К ленте",
    frontend: "Фронтенд",
    ai: "Искусственный интеллект",
  },
  en: {
    latest: "Latest news",
    allTopics: "All topics",
    source: "Source",
    readOriginal: "Open original",
    noNews: "No news yet",
    back: "Back to feed",
    frontend: "Frontend",
    ai: "Artificial intelligence",
  },
} as const;

export function t(language: string) {
  return copy[language as keyof typeof copy] ?? copy.en;
}
