/** 再試行しても解消しない失敗（認証・権限・不正なリクエスト）。 */
export class NonRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonRetryableError';
  }
}

export interface HttpOptions {
  token?: string | undefined;
  userAgent: string;
  maxRetries?: number;
}

export interface PagedResponse<T> {
  items: T[];
  nextUrl: string | null;
}

/** GitHub の Link ヘッダから rel="next" を取り出す。 */
export function parseNextLink(link: string | null): string | null {
  if (!link) return null;
  for (const part of link.split(',')) {
    const m = /<([^>]+)>\s*;\s*rel="next"/.exec(part.trim());
    if (m && m[1]) return m[1];
  }
  return null;
}

/**
 * レート制限と一時障害に対応した GET。
 * 失敗したまま先に進むとカーソルがずれるため、呼び出し側で例外を伝播させる。
 */
export async function getJson<T>(url: string, opts: HttpOptions): Promise<{ body: T; headers: Headers }> {
  const maxRetries = opts.maxRetries ?? 4;
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    if (attempt > 0) await sleep(Math.min(2 ** attempt, 30) * 1000);
    try {
      const headers: Record<string, string> = {
        accept: 'application/vnd.github+json',
        'user-agent': opts.userAgent,
        'x-github-api-version': '2022-11-28',
      };
      if (opts.token) headers.authorization = `Bearer ${opts.token}`;

      const res = await fetch(url, { headers });

      if (isRateLimited(res)) {
        lastError = new Error(`レート制限 (${res.status}): ${url}`);
        if (attempt === maxRetries) break;
        await sleep(Math.min(rateLimitWaitMs(res), 120_000));
        continue;
      }
      // レート制限ではない 403 は、認証・権限・経路の問題。待っても解消しないので即座に失敗させる。
      if (res.status === 403) {
        throw new NonRetryableError(
          `アクセスが拒否されました (403): ${url}\n` +
            'GITHUB_TOKEN の権限、またはネットワーク経路を確認してください。',
        );
      }
      if (res.status >= 500) {
        lastError = new Error(`サーバエラー ${res.status}: ${url}`);
        continue;
      }
      if (!res.ok) {
        throw new NonRetryableError(`取得失敗 ${res.status} ${res.statusText}: ${url}`);
      }
      return { body: (await res.json()) as T, headers: res.headers };
    } catch (err) {
      // 待っても解消しない失敗は、再試行せずそのまま伝える。
      if (err instanceof NonRetryableError) throw err;
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/**
 * GitHub はレート制限も 403 で返すため、ヘッダで見分ける。
 * 残量 0、または retry-after が付いていれば待って再試行する価値がある。
 */
export function isRateLimited(res: { status: number; headers: Headers }): boolean {
  if (res.status === 429) return true;
  if (res.status !== 403) return false;
  if (res.headers.get('x-ratelimit-remaining') === '0') return true;
  return res.headers.get('retry-after') !== null;
}

export function rateLimitWaitMs(
  res: { headers: Headers },
  now = Date.now(),
): number {
  const retryAfter = Number(res.headers.get('retry-after') ?? 0);
  if (retryAfter > 0) return retryAfter * 1000;
  const reset = Number(res.headers.get('x-ratelimit-reset') ?? 0);
  if (reset > 0) return Math.max(0, reset * 1000 - now) + 1000;
  return 60_000;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
