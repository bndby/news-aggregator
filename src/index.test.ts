import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "./types";

const appFetch = vi.fn(async () => new Response("ok"));
const runPipeline = vi.fn(async () => ({ added: 2, failures: ["one"] }));

vi.mock("./app", () => ({
  app: { fetch: appFetch },
}));
vi.mock("./pipeline/run", () => ({ runPipeline }));

const worker = (await import("./index")).default;

function createEnv(): Env {
  return {
    DB: {} as D1Database,
    ASSETS: { fetch: vi.fn(async () => new Response("css")) } as unknown as Fetcher,
    OPENROUTER_API_KEY: "key",
    TELEGRAM_BOT_TOKEN: "token",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  runPipeline.mockResolvedValue({ added: 2, failures: ["one"] });
  appFetch.mockImplementation(async () => new Response("ok"));
});

describe("worker entrypoint", () => {
  it("serves styles from ASSETS and proxies other requests to the app", async () => {
    const env = createEnv();
    const css = await worker.fetch(new Request("http://localhost/styles.css"), env, {} as ExecutionContext);
    expect(await css.text()).toBe("css");
    expect(env.ASSETS.fetch).toHaveBeenCalledOnce();
    expect(appFetch).not.toHaveBeenCalled();

    const nestedCss = await worker.fetch(
      new Request("http://localhost/assets/styles.css"),
      env,
      {} as ExecutionContext,
    );
    expect(await nestedCss.text()).toBe("ok");
    expect(env.ASSETS.fetch).toHaveBeenCalledOnce();
    expect(appFetch).toHaveBeenCalledOnce();

    const page = await worker.fetch(new Request("http://localhost/ru"), env, {} as ExecutionContext);
    expect(await page.text()).toBe("ok");
    expect(appFetch).toHaveBeenCalledTimes(2);
  });
  it("runs the pipeline from the scheduled handler", async () => {
    const env = createEnv();
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await worker.scheduled!({} as ScheduledController, env, { waitUntil: vi.fn() } as unknown as ExecutionContext);

    expect(runPipeline).toHaveBeenCalledWith(env);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("2 articles"));
    expect(error).toHaveBeenCalledWith("one");

    log.mockRestore();
    error.mockRestore();
  });
});
