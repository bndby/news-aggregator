import { describe, expect, it } from "vitest";
import { config, isSupportedLanguage } from "./config";

describe("news aggregator configuration", () => {
  it("uses an hourly polling interval", () => {
    expect(config.fetchIntervalMinutes).toBe(60);
  });

  it("enables Russian and English site routes", () => {
    expect(isSupportedLanguage("ru")).toBe(true);
    expect(isSupportedLanguage("en")).toBe(true);
    expect(isSupportedLanguage("de")).toBe(false);
  });

  it("defaults the site language to Russian", () => {
    expect(config.languages.default).toBe("ru");
    expect(config.languages.supported).toEqual(["ru", "en"]);
  });

  it("defines frontend and AI topics", () => {
    expect(config.topics.map((topic) => topic.id)).toEqual(["frontend", "ai"]);
    expect(config.topics.every((topic) => topic.query.length > 0)).toBe(true);
  });

  it("configures OpenRouter LLM settings", () => {
    expect(config.llm.provider).toBe("openrouter");
    expect(config.llm.baseUrl).toBe("https://openrouter.ai/api/v1");
    expect(config.llm.model).toContain(":free");
    expect(config.llm.temperature).toBe(0.2);
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
