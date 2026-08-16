import { describe, expect, it } from "vitest";
import { isFrontendAiNews } from "./relevance";

describe("isFrontendAiNews", () => {
  it("keeps articles that mention frontend and AI together", () => {
    expect(isFrontendAiNews({
      title: "React Copilot writes components in VS Code",
      summary: "GitHub Copilot now generates frontend UI from prompts.",
    })).toBe(true);
    expect(isFrontendAiNews({
      title: "Using ChatGPT to debug CSS layout",
      summary: "",
    })).toBe(true);
    expect(isFrontendAiNews({
      title: "TypeScript 6 and LLM-powered refactors",
      summary: "Artificial intelligence tools for web development.",
    })).toBe(true);
  });

  it("drops articles that cover only one of the two topics", () => {
    expect(isFrontendAiNews({
      title: "A complete guide to Flexbox and CSS grid",
      summary: "Frontend layout patterns without any model mentions.",
    })).toBe(false);
    expect(isFrontendAiNews({
      title: "OpenAI releases a new GPT-5 model",
      summary: "Artificial intelligence research, no web UI angle.",
    })).toBe(false);
  });

  it("does not treat unrelated text as a match", () => {
    expect(isFrontendAiNews({
      title: "City council meeting notes",
      summary: "Budget talks continue again this week.",
    })).toBe(false);
  });
});
