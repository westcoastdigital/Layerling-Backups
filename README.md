# Layerling Backup

Chrome extension that backs up your [Layerling](https://layerling.com) designs to Google Drive or a local folder.

- **Back up now** button in the toolbar popup.
- **Auto backup** whenever the Layerling start page appears (first load, or coming back from the editor). By default it only runs when a design has changed since the last backup.
- Keeps the last *N* backups (default 20); older ones are binned in Drive or deleted from the folder.

Backups are Layerling's own "Back up all" ZIP (designs, folders, thumbnails, custom shapes), captured instead of downloaded, so **Restore backup** on the Layerling start page brings them straight back. Files are named `layerling-backup-YYYY-MM-DD-HHMMSS.zip`.

## Install (unpacked)

1. `chrome://extensions` → enable **Developer mode** → **Load unpacked** → pick this folder.
2. The extension ID is fixed by the `key` in `manifest.json`: **`ojakjkpalhhcodolnlgdfljdjhhgbklc`**.
3. Reload any open Layerling tab.

`key.pem` is the matching private key. It's only needed if you ever pack a `.crx`. **Never commit it** (it's in `.gitignore`): anyone with it can run an extension with this ID and sign users in through your OAuth client. The client ID in `src/config.js` is public by design. Forks should use their own key and client ID.

## Google Drive setup (publisher, one time)

Users just click **Connect**: Google's own window opens with the account chooser and consent screen. The client ID is baked into the build, so nobody else edits anything.

1. [Google Cloud Console](https://console.cloud.google.com/) → create or pick a project → enable **Google Drive API**.
2. **OAuth consent screen**: External. Add an app name, logo, support email, homepage and **privacy policy URL**. Scopes: `.../auth/drive.file`, `openid`, `email` (all non-sensitive, so no Google security review is needed).
3. **Credentials → Create credentials → OAuth client ID → Web application**. Under **Authorized redirect URIs** add:
   - `https://ojakjkpalhhcodolnlgdfljdjhhgbklc.chromiumapp.org/` (this unpacked build)
   - `https://<chrome-web-store-id>.chromiumapp.org/` once published (the Web Store assigns its own ID).
4. Put the client ID in `src/config.js` → `GOOGLE_CLIENT_ID`.
5. While the consent screen is in **Testing**, only listed test users can connect. Click **Publish app** to make it **In production** before sharing.

Sign-in uses `chrome.identity.launchWebAuthFlow`, so it works in Chrome, Edge and Brave without a signed-in browser profile. Tokens last an hour and renew silently while the user's browser keeps its Google session. If that session ends, the badge shows `!` and the user clicks **Connect** again.

## Local folder

Settings → **Choose folder…**. Chrome may drop folder access after a restart; if so, backups fall back to `Downloads/Layerling Backups/` and the badge shows `!` until you click **Re-grant access**. Choosing a Google Drive for desktop (or rclone/Insync) folder gives you a cloud copy without the OAuth setup.

## How it works

| File | Role |
|---|---|
| `src/page-hook.js` | Main-world script. When armed, intercepts Layerling's `<a download="layerling-*.zip">` click and hands the ZIP over. |
| `src/content.js` | Watches for the start page, clicks Layerling's "Back up all", streams the ZIP to the service worker in 4 MB chunks. |
| `src/background.js` | Drive upload (resumable), retention, status/badge, auto-backup decision. |
| `src/google-auth.js`, `src/config.js` | Google sign-in (account chooser, silent renewal) and the publisher's client ID. |
| `src/offscreen.js` | Writes to the chosen folder (File System Access needs a window context). |
| `src/popup.*`, `src/options.*` | UI. |

Relies on Layerling's start page markup (`.dashboard-backup-button` with the `lucide-archive` icon) and `localStorage["layerling.projects"]` for change detection. If a Layerling update breaks backups, those are the first things to check.