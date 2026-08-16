import { describe, expect, it } from "vitest";
import { t } from "./ui";

describe("t", () => {
  it("returns Russian copy", () => {
    const text = t("ru");
    expect(text.latest).toBe("Последние новости");
    expect(text.frontend).toBe("Фронтенд");
    expect(text.ai).toBe("Искусственный интеллект");
    expect(text.noNews).toBe("Новостей пока нет");
    expect(text.back).toBe("К ленте");
    expect(text.readOriginal).toBe("Открыть оригинал");
  });

  it("uses the same Russian copy regardless of language argument", () => {
    expect(t("en")).toEqual(t("ru"));
    expect(t("de")).toEqual(t("ru"));
    expect(t()).toEqual(t("ru"));
  });
});
