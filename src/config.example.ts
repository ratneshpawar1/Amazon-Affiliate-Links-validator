// ─────────────────────────────────────────────────────────────────────────────
// config.example.ts  —  COPY this file to `config.ts` and fill in your values.
//
//   cp src/config.example.ts src/config.ts
//
// `config.ts` is git-ignored so your personal IDs never get committed.
// This is the SINGLE place any user-specific value lives — you never need to
// edit any other source file. See SETUP.md for step-by-step instructions.
// ─────────────────────────────────────────────────────────────────────────────

export interface AppConfig {
  /**
   * Your Google OAuth Client ID — type "Web application" (NOT "Chrome
   * Extension"), because we use launchWebAuthFlow's channel picker. Its
   * Authorized redirect URI must be https://<ext-id>.chromiumapp.org/.
   * Looks like: "123456789012-abc123def456.apps.googleusercontent.com"
   * See SETUP.md step 3c.
   */
  oauthClientId: string;

  /**
   * OPTIONAL. Pins the extension's ID so it stays the same every time you load
   * it and on every machine. Paste the public "key" string here (SETUP.md
   * step 3b). Leave "" to skip — the extension still works, its ID will just
   * be random per-machine (fine for a single computer).
   */
  extensionKey: string;

  /**
   * OPTIONAL default Associates tag(s), e.g. ["mychannel-20"].
   * You can also set/change these later in the dashboard's Settings panel, so
   * leaving this empty is fine.
   */
  defaultOwnerTags: string[];
}

export const config: AppConfig = {
  oauthClientId: "",
  extensionKey: "",
  defaultOwnerTags: [],
};
