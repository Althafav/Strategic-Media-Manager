/**
 * Fetching OneDrive bytes from the browser. When OneDrive throttles a file it answers 503 (sometimes 429)
 * without CORS headers, so the browser only sees "TypeError: Failed to fetch". Both are treated as
 * "busy" and retried after a pause, with a fresh URL each time. A throttled file recovers within a minute or so.
 */

export const BUSY_MESSAGE = "OneDrive is busy right now. Try again in a minute.";

const DELAYS_MS = [1000, 3000, 6000];

export class BusyError extends Error {
  constructor(message = BUSY_MESSAGE) {
    super(message);
    this.name = "BusyError";
  }
}

const isBusyStatus = (status: number) => status === 429 || status >= 500;

function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal?.throwIfAborted();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

/**
 * Fetches `url()` and runs `read` on the response, retrying when OneDrive is busy, the connection drops
 * (also mid-body, inside `read`), or the URL has expired (401/403). `url` is called again before every retry,
 * so it can return a fresh pre-authenticated URL. Other bad statuses are returned to `read` as-is.
 * Throws BusyError when every attempt failed.
 */
export async function fetchRetry<T>(
  url: () => string | Promise<string>,
  read: (res: Response) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(await url(), { signal, cache: "no-store" });
      // 401/403 from OneDrive is an expired URL; from our own API it's a real "no access".
      const expired = (res.status === 401 || res.status === 403) && new URL(res.url).origin !== location.origin;
      if (!isBusyStatus(res.status) && !expired) return await read(res);
      res.body?.cancel().catch(() => {});
    } catch (e) {
      // Aborted by the user, or an error thrown by `read` itself (e.g. a decode failure): not ours to retry.
      if (signal?.aborted || !(e instanceof TypeError)) throw e;
    }
    if (attempt >= DELAYS_MS.length) throw new BusyError();
    await wait(DELAYS_MS[attempt], signal);
  }
}
