# Layerling Backup

A browser extension for Chrome, Edge, Brave and Firefox that backs up your [Layerling](https://layerling.com) designs to **Google Drive** or a **folder on your computer**.

Layerling keeps your designs in the browser. If you clear your browsing data, switch computers or the browser storage is lost, so are your designs. This extension keeps copies somewhere safe.

- **Back up now:** one click in the toolbar.
- **Drive, a folder, or both:** keep a copy in the cloud and on your computer.
- **On-page notification:** a small message in the top right of Layerling confirms each backup.
- **Auto backup:** runs whenever you open the Layerling start page, including when you leave the editor. It only backs up when something has changed.
- **Keeps your latest backups:** 20 by default, and older ones are cleared out.
- **Hide transform numbers:** press **Shift+Q** in Layerling to hide or show the sizes beside a selected shape and the dimensions in sketch mode.
- **Restores in Layerling:** backups are Layerling's own backup file, so **Restore backup** brings everything back, including folders, thumbnails and custom shapes.

Works in Chrome, Edge, Brave and other Chromium browsers, and in Firefox 128 or newer.

## Install

### Chrome, Edge and Brave

1. Open the [**latest release**](https://github.com/westcoastdigital/Layerling-Backups/releases/latest).
2. Under **Assets**, download **`layerling-backup-<version>.zip`**. Don't download "Source code (zip)" or "Source code (tar.gz)".
3. Unzip it somewhere you'll keep it, e.g. your Documents folder. Don't delete the folder afterwards, because the browser loads the extension from it.
4. Open `chrome://extensions` (Edge: `edge://extensions`).
5. Turn on **Developer mode** (top right in Chrome, left sidebar in Edge).
6. Click **Load unpacked** and select the folder that directly contains `manifest.json`.
   If you see "Manifest file is missing", your unzip tool added an extra folder level. Open the folder and select the one inside.
7. Pin the extension: click the puzzle-piece icon in the toolbar, then the pin (Chrome) or eye icon (Edge) next to **Layerling Backup**.
8. If Layerling is already open, reload the tab.

### Firefox

1. Open the [**latest release**](https://github.com/westcoastdigital/Layerling-Backups/releases/latest).
2. Under **Assets**, click **`layerling-backup-firefox-<version>.xpi`**.
3. Firefox asks whether to add **Layerling Backup**. Click **Continue to Installation**, then **Add**.
   If it downloads the file instead, open `about:addons`, click the ⚙ gear, choose **Install Add-on From File…** and pick the `.xpi`.
4. Pin it: click the puzzle-piece icon in the toolbar, then ⚙ next to **Layerling Backup** → **Pin to Toolbar**.
5. If Layerling is already open, reload the tab.

If the popup says it needs access to layerling.com, click **Allow access**.

## How to update

**Firefox** updates itself automatically, so there's nothing to do.

**Chrome, Edge and Brave** don't update extensions installed this way, so check for new versions now and then.

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

In Chrome and Edge you choose the folder:

1. Choose **Local folder**, then click **Choose…** (or open **Settings**).
2. Pick a folder and allow access.

In **Firefox** and **Brave**, backups always go to a **Layerling Backups** folder inside your Downloads folder, because those browsers can't save to a folder you choose. Old backups there are cleared out the same way.

Tip (Chrome and Edge): choosing a folder that syncs to the cloud (Google Drive for desktop, Dropbox, OneDrive) gets you a cloud copy too.

## Using it

- **Auto backup** is on by default. Design as normal; when you go back to Layerling's start page, a backup runs.
- **Back up now** in the popup runs one immediately. A Layerling tab needs to be open on the start page.
- The popup shows when the last backup ran and where it went.
- A **!** on the toolbar icon means the last backup had a problem. Open the popup to see what happened.
- **Shift+Q** hides or shows the transform numbers. The setting is remembered, so they stay hidden after a reload until you press it again. Layerling's own **Q** only hides the 3D sizes, and only until you reload.

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

**"Go to the Layerling start page to back up"**
The editor is open. Go back to the start page and try again.

**"No Layerling tab is open"**
Open [layerling.com](https://layerling.com), then click **Back up now**.

**"Reload the Layerling tab"**
Happens after installing or updating the extension. Reload the Layerling tab once.

**"Google Drive sign-in has expired"**
Click **Connect** in the popup. This happens if you sign out of Google in your browser.

**Backups going to Downloads/Layerling Backups instead of your folder (Chrome, Edge)**
The browser dropped access to your chosen folder, which can happen after a restart. Click **Re-grant access** in the popup.

## Privacy

- Your designs only go to the place you choose: your own Google Drive or your own folder.
- Nothing is sent to the developer or anyone else. There's no server, tracking or analytics.
- With Google Drive, the extension can only access files it created. You can remove its access at any time in **Settings → Disconnect**, or from your [Google account permissions](https://myaccount.google.com/permissions).

## Not affiliated

Layerling Backup is an independent project and is not made by or affiliated with Layerling. If a Layerling update changes its start page, backups may stop working until this extension is updated.