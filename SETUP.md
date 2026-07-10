# Setup guide — for the channel owner (no coding needed)

This gets the **Affiliate Link Auditor** running in your own Chrome. About
15 minutes, completely free, no credit card.

**Overview:**
1. Install Node.js (once).
2. Install this project.
3. Create a free Google project so the tool can read your YouTube channel(s).
4. Load the extension, create the Client ID, and build.
5. Add your channel and run your first audit.
6. *(Optional)* turn on AI replacement suggestions.

> **What's an "Associates tag"?** Your Amazon Associates tracking ID, e.g.
> `yourname-20` — the part of an affiliate link that tells Amazon to pay **you**
> (it shows up as `tag=yourname-20`). Find it in your
> [Amazon Associates dashboard](https://affiliate-program.amazon.com) → top-right
> under your email → *Manage Your Tracking IDs*. You enter it in the dashboard
> later. The tool uses it to flag links missing it or using the wrong one.

> **What this tool does / doesn't do.** It only *reads* your channel (never posts
> or edits). It checks each Amazon link by quietly visiting the product page in
> your own logged-in Chrome, without your tag — so it can't affect your stats.

---

## Step 1 — Install Node.js (one time)

1. <https://nodejs.org> → download **LTS** → install with defaults.
2. Confirm in Terminal / Command Prompt: `node --version` → shows `v22.x.x`.

## Step 2 — Install this project

1. Download/unzip the project folder.
2. In Terminal: `cd "Documents/chrome extension"` (adjust to where it is).
3. `npm install` (once; warnings are fine).

---

## Step 3 — Create your free Google project

> Google renamed these screens to **"Google Auth Platform"** in 2025. The bold
> wording below is what to look for.

### 3a — Project + API
1. <https://console.cloud.google.com/> → sign in with the Google account that
   owns your channel.
2. Top-left **project dropdown → New Project** → name it `Link Auditor` →
   **Create**, then select it.
3. Top search bar → **YouTube Data API v3** → **Enable**.

### 3b — Consent screen (kept in Testing)
1. Left menu → **APIs & Services → OAuth consent screen** (may show
   **Google Auth Platform → Get started**).
2. **App Information:** App name `Link Auditor` + your email → **Next**.
3. **Audience:** **External** → **Next**.
4. **Contact Information:** your email → **Next** → agree → **Create**.
5. Open the **Audience** tab → confirm **Publishing status: Testing** → under
   **Test users**, **+ Add users**, add **your own Google email**, **Save**.

### 3c — Create the Client ID (a **Web application** client)

> Important: because this tool uses Google's channel picker (so it can handle
> multiple channels and brand accounts), the client type is **Web application**
> — *not* "Chrome Extension". You need the extension's redirect URL first, so do
> **Step 4a**, then come back here.

1. Left menu → **APIs & Services → Credentials** (or **Clients**).
2. **+ Create Credentials → OAuth client ID** → **Application type: Web
   application** → name it `Link Auditor`.
3. Under **Authorized redirect URIs**, click **+ Add URI** and paste the
   redirect URL you copied in Step 4a. It looks like:
   ```
   https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/
   ```
   (Keep the trailing slash.) Click **Create**.
4. Copy the **Client ID** it shows:
   ```
   123456789012-abc123def456.apps.googleusercontent.com
   ```

---

## Step 4 — Load, get the redirect URL, then build

### 4a — Build & load once (to get the redirect URL)
1. Make your settings file:
   ```
   cp src/config.example.ts src/config.ts
   ```
   (Windows: `copy src\config.example.ts src\config.ts`.)
2. `npm run build` → creates `dist/`.
3. Chrome → `chrome://extensions` → turn on **Developer mode** → **Load
   unpacked** → select the **`dist`** folder.
4. The extension now has an **ID** (long string). Your redirect URL is:
   ```
   https://<THAT-ID>.chromiumapp.org/
   ```
   Copy it into **Step 3c #3** above and finish creating the client.

### 4b — Paste the Client ID and rebuild
1. Open `src/config.ts`, paste your Client ID:
   ```ts
   export const config: AppConfig = {
     oauthClientId: "123456789012-abc123def456.apps.googleusercontent.com",
     extensionKey: "",
     defaultOwnerTags: [],
   };
   ```
2. `npm run build`.
3. `chrome://extensions` → click the **reload (↻)** icon on the extension.

> **Keep the ID stable (recommended).** So the redirect URL never changes, ask
> whoever shared this tool for a **key** string, put it in `extensionKey` in
> `config.ts`, and rebuild. Otherwise the ID can change if you move the folder.

---

## Step 5 — Add your channel and run

1. Click the extension icon → **Add your channel**.
2. Google shows an **account and channel picker** — choose the channel you want
   to audit. (Test-user notice "Google hasn't verified this app" → **Continue**;
   expected in Testing mode.)
3. Make sure you're **logged into Amazon** in the same Chrome.
4. Click **Open dashboard** → enter your **Associates tag** → **Save**.
5. Click **Run audit**.

**Multiple channels:** click **➕ Channel** (in the popup or the dashboard top
bar) and pick another channel in the Google picker. Each channel keeps its own
results; switch between them with the dropdown at the top.

---

## Step 6 — (Optional) AI replacement suggestions

Turn this on to get real, current replacement products for broken links. It's
optional — the audit works fully without it.

You need two things:

1. **Amazon Product Advertising API (PA-API) keys.** In your Amazon Associates
   account → **Tools → Product Advertising API → Manage Credentials**. Copy your
   **Access Key** and **Secret Key**, and note your **Partner (tracking) tag**.
   > ⚠️ PA-API requires an Associates account in good standing with recent
   > qualifying sales. If you're not eligible yet, this feature simply stays off
   > — the rest of the tool is unaffected.
2. **An Anthropic API key** for the AI (from <https://console.anthropic.com>).
   It's only used to pick search keywords and write a one-line note — it never
   invents product links.

Then in the dashboard → **Advanced settings → AI & Amazon API**, paste the PA-API
Access Key, Secret Key, Partner tag, region (e.g. `us-east-1`), and your Anthropic
key → **Save keys**. Now broken links show a **✨ Suggest replacements** button.
Keys stay on your computer.

---

## Common problems

| You see | What to do |
|---|---|
| Popup: *"Your Google Client ID isn't set"* | Finish Step 4b: put the ID in `src/config.ts`, `npm run build`, reload. |
| Sign-in error *"redirect_uri_mismatch"* | The redirect URL in Step 3c must exactly match `https://<ext-id>.chromiumapp.org/` (with trailing slash). Re-copy it from `chrome://extensions`. |
| *"Access blocked"* / can't sign in | Add your own email as a **Test user** (Step 3b #5) and sign in with that account. |
| *"Google hasn't verified this app"* | Expected in Testing mode → **Continue**. |
| Blue note: *"Comment scanning isn't available…"* | Harmless — this account's comment API needs a write permission we deliberately don't request. Descriptions are still fully scanned. |
| A channel says *"needs reconnecting"* | Click **➕ Channel** and pick it again (can happen after a token expires on brand accounts). |
| Many **Blocked** results | Amazon showed a robot check. Open amazon.com, solve the CAPTCHA, click **Resume**. **Tabs only** in Advanced also helps. |
| *"Add your Amazon PA-API and LLM keys…"* on Suggest | Fill in the keys in **Advanced → AI & Amazon API** (Step 6). |

Start over: **Advanced settings → Reset all audit data** (settings kept).
