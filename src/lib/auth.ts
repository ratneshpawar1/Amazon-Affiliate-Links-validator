// OAuth via chrome.identity.launchWebAuthFlow (Feature A). Unlike getAuthToken,
// this shows Google's account + brand-channel picker, so it works for brand
// accounts and separate Google accounts alike. Implicit flow (response_type
// "token id_token") → no client secret to embed. Access tokens last ~1h and are
// re-acquired silently (interactive:false); id_token gives us the account email
// so silent refresh can be steered back to the same account.

import { config } from "../config";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const SCOPES = ["https://www.googleapis.com/auth/youtube.readonly", "openid", "email"];

export class ConfigError extends Error {
  constructor(message: string) { super(message); this.name = "ConfigError"; }
}
export class AuthError extends Error {
  constructor(message: string) { super(message); this.name = "AuthError"; }
}

export interface TokenResult {
  accessToken: string;
  expiresAt: number; // epoch ms
  email?: string;
}

export function isConfigured(): boolean {
  return Boolean(config.oauthClientId && config.oauthClientId.trim());
}

function assertConfigured(): void {
  if (!isConfigured()) {
    throw new ConfigError(
      "Your Google Client ID isn't set yet — open SETUP.md step 3, then rebuild " +
        "with `npm run build` and reload the extension."
    );
  }
}

function randomNonce(): string {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function decodeJwtEmail(idToken: string | null): string | undefined {
  if (!idToken) return undefined;
  try {
    const payload = idToken.split(".")[1];
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json).email as string | undefined;
  } catch {
    return undefined;
  }
}

function buildAuthUrl(opts: { prompt?: string; loginHint?: string; nonce: string }): string {
  const redirectUri = chrome.identity.getRedirectURL(); // https://<id>.chromiumapp.org/
  const params = new URLSearchParams({
    client_id: config.oauthClientId.trim(),
    response_type: "token id_token",
    redirect_uri: redirectUri,
    scope: SCOPES.join(" "),
    nonce: opts.nonce,
    include_granted_scopes: "true",
  });
  if (opts.prompt) params.set("prompt", opts.prompt);
  if (opts.loginHint) params.set("login_hint", opts.loginHint);
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

function parseRedirect(redirectUrl: string): TokenResult {
  const frag = redirectUrl.includes("#") ? redirectUrl.split("#")[1] : "";
  const q = new URLSearchParams(frag);
  const accessToken = q.get("access_token");
  const expiresIn = Number(q.get("expires_in") || "3600");
  if (!accessToken) {
    throw new AuthError(q.get("error") || "No access token returned by Google.");
  }
  return {
    accessToken,
    expiresAt: Date.now() + expiresIn * 1000,
    email: decodeJwtEmail(q.get("id_token")),
  };
}

async function launch(interactive: boolean, url: string): Promise<string> {
  try {
    const redirect = await chrome.identity.launchWebAuthFlow({ url, interactive });
    if (!redirect) throw new AuthError("Sign-in was cancelled.");
    return redirect;
  } catch (e) {
    throw new AuthError(e instanceof Error ? e.message : "Sign-in failed.");
  }
}

/** Interactive sign-in with the account + channel picker. */
export async function signInInteractive(): Promise<TokenResult> {
  assertConfigured();
  const url = buildAuthUrl({ prompt: "select_account consent", nonce: randomNonce() });
  return parseRedirect(await launch(true, url));
}

/** Silent token refresh, steered toward `loginHint` (the channel's account). */
export async function getSilent(loginHint?: string): Promise<TokenResult> {
  assertConfigured();
  const url = buildAuthUrl({ prompt: "none", loginHint, nonce: randomNonce() });
  return parseRedirect(await launch(false, url));
}

/** Best-effort server-side revoke of a token. */
export async function revokeToken(accessToken: string): Promise<void> {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${accessToken}`, {
    method: "POST",
  }).catch(() => {});
}
