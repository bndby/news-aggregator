import { describe, expect, it } from "vitest";
import { config, isSupportedLanguage } from "./config";

describe("news aggregator configuration", () => {
  it("uses an hourly polling interval with a bounded batch size", () => {
    expect(config.fetchIntervalMinutes).toBe(60);
    expect(config.maxArticlesPerRun).toBeGreaterThan(0);
    expect(config.maxArticlesPerRun).toBeLessThanOrEqual(20);
  });

  it("enables Russian and English site routes", () => {
    expect(isSupportedLanguage("ru")).toBe(true);
    expect(isSupportedLanguage("en")).toBe(true);
    expect(isSupportedLanguage("de")).toBe(false);
  });

  it("defaults the site language to Russian", () => {
    expect(config.languages.default).toBe("ru");
    expect(config.languages.supported).toEqual(["ru", "en"]);
    expect(config.languages.source).toBe("en");
  });

  it("defines frontend and AI topics", () => {
    expect(config.topics.map((topic) => topic.id)).toEqual(["frontend", "ai"]);
    expect(config.topics.every((topic) => topic.query.length > 0)).toBe(true);
  });

  it("requires every Google News query to match frontend and AI together", () => {
    expect(config.topics.length).toBeGreaterThan(0);
    for (const topic of config.topics) {
      expect(topic.query).toMatch(/frontend|front-end|web development|React|JavaScript|TypeScript|CSS/i);
      expect(topic.query).toMatch(/artificial intelligence|\bAI\b|LLM|ChatGPT|Copilot/i);
      expect(topic.query).toMatch(/\bAND\b/);
    }
  });

  it("configures OpenRouter LLM settings", () => {
    expect(config.llm.provider).toBe("openrouter");
    expect(config.llm.baseUrl).toBe("https://openrouter.ai/api/v1");
    expect(config.llm.model).toContain(":free");
    expect(config.llm.fallbackModels.length).toBeGreaterThan(0);
    expect(config.llm.fallbackModels.every((model) => model.includes(":free"))).toBe(true);
    expect(config.llm.temperature).toBe(0.2);
  });

  it("includes backup RSS feeds so the pipeline is not Google News only", () => {
    expect(config.rssFeeds.length).toBeGreaterThan(0);
    expect(config.rssFeeds.every((feed) => feed.url.startsWith("https://") && feed.topic.length > 0)).toBe(true);
  });

  it("has at least one Telegram channel with topics", () => {
    expect(config.telegram.channels.length).toBeGreaterThan(0);
    for (const channel of config.telegram.channels) {
      expect(channel.chatId.length).toBeGreaterThan(0);
      expect(channel.topics.length).toBeGreaterThan(0);
    }
  });

  it("exposes site metadata used by pages and Telegram links", () => {
    expect(config.site.name).toBeTruthy();
    expect(config.site.url).toMatch(/^https?:\/\//);
    expect(config.site.itemsPerPage).toBeGreaterThan(0);
  });
});
