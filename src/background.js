import { getSettings, backupFileName, base64ToBytes, BACKUP_FILE_PATTERN, FALLBACK_DOWNLOAD_FOLDER, SELF_HOSTED_KEY, grantedSelfHostedOrigins, layerlingTabPatterns, originPattern } from "./shared.js";
import { connect, getAccessToken, invalidateToken, disconnect, accountStatus } from "./google-auth.js";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const FOLDER_MIME = "application/vnd.google-apps.folder";

let jobRunning = false;

// ---------------------------------------------------------------- self-hosted Layerling

// The manifest's content scripts cover layerling.com. Self-hosted addresses get the same scripts
// registered at runtime, for the origins the user added in Settings and granted access to.
const SELF_HOSTED_SCRIPT_IDS = ["llb-self-hosted-hook", "llb-self-hosted-content"];
let syncingScripts = Promise.resolve();

function syncSelfHostedScripts() {
  syncingScripts = syncingScripts.then(async () => {
    const matches = (await grantedSelfHostedOrigins()).map(originPattern);
    const registered = await chrome.scripting.getRegisteredContentScripts({ ids: SELF_HOSTED_SCRIPT_IDS });
    if (registered.length) await chrome.scripting.unregisterContentScripts({ ids: registered.map((script) => script.id) });
    if (!matches.length) return;
    await chrome.scripting.registerContentScripts([
      { id: SELF_HOSTED_SCRIPT_IDS[0], matches, js: ["src/page-hook.js"], runAt: "document_start", world: "MAIN" },
      { id: SELF_HOSTED_SCRIPT_IDS[1], matches, js: ["src/toast.js", "src/dimensions.js", "src/content.js"], runAt: "document_idle" },
    ]);
  }).catch((error) => console.error("Layerling Backup: registering self-hosted scripts failed", error));
  return syncingScripts;
}

chrome.runtime.onInstalled.addListener(() => syncSelfHostedScripts());
chrome.runtime.onStartup.addListener(() => syncSelfHostedScripts());
chrome.permissions.onAdded.addListener(() => syncSelfHostedScripts());
chrome.permissions.onRemoved.addListener(() => syncSelfHostedScripts());
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && SELF_HOSTED_KEY in changes) syncSelfHostedScripts();
});

// Each Layerling origin (layerling.com, a local Docker copy) has its own designs, so "unchanged" is tracked per origin.
async function getLastSignature(origin) {
  const { lastSignatures } = await chrome.storage.local.get("lastSignatures");
  return lastSignatures?.[origin ?? ""];
}

async function setLastSignature(origin, value) {
  const { lastSignatures } = await chrome.storage.local.get("lastSignatures");
  await chrome.storage.local.set({ lastSignatures: { ...(lastSignatures ?? {}), [origin ?? ""]: value } });
}

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

// ---------------------------------------------------------------- one backup at a time, crash guard, back-off

// A backup holds this lock from "begin" until it ends. The tab running it renews `beat` every few seconds, so a lock
// whose beat has gone quiet belongs to a tab that died mid-backup - most likely Layerling ran out of memory.
const LOCK_KEY = "backupLock";
const GUARD_KEY = "autoGuard"; // { [origin]: { paused?: { at, reason }, failedAt?: number } }
const LOCK_STALE_MS = 60 * 1000;
const AUTO_BACKOFF_MS = 3 * 60 * 60 * 1000;
const PAUSE_REASON = "The last backup didn't finish. This can happen when Layerling runs out of memory with large or many designs. Automatic backup is paused: use \"Back up now\" in the extension popup, and a successful backup turns it back on.";

async function getGuard(origin) {
  const guard = (await chrome.storage.local.get(GUARD_KEY))[GUARD_KEY] ?? {};
  return guard[origin ?? ""] ?? {};
}

async function updateGuard(origin, change) {
  const guard = (await chrome.storage.local.get(GUARD_KEY))[GUARD_KEY] ?? {};
  const next = change({ ...(guard[origin ?? ""] ?? {}) });
  await chrome.storage.local.set({ [GUARD_KEY]: { ...guard, [origin ?? ""]: next } });
}

async function releaseLock(token) {
  const lock = (await chrome.storage.local.get(LOCK_KEY))[LOCK_KEY];
  if (lock && (!token || lock.token === token)) await chrome.storage.local.remove(LOCK_KEY);
}

/** A backup ended: success clears the guard for its origin, failure starts the back-off. */
async function recordOutcome(meta, { ok, partial }) {
  if (ok && !partial) await updateGuard(meta.origin, () => ({}));
  else if (meta.trigger === "auto" || partial) await updateGuard(meta.origin, (entry) => ({ ...entry, failedAt: Date.now() }));
}

async function begin(message, sender) {
  const { trigger, count, signature, origin } = message;
  const tabId = sender?.tab?.id;
  const lock = (await chrome.storage.local.get(LOCK_KEY))[LOCK_KEY];
  if (lock) {
    // The same tab asking again means the page that held the lock is gone (reloaded or crashed).
    const dead = Date.now() - lock.beat > LOCK_STALE_MS || lock.tabId === tabId;
    if (!dead) {
      if (trigger === "auto") return { run: false, reason: "busy" };
      throw new Error("A backup is already running in another Layerling tab.");
    }
    await chrome.storage.local.remove(LOCK_KEY);
    await updateGuard(lock.origin, (entry) => ({ ...entry, paused: { at: Date.now(), reason: PAUSE_REASON } }));
    await setStatus({ ok: false, trigger: lock.trigger, error: PAUSE_REASON });
  }

  if (trigger === "auto") {
    const settings = await getSettings();
    if (!settings.autoBackup) return { run: false, reason: "auto backup is off" };
    if (!count) return { run: false, reason: "nothing to back up" };
    if (jobRunning) return { run: false, reason: "busy" };
    const guard = await getGuard(origin);
    if (guard.paused) return { run: false, reason: "paused", message: guard.paused.reason };
    if (guard.failedAt && Date.now() - guard.failedAt < AUTO_BACKOFF_MS) return { run: false, reason: "backing off after a failed backup" };
    if (settings.onlyWhenChanged && (await getLastSignature(origin)) === `${settings.destination}:${signature}`) {
      return { run: false, reason: "unchanged" };
    }
  }

  const token = crypto.randomUUID();
  await chrome.storage.local.set({ [LOCK_KEY]: { token, origin, trigger, tabId, startedAt: Date.now(), beat: Date.now() } });
  return { run: true, token };
}

async function beat({ token }) {
  const lock = (await chrome.storage.local.get(LOCK_KEY))[LOCK_KEY];
  if (lock?.token === token) await chrome.storage.local.set({ [LOCK_KEY]: { ...lock, beat: Date.now() } });
  return {};
}

/** The tab gave up before handing over a ZIP (or the page is being left on purpose). */
async function finish({ token, trigger, origin, message, left }) {
  await releaseLock(token);
  if (left) return {};
  await recordOutcome({ trigger, origin }, { ok: false });
  await setStatus({ ok: false, trigger, error: message });
  return {};
}

// ---------------------------------------------------------------- backup pipeline (streamed)

// Chunks are passed on as they arrive instead of being collected first: straight into the chosen folder
// (offscreen document), and for Drive as Blob parts, which Chrome keeps out of the worker's heap.
async function startJob(meta) {
  if (jobRunning) throw new Error("A backup is already running.");
  jobRunning = true;
  try {
    const settings = await getSettings();
    const job = {
      meta,
      settings,
      fileName: backupFileName(),
      targets: settings.destination === "both" ? ["drive", "local"] : [settings.destination],
      driveParts: [],
      localError: null,
    };
    if (job.targets.includes("local")) {
      try {
        await ensureOffscreen();
        await offscreen("begin", { fileName: job.fileName, keep: settings.keepCount });
      } catch (error) {
        job.localError = error;
      }
    }
    return job;
  } catch (error) {
    jobRunning = false;
    throw error;
  }
}

async function addChunk(job, data) {
  if (job.targets.includes("drive")) job.driveParts.push(new Blob([base64ToBytes(data)]));
  if (job.targets.includes("local") && !job.localError) {
    await offscreen("chunk", { data }).catch((error) => {
      job.localError = error;
    });
  }
}

async function saveLocally(job) {
  try {
    if (job.localError) throw job.localError;
    try {
      const written = await offscreen("commit");
      return { location: `Folder: ${written.folderName}`, pruned: written.pruned };
    } catch (error) {
      if (error.code !== "permission" && error.code !== "no-folder") throw error;
      // Folder access is missing or expired: still keep a copy, in Downloads.
      const { url } = await offscreen("object-url");
      const downloadId = await chrome.downloads.download({ url, filename: `${FALLBACK_DOWNLOAD_FOLDER}/${job.fileName}`, conflictAction: "uniquify", saveAs: false });
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

async function finishJob(job) {
  const { meta, settings, fileName } = job;
  try {
    const done = [];
    const failed = [];
    for (const target of job.targets) {
      try {
        if (target === "drive") {
          const bytes = new Blob(job.driveParts, { type: "application/zip" });
          job.driveParts = [];
          done.push(await uploadToDrive(bytes, fileName, settings));
        } else {
          done.push(await saveLocally(job));
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
    // A partial backup is retried later (after the back-off), not marked as up to date.
    const partial = failed.length > 0 || meta.missing > 0;
    if (!partial) await setLastSignature(meta.origin, `${settings.destination}:${meta.signature}`);
    await recordOutcome(meta, { ok: true, partial });
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
    await recordOutcome(meta, { ok: false });
    await setStatus({ ok: false, trigger: meta.trigger, destination: settings.destination, error: error.message });
    throw error;
  } finally {
    job.driveParts = [];
    jobRunning = false;
    await releaseLock(meta.token);
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "llb-upload") return;
  let job = null;
  let failure = null;
  // Messages are handled strictly in order; each chunk is acknowledged once it has been passed on, so the
  // tab sends the next one only then and nothing piles up in between.
  let queue = Promise.resolve();
  const abandon = () => {
    if (!job) return;
    if (job.targets.includes("local")) offscreen("release").catch(() => {});
    job.driveParts = [];
    jobRunning = false;
    job = null;
  };
  port.onDisconnect.addListener(() => {
    queue = queue.then(abandon);
  });
  port.onMessage.addListener((message) => {
    queue = queue.then(async () => {
      try {
        if (message.type === "start") {
          failure = null;
          job = await startJob(message);
          port.postMessage({ type: "ack" });
        } else if (message.type === "chunk") {
          if (job) await addChunk(job, message.data);
          port.postMessage({ type: "ack" });
        } else if (message.type === "end") {
          if (!job) throw failure ?? new Error("The backup was not started.");
          const current = job;
          job = null;
          port.postMessage({ type: "done", result: await finishJob(current) });
        }
      } catch (error) {
        failure = error;
        if (message.type === "start") await releaseLock(message.token);
        port.postMessage({ type: "error", message: error.message });
      }
    });
  });
});

// ---------------------------------------------------------------- messages from popup / options / content

async function backupNow() {
  // Sign in first if needed. Runs here, not in the popup, because the popup closes when Google's window opens.
  const settings = await getSettings();
  if (settings.destination !== "local" && !(await accountStatus()).connected) await driveConnect();
  const tabs = await chrome.tabs.query({ url: await layerlingTabPatterns() });
  if (!tabs.length) throw new Error("No Layerling tab is open. Open layerling.com (or your self-hosted address from Settings) and try again.");
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
  await chrome.storage.local.remove(["driveFolderId", "driveFolderName", "lastSignature", "lastSignatures"]);
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
  begin,
  beat,
  finish,
  "backup-now": backupNow,
  "drive-connect": driveConnect,
  "drive-disconnect": driveDisconnect,
  "drive-status": driveStatus,
  "sync-self-hosted": () => syncSelfHostedScripts().then(() => ({})),
  "clear-status": () => chrome.action.setBadgeText({ text: "" }).then(() => ({})),
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handler = message?.target ? null : handlers[message?.type];
  if (!handler) return;
  handler(message, _sender).then(
    (result) => sendResponse({ ok: true, result }),
    (error) => sendResponse({ ok: false, error: error.message }),
  );
  return true;
});