const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_BYTES = 5 * 1024 * 1024;

/** GET JSON with a timeout and a response size cap. Throws a short, safe message on failure. */
export async function getJson<T>(
  fetchImpl: typeof fetch,
  url: string,
  options: { headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<T> {
  const response = await fetchImpl(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'JobHunter/0.1 (personal job search tool)', ...options.headers },
    signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return JSON.parse(await readLimited(response)) as T;
}

/** GET text (for RSS/Atom feeds) with the same limits as getJson. */
export async function getText(
  fetchImpl: typeof fetch,
  url: string,
  options: { headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<string> {
  const response = await fetchImpl(url, {
    headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml', 'User-Agent': 'JobHunter/0.1 (personal job search tool)', ...options.headers },
    signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return readLimited(response);
}

async function readLimited(response: Response): Promise<string> {
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > MAX_BYTES) throw new Error('Response too large');
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) throw new Error('Response too large');
  return text;
}

/**
 * Runs an async task per item, keeping going when some fail. Throws only when every item failed,
 * so one bad company board does not hide the others.
 */
export async function settleAll<T, R>(items: T[], task: (item: T) => Promise<R[]>): Promise<{ results: R[]; errors: string[] }> {
  const settled = await Promise.allSettled(items.map((item) => task(item)));
  const results: R[] = [];
  const errors: string[] = [];
  settled.forEach((outcome, index) => {
    if (outcome.status === 'fulfilled') results.push(...outcome.value);
    else errors.push(`${String(items[index])}: ${(outcome.reason as Error)?.message ?? 'failed'}`);
  });
  if (items.length > 0 && errors.length === items.length) {
    throw new Error(errors.join('; '));
  }
  return { results, errors };
}
