const FEED_FETCH_TIMEOUT_MS = 10_000;

export async function fetchFeed(input: RequestInfo | URL): Promise<Response> {
  return fetch(input, {
    headers: { "User-Agent": "NewsAggregator/1.0" },
    signal: AbortSignal.timeout(FEED_FETCH_TIMEOUT_MS),
  });
}
