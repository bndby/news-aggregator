import { describe, expect, it } from "vitest";
import { t } from "./ui";

describe("t", () => {
  it("returns Russian copy for ru", () => {
    const text = t("ru");
    expect(text.latest).toBe("Последние новости");
    expect(text.frontend).toBe("Фронтенд");
    expect(text.ai).toBe("Искусственный интеллект");
    expect(text.noNews).toBe("Новостей пока нет");
  });

  it("returns English copy for en", () => {
    const text = t("en");
    expect(text.latest).toBe("Latest news");
    expect(text.frontend).toBe("Frontend");
    expect(text.ai).toBe("Artificial intelligence");
    expect(text.back).toBe("Back to feed");
  });

  it("falls back to English for unsupported languages", () => {
    expect(t("de")).toEqual(t("en"));
    expect(t("")).toEqual(t("en"));
  });
});
