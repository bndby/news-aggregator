export const FEED_FETCH_TIMEOUT_MS = 10_000;
export const FEED_FETCH_WATCHDOG_MS = 12_000;

export async function fetchFeed(input: RequestInfo | URL): Promise<Response> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fetch(input, {
        headers: { "User-Agent": "NewsAggregator/1.0" },
        signal: AbortSignal.timeout(FEED_FETCH_TIMEOUT_MS),
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Feed fetch timed out")), FEED_FETCH_WATCHDOG_MS);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
