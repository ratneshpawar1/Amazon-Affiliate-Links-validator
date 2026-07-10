// Short-link resolution (plan §M3). amzn.to / a.co / amzn.eu / amzn.asia are
// resolved by following redirects and reading the final URL. The fetcher is
// injectable so this stays unit-testable with a mock.

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export interface ResolveResult {
  /** Final URL after redirects, or null if it couldn't be resolved. */
  resolvedUrl: string | null;
  /** True when resolution landed on a robot check (needs tab-based retry). */
  blocked: boolean;
}

/** A resolved URL that is itself a captcha/robot page is not a real product. */
export function looksBlocked(finalUrl: string): boolean {
  return /\/errors\/validateCaptcha|\/errors\/robot/i.test(finalUrl);
}

export async function resolveShortLink(
  url: string,
  fetcher: Fetcher = fetch
): Promise<ResolveResult> {
  const withScheme = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  try {
    const res = await fetcher(withScheme, {
      method: "GET",
      redirect: "follow",
      credentials: "omit",
    });
    const finalUrl = res.url || withScheme;
    if (looksBlocked(finalUrl)) {
      return { resolvedUrl: null, blocked: true };
    }
    return { resolvedUrl: finalUrl, blocked: false };
  } catch {
    return { resolvedUrl: null, blocked: false };
  }
}
