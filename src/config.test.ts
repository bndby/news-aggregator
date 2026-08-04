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
});
