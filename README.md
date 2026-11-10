# Layerling Backup

A Chrome extension that backs up your [Layerling](https://layerling.com) designs to **Google Drive** or a **folder on your computer**.

Layerling keeps your designs in the browser. If you clear your browsing data, switch computers or the browser storage is lost, so are your designs. This extension keeps copies somewhere safe.

- **Back up now:** one click in the toolbar.
- **Drive, a folder, or both:** keep a copy in the cloud and on your computer.
- **On-page notification:** a small message in the top right of Layerling confirms each backup.
- **Auto backup:** runs whenever you open the Layerling start page, including when you leave the editor. It only backs up when something has changed.
- **Keeps your latest backups:** 20 by default, and older ones are cleared out.
- **Restores in Layerling:** backups are Layerling's own backup file, so **Restore backup** brings everything back, including folders, thumbnails and custom shapes.

Works in Chrome, Edge, Brave and other Chromium browsers.

## Install

1. Open the [**latest release**](https://github.com/westcoastdigital/Layerling-Backups/releases/latest).
2. Under **Assets**, download **`layerling-backup-<version>.zip`**. Don't download "Source code (zip)" or "Source code (tar.gz)".
3. Unzip it somewhere you'll keep it, e.g. your Documents folder. Don't delete the folder afterwards, because the browser loads the extension from it.
4. Open `chrome://extensions` (Edge: `edge://extensions`).
5. Turn on **Developer mode** (top right in Chrome, left sidebar in Edge).
6. Click **Load unpacked** and select the folder that directly contains `manifest.json`.
   If you see "Manifest file is missing", your unzip tool added an extra folder level. Open the folder and select the one inside.
7. Pin the extension: click the puzzle-piece icon in the toolbar, then the pin (Chrome) or eye icon (Edge) next to **Layerling Backup**.
8. If Layerling is already open, reload the tab.

## How to update

Extensions installed this way don't update themselves, so check for new versions now and then.

**Know when there's a new version:** at the top of this repo, click **Watch → Custom**, tick **Releases**, then **Apply**. GitHub emails you when a new version is released.

**Check your version:** open the extension's **Settings**; your version is at the bottom. Compare it with the [latest release](https://github.com/westcoastdigital/Layerling-Backups/releases/latest).

**To update:**

1. Download the new `layerling-backup-<version>.zip` from the [latest release](https://github.com/westcoastdigital/Layerling-Backups/releases/latest).
2. Unzip it.
3. Copy the new files **into your existing extension folder**, replacing the old ones. Use the same folder you picked when installing.
4. Open `chrome://extensions` (Edge: `edge://extensions`) and click the **reload** icon (↻) on **Layerling Backup**.
5. Reload any open Layerling tab.

Your settings, backup history and Google Drive connection are kept.

Don't click **Remove** to update. Removing the extension deletes its settings, so you'd need to set it up and connect Google Drive again. Your existing backups are not affected.

## Set up

Click the extension icon and choose where backups go: **Drive**, **Folder**, or **Both**. With Both, every backup is saved to Google Drive and to your folder, and if one fails the other is still kept.

### Google Drive

1. Choose **Google Drive** and click **Connect**.
2. Pick your Google account and allow access.

Backups go to a **Layerling Backups** folder in your Drive. The extension can only see files it creates itself, not the rest of your Drive.

If Google shows a "Google hasn't verified this app" screen, click **Advanced → Go to Layerling Backup** to continue.

### Local folder

1. Choose **Local folder**, then click **Choose…** (or open **Settings**).
2. Pick a folder and allow access.

Tip: choosing a folder that syncs to the cloud (Google Drive for desktop, Dropbox, OneDrive) gets you a cloud copy too.

### Self-hosted Layerling

layerling.com works straight away. If you run Layerling yourself (Docker, a NAS, your own domain):

1. Open **Settings → Self-hosted Layerling**.
2. Enter its address, e.g. `localhost:3000`, `192.168.1.50:3000` or `https://cad.example.com`, and click **Add**.
3. Allow access when Chrome asks, then reload any Layerling tab already open at that address.

Each address keeps its own "only when changed" check, so designs on layerling.com and on your own copy are backed up separately.

## Using it

- **Auto backup** is on by default. Design as normal; when you go back to Layerling's start page, a backup runs.
- **Back up now** in the popup runs one immediately. A Layerling tab needs to be open on the start page.
- The popup shows when the last backup ran and where it went.
- A **!** on the toolbar icon means the last backup had a problem. Open the popup to see what happened.

### Settings

Click **Settings** in the popup to change:
- Where backups go (Drive, Folder or Both), and the Drive folder name
- Auto backup on or off
- Whether to back up only when something has changed
- Whether to show the notification on the Layerling page
- How many backups to keep (0 keeps everything)

## Restore your designs

1. Get the backup file (`layerling-backup-<date>.zip`) from your Drive folder or local folder.
2. On the Layerling start page, click **Restore backup** and choose the file.

Your designs, folders and custom shapes come back, on the same computer or a new one.

## Troubleshooting

**"Automatic backup paused"**
The last backup didn't finish, usually because Layerling ran out of memory with large or many designs. Automatic backup stays paused so it can't crash Layerling over and over. Click **Back up now** in the popup; once a backup succeeds, automatic backup turns back on. If it keeps failing, export your largest designs on their own (Export, LYL) and remove or simplify them in Layerling.

**Automatic backup failed and didn't try again**
After a failed automatic backup, the extension waits 3 hours before trying again on its own. **Back up now** works any time.

**"Go to the Layerling start page to back up"**
The editor is open. Go back to the start page and try again.

**"No Layerling tab is open"**
Open [layerling.com](https://layerling.com), then click **Back up now**.

**"Reload the Layerling tab"**
Happens after installing or updating the extension. Reload the Layerling tab once.

**"Google Drive sign-in has expired"**
Click **Connect** in the popup. This happens if you sign out of Google in your browser.

**Backups going to Downloads/Layerling Backups instead of your folder**
The browser dropped access to your chosen folder, which can happen after a restart. Click **Re-grant access** in the popup.

## Privacy

- Your designs only go to the place you choose: your own Google Drive or your own folder.
- Nothing is sent to the developer or anyone else. There's no server, tracking or analytics.
- With Google Drive, the extension can only access files it created. You can remove its access at any time in **Settings → Disconnect**, or from your [Google account permissions](https://myaccount.google.com/permissions).

## Not affiliated

Layerling Backup is an independent project and is not made by or affiliated with Layerling. If a Layerling update changes its start page, backups may stop working until this extension is updated.