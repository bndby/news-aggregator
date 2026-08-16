import { afterEach, describe, expect, it, vi } from "vitest";
import { FEED_FETCH_WATCHDOG_MS, fetchFeed } from "./fetch";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("fetchFeed", () => {
  it("requests the feed with a timeout signal", async () => {
    const fetchMock = vi.fn(async () => new Response("<rss/>", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await fetchFeed("https://example.com/rss");

    expect(await response.text()).toBe("<rss/>");
    expect(fetchMock).toHaveBeenCalledOnce();
    const init = (fetchMock.mock.calls[0] as unknown[])[1] as RequestInit;
    expect(init.headers).toEqual({ "User-Agent": "NewsAggregator/1.0" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("rejects when the upstream fetch never settles", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));

    const pending = fetchFeed("https://news.google.com/rss");
    const expectation = expect(pending).rejects.toThrow("Feed fetch timed out");
    await vi.advanceTimersByTimeAsync(FEED_FETCH_WATCHDOG_MS);
    await expectation;
  });
});
