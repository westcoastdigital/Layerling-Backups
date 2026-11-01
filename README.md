# Layerling Backup

A Chrome extension that backs up your [Layerling](https://layerling.com) designs to **Google Drive** or a **folder on your computer**.

Layerling keeps your designs in the browser. If you clear your browsing data, switch computers or the browser storage is lost, so are your designs. This extension keeps copies somewhere safe.

- **Back up now:** one click in the toolbar.
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

## Set up

Click the extension icon and choose where backups go.

### Google Drive

1. Choose **Google Drive** and click **Connect**.
2. Pick your Google account and allow access.

Backups go to a **Layerling Backups** folder in your Drive. The extension can only see files it creates itself, not the rest of your Drive.

If Google shows a "Google hasn't verified this app" screen, click **Advanced → Go to Layerling Backup** to continue.

### Local folder

1. Choose **Local folder**, then click **Choose…** (or open **Settings**).
2. Pick a folder and allow access.

Tip: choosing a folder that syncs to the cloud (Google Drive for desktop, Dropbox, OneDrive) gets you a cloud copy too.

## Using it

- **Auto backup** is on by default. Design as normal; when you go back to Layerling's start page, a backup runs.
- **Back up now** in the popup runs one immediately. A Layerling tab needs to be open on the start page.
- The popup shows when the last backup ran and where it went.
- A **!** on the toolbar icon means the last backup had a problem. Open the popup to see what happened.

### Settings

Click **Settings** in the popup to change:
- Where backups go, and the Drive folder name
- Auto backup on or off
- Whether to back up only when something has changed
- How many backups to keep (0 keeps everything)

## Restore your designs

1. Get the backup file (`layerling-backup-<date>.zip`) from your Drive folder or local folder.
2. On the Layerling start page, click **Restore backup** and choose the file.

Your designs, folders and custom shapes come back, on the same computer or a new one.

## Troubleshooting

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

## Update

To check for a new version, open the popup's **Settings** to see your version, then compare it with the latest on the [Releases](https://github.com/westcoastdigital/Layerling-Backups/releases/latest) page. Click **Watch → Custom → Releases** on this repo to be notified.

1. Download the new release ZIP and replace the files in your existing folder.
2. In `chrome://extensions`, click the reload icon on **Layerling Backup**.
3. Reload any open Layerling tab.

Your settings and Drive connection are kept.

## Privacy

- Your designs only go to the place you choose: your own Google Drive or your own folder.
- Nothing is sent to the developer or anyone else. There's no server, tracking or analytics.
- With Google Drive, the extension can only access files it created. You can remove its access at any time in **Settings → Disconnect**, or from your [Google account permissions](https://myaccount.google.com/permissions).

## Not affiliated

Layerling Backup is an independent project and is not made by or affiliated with Layerling. If a Layerling update changes its start page, backups may stop working until this extension is updated.