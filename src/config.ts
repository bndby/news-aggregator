import defaultConfig from "../config/default.json";

export type Topic = { id: string; query: string };
export type RssFeed = { url: string; topic: string };
export type TelegramChannel = { chatId: string; topics: string[] };

export type AppConfig = {
  fetchIntervalMinutes: number;
  maxArticlesPerRun: number;
  topics: Topic[];
  rssFeeds: RssFeed[];
  languages: { default: string; supported: string[] };
  llm: {
    provider: string;
    baseUrl: string;
    model: string;
    openrouterProviders: string[];
    temperature: number;
  };
  telegram: { channels: TelegramChannel[] };
  site: { name: string; url: string; itemsPerPage: number };
};

export const config = defaultConfig as AppConfig;

export function isSupportedLanguage(language: string): boolean {
  return config.languages.supported.includes(language);
}
