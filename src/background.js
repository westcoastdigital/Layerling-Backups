import { getSettings, backupFileName, base64ToBytes, BACKUP_FILE_PATTERN, FALLBACK_DOWNLOAD_FOLDER } from "./shared.js";
import { connect, getAccessToken, invalidateToken, disconnect, accountStatus } from "./google-auth.js";

const LAYERLING_TABS = ["https://layerling.com/*", "https://www.layerling.com/*"];
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const FOLDER_MIME = "application/vnd.google-apps.folder";

let jobRunning = false;

// ---------------------------------------------------------------- status + badge

async function setStatus(status) {
  await chrome.storage.local.set({ status: { time: Date.now(), ...status } });
  if (!status.ok) {
    await chrome.action.setBadgeBackgroundColor({ color: "#c0392b" });
    await chrome.action.setBadgeText({ text: "!" });
  } else if (status.warning) {
    await chrome.action.setBadgeBackgroundColor({ color: "#d68a28" });
    await chrome.action.setBadgeText({ text: "!" });
  } else {
    await chrome.action.setBadgeText({ text: "" });
  }
}

// ---------------------------------------------------------------- Google Drive

async function driveFetch(url, options = {}, retry = true) {
  const token = await getAccessToken();
  const response = await fetch(url, { ...options, headers: { ...(options.headers ?? {}), Authorization: `Bearer ${token}` } });
  if (response.status === 401 && retry) {
    await invalidateToken();
    return driveFetch(url, options, false);
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    let message = text;
    try {
      message = JSON.parse(text).error?.message ?? text;
    } catch {
      // keep raw text
    }
    throw new Error(`Google Drive ${response.status}: ${message}`);
  }
  return response;
}

const escapeQuery = (value) => value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

async function ensureDriveFolder(name) {
  const { driveFolderId, driveFolderName } = await chrome.storage.local.get(["driveFolderId", "driveFolderName"]);
  if (driveFolderId && driveFolderName === name) {
    try {
      const folder = await (await driveFetch(`${DRIVE_API}/files/${driveFolderId}?fields=id,trashed`)).json();
      if (!folder.trashed) return driveFolderId;
    } catch {
      // Gone or not accessible: find or create again.
    }
  }
  const q = encodeURIComponent(`name='${escapeQuery(name)}' and mimeType='${FOLDER_MIME}' and trashed=false`);
  const found = await (await driveFetch(`${DRIVE_API}/files?q=${q}&fields=files(id)&spaces=drive`)).json();
  let id = found.files?.[0]?.id;
  if (!id) {
    const created = await driveFetch(`${DRIVE_API}/files?fields=id`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME }),
    });
    id = (await created.json()).id;
  }
  await chrome.storage.local.set({ driveFolderId: id, driveFolderName: name });
  return id;
}

async function uploadToDrive(bytes, fileName, settings) {
  const folderId = await ensureDriveFolder(settings.driveFolderName);

  // Resumable upload: works for any size (multipart is limited to 5 MB).
  const session = await driveFetch(`${DRIVE_UPLOAD}?uploadType=resumable`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": "application/zip",
      "X-Upload-Content-Length": String(bytes.byteLength),
    },
    body: JSON.stringify({ name: fileName, parents: [folderId], mimeType: "application/zip" }),
  });
  const uploadUrl = session.headers.get("Location");
  if (!uploadUrl) throw new Error("Google Drive did not return an upload URL.");

  const token = await getAccessToken();
  const upload = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "application/zip", Authorization: `Bearer ${token}` },
    body: bytes,
  });
  if (!upload.ok) throw new Error(`Google Drive upload failed (${upload.status}).`);

  const pruned = await pruneDrive(folderId, settings.keepCount).catch(() => 0);
  return { location: `Google Drive / ${settings.driveFolderName}`, link: `https://drive.google.com/drive/folders/${folderId}`, pruned };
}

async function pruneDrive(folderId, keep) {
  if (!keep || keep < 1) return 0;
  const q = encodeURIComponent(`'${folderId}' in parents and name contains 'layerling-backup-' and trashed=false`);
  const list = await (await driveFetch(`${DRIVE_API}/files?q=${q}&orderBy=createdTime desc&pageSize=1000&fields=files(id,name)`)).json();
  const old = (list.files ?? []).filter((file) => BACKUP_FILE_PATTERN.test(file.name)).slice(keep);
  for (const file of old) {
    // Moved to Drive's bin rather than deleted outright.
    await driveFetch(`${DRIVE_API}/files/${file.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trashed: true }),
    });
  }
  return old.length;
}

// ---------------------------------------------------------------- local folder (offscreen document)

let creatingOffscreen = null;

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  if (contexts.length) return;
  creatingOffscreen ??= chrome.offscreen
    .createDocument({ url: "src/offscreen.html", reasons: ["BLOBS"], justification: "Write Layerling backups into the folder the user chose." })
    .finally(() => {
      creatingOffscreen = null;
    });
  await creatingOffscreen;
}

async function offscreen(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ target: "offscreen", type, ...payload });
  if (!response?.ok) {
    const error = new Error(response?.error ?? "Offscreen document did not respond.");
    error.code = response?.code;
    throw error;
  }
  return response;
}

function waitForDownload(downloadId) {
  return new Promise((resolve, reject) => {
    const listener = (delta) => {
      if (delta.id !== downloadId || !delta.state) return;
      if (delta.state.current === "complete" || delta.state.current === "interrupted") {
        chrome.downloads.onChanged.removeListener(listener);
        delta.state.current === "complete" ? resolve() : reject(new Error("The download was interrupted."));
      }
    };
    chrome.downloads.onChanged.addListener(listener);
  });
}

async function saveLocally(chunks, fileName, settings) {
  await ensureOffscreen();
  await offscreen("begin", { fileName, keep: settings.keepCount });
  try {
    for (const data of chunks) await offscreen("chunk", { data });
    try {
      const written = await offscreen("commit");
      return { location: `Folder: ${written.folderName}`, pruned: written.pruned };
    } catch (error) {
      if (error.code !== "permission" && error.code !== "no-folder") throw error;
      // Folder access is missing or expired: still keep a copy, in Downloads.
      const { url } = await offscreen("object-url");
      const downloadId = await chrome.downloads.download({ url, filename: `${FALLBACK_DOWNLOAD_FOLDER}/${fileName}`, conflictAction: "uniquify", saveAs: false });
      await waitForDownload(downloadId);
      return {
        location: `Downloads / ${FALLBACK_DOWNLOAD_FOLDER}`,
        warning: error.code === "no-folder"
          ? "No backup folder chosen yet, so it went to Downloads. Choose a folder in the settings."
          : "Folder access needs re-granting, so it went to Downloads. Click \"Re-grant access\".",
      };
    }
  } finally {
    await offscreen("release").catch(() => {});
  }
}

// ---------------------------------------------------------------- backup pipeline

async function runBackup(chunks, meta) {
  if (jobRunning) throw new Error("A backup is already running.");
  jobRunning = true;
  const settings = await getSettings();
  const fileName = backupFileName();
  const targets = settings.destination === "both" ? ["drive", "local"] : [settings.destination];
  try {
    const done = [];
    const failed = [];
    for (const target of targets) {
      try {
        if (target === "drive") {
          const bytes = new Blob(chunks.map(base64ToBytes), { type: "application/zip" });
          done.push(await uploadToDrive(bytes, fileName, settings));
        } else {
          done.push(await saveLocally(chunks, fileName, settings));
        }
      } catch (error) {
        failed.push(`${target === "drive" ? "Google Drive" : "Local folder"}: ${error.message}`);
      }
    }
    if (!done.length) throw new Error(failed.join(" · "));

    const warnings = [...done.map((result) => result.warning), ...failed.map((message) => `Not saved to ${message}`)];
    if (meta.missing > 0) {
      warnings.push(`${meta.missing} design${meta.missing === 1 ? "" : "s"} could not be read by Layerling and ${meta.missing === 1 ? "is" : "are"} missing from this backup. Open ${meta.missing === 1 ? "it" : "them"} in Layerling to check.`);
    }
    // A partial backup is retried next time, not marked as up to date.
    if (!failed.length && !(meta.missing > 0)) {
      await chrome.storage.local.set({ lastSignature: `${settings.destination}:${meta.signature}` });
    }
    const drive = done.find((result) => result.link);
    const status = {
      ok: true,
      trigger: meta.trigger,
      destination: settings.destination,
      fileName,
      size: meta.size,
      location: done.map((result) => result.location).join(" + "),
      link: drive?.link,
      warning: warnings.filter(Boolean).join(" ") || undefined,
    };
    await setStatus(status);
    return status;
  } catch (error) {
    await setStatus({ ok: false, trigger: meta.trigger, destination: settings.destination, error: error.message });
    throw error;
  } finally {
    jobRunning = false;
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "llb-upload") return;
  let meta = null;
  let chunks = [];
  port.onMessage.addListener(async (message) => {
    if (message.type === "start") {
      meta = message;
      chunks = [];
    } else if (message.type === "chunk") {
      chunks.push(message.data);
    } else if (message.type === "end") {
      try {
        const result = await runBackup(chunks, meta);
        port.postMessage({ type: "done", result });
      } catch (error) {
        port.postMessage({ type: "error", message: error.message });
      } finally {
        chunks = [];
      }
    }
  });
});

// ---------------------------------------------------------------- messages from popup / options / content

async function autoCheck({ count, signature }) {
  const settings = await getSettings();
  if (!settings.autoBackup) return { run: false, reason: "auto backup is off" };
  if (!count) return { run: false, reason: "nothing to back up" };
  if (jobRunning) return { run: false, reason: "busy" };
  if (settings.onlyWhenChanged) {
    const { lastSignature } = await chrome.storage.local.get("lastSignature");
    if (lastSignature === `${settings.destination}:${signature}`) return { run: false, reason: "unchanged" };
  }
  return { run: true };
}

async function backupNow() {
  // Sign in first if needed. Runs here, not in the popup, because the popup closes when Google's window opens.
  const settings = await getSettings();
  if (settings.destination !== "local" && !(await accountStatus()).connected) await driveConnect();
  const tabs = await chrome.tabs.query({ url: LAYERLING_TABS });
  if (!tabs.length) throw new Error("No Layerling tab is open. Open layerling.com and try again.");
  // Prefer the active tab, then any other.
  tabs.sort((a, b) => Number(b.active) - Number(a.active));
  let lastError = null;
  for (const tab of tabs) {
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { type: "backup-now" });
      if (response?.ok) return response.result;
      lastError = new Error(response?.error ?? "Backup failed.");
      if (!response?.notOnStartPage) break;
    } catch {
      lastError = new Error("Reload the Layerling tab once so the extension can reach it.");
    }
  }
  // Errors from inside the upload are already recorded; record the rest.
  const { status } = await chrome.storage.local.get("status");
  if (!status || status.time < Date.now() - 2000) await setStatus({ ok: false, trigger: "manual", error: lastError.message });
  throw lastError;
}

async function driveConnect() {
  const { email } = await connect();
  // A different account has its own folder.
  await chrome.storage.local.remove(["driveFolderId", "driveFolderName", "lastSignature"]);
  const settings = await getSettings();
  await ensureDriveFolder(settings.driveFolderName);
  return { connected: true, email };
}

async function driveDisconnect() {
  await disconnect();
  await chrome.storage.local.remove(["driveFolderId", "driveFolderName"]);
  return { connected: false };
}

async function driveStatus() {
  const account = await accountStatus();
  if (!account.connected) return account;
  const { driveFolderId } = await chrome.storage.local.get("driveFolderId");
  return { ...account, folderLink: driveFolderId ? `https://drive.google.com/drive/folders/${driveFolderId}` : null };
}

const handlers = {
  "auto-check": autoCheck,
  "report-error": (message) => setStatus({ ok: false, trigger: message.trigger, error: message.message }).then(() => ({})),
  "backup-now": backupNow,
  "drive-connect": driveConnect,
  "drive-disconnect": driveDisconnect,
  "drive-status": driveStatus,
  "clear-status": () => chrome.action.setBadgeText({ text: "" }).then(() => ({})),
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handler = message?.target ? null : handlers[message?.type];
  if (!handler) return;
  handler(message).then(
    (result) => sendResponse({ ok: true, result }),
    (error) => sendResponse({ ok: false, error: error.message }),
  );
  return true;
});