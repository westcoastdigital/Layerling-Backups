// Isolated content script on layerling.com and a local (Docker) Layerling on port 3000.
// - Watches for the start page appearing (first load, or coming back from the editor) and asks
//   the extension whether an automatic backup is due.
// - Runs a backup by clicking Layerling's own "Back up all" button, so the file is exactly what
//   Layerling's "Restore backup" expects, then streams the ZIP to the extension in chunks.

const ARM_ATTR = "data-llb-capture";
const PROJECTS_KEY = "layerling.projects";
const FOLDERS_KEY = "layerling.designFolders";
const SHAPES_DB = "layerling-my-shapes";
const SHAPES_STORES = ["meta", "folders"];
const SHAPES_BACKUP_FOLDER = "Custom shapes";
const PROGRESS_KEY = "layerling.backupInProgress";
const CHUNK_SIZE = 4 * 1024 * 1024;
const AUTO_DELAY_MS = 2000;
// Before the first design and while custom shapes are read, Layerling writes no progress marker yet.
const IDLE_LIMIT_MS = 90 * 1000;
// Layerling rewrites its marker before each design; one design taking longer than this counts as stuck.
const STUCK_LIMIT_MS = 15 * 60 * 1000;
const HARD_LIMIT_MS = 60 * 60 * 1000;
const BEAT_MS = 10 * 1000;

let busy = false;
let current = null; // { token, trigger } while this tab holds the backup lock
let dashboardVisible = false;
let autoTimer = null;
let checkQueued = false;

function findBackupButton() {
  // Several dashboard buttons share .dashboard-backup-button; "Back up all" is the one with the Archive icon.
  const icon = document.querySelector(".dashboard-backup-button svg.lucide-archive");
  return icon ? icon.closest("button") : null;
}

// Self-hosted Layerling with a server folder: on the server tab, "Back up all" downloads the server's
// designs instead of this browser's, which the change check and design count don't describe.
// That tab is the one whose toolbar has the Refresh (RefreshCw) button.
function onServerSection() {
  return Boolean(document.querySelector(".dashboard-backup-button svg.lucide-refresh-cw"));
}

function readJsonArray(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Custom shapes live in Layerling's own IndexedDB. Read-only, and only if it already exists:
// opening a database that isn't there would create it.
async function customShapesState() {
  try {
    const databases = await indexedDB.databases();
    if (!databases.some((db) => db.name === SHAPES_DB)) return { count: 0, raw: "" };
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(SHAPES_DB);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const stores = [...db.objectStoreNames].filter((name) => SHAPES_STORES.includes(name));
      if (!stores.length) return { count: 0, raw: "" };
      const tx = db.transaction(stores, "readonly");
      const read = (storeName) =>
        new Promise((resolve, reject) => {
          const rows = [];
          const request = tx.objectStore(storeName).openCursor();
          request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) return resolve(rows);
            const v = cursor.value ?? {};
            rows.push(`${storeName}:${cursor.key}:${v.name ?? ""}:${v.parentId ?? v.folderId ?? ""}:${v.updatedAt ?? v.createdAt ?? ""}`);
            cursor.continue();
          };
          request.onerror = () => reject(request.error);
        });
      const results = await Promise.all(stores.map(read));
      const shapes = stores.includes("meta") ? results[stores.indexOf("meta")].length : 0;
      return { count: shapes, raw: results.flat().sort().join("|") };
    } finally {
      db.close();
    }
  } catch {
    // Can't read it: shapes just don't count toward change detection.
    return { count: 0, raw: "" };
  }
}

async function projectState() {
  const designs = readJsonArray(PROJECTS_KEY).filter((p) => !p.sharedProject);
  const folders = readJsonArray(FOLDERS_KEY);
  const shapes = await customShapesState();
  const raw = [
    designs.map((p) => `d:${p.id}:${p.updatedAt ?? ""}:${p.revision ?? ""}:${p.name ?? ""}:${p.folderId ?? ""}`).sort().join("|"),
    folders.map((f) => `f:${f.id}:${f.name ?? ""}:${f.parentId ?? ""}`).sort().join("|"),
    shapes.raw,
  ].join("#");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  const signature = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return { designs: designs.length, shapes: shapes.count, signature };
}

// Number of designs (.lyl files outside "Custom shapes/") in the ZIP, from its central directory.
// Returns null if the ZIP can't be read this way (the check is then skipped).
async function countDesignsInZip(blob) {
  try {
    const tailSize = Math.min(blob.size, 65557);
    const tail = new DataView(await blob.slice(blob.size - tailSize).arrayBuffer());
    let eocd = -1;
    for (let i = tailSize - 22; i >= 0; i -= 1) {
      if (tail.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) return null;
    const entries = tail.getUint16(eocd + 10, true);
    const dirSize = tail.getUint32(eocd + 12, true);
    const dirOffset = tail.getUint32(eocd + 16, true);
    if (entries === 0xffff || dirOffset === 0xffffffff) return null; // ZIP64: skip
    const dir = new DataView(await blob.slice(dirOffset, dirOffset + dirSize).arrayBuffer());
    const decoder = new TextDecoder();
    let count = 0;
    for (let p = 0, n = 0; n < entries && p + 46 <= dir.byteLength; n += 1) {
      if (dir.getUint32(p, true) !== 0x02014b50) return null;
      const nameLength = dir.getUint16(p + 28, true);
      const extraLength = dir.getUint16(p + 30, true);
      const commentLength = dir.getUint16(p + 32, true);
      const name = decoder.decode(new Uint8Array(dir.buffer, dir.byteOffset + p + 46, nameLength));
      if (/\.(lyl|skf)$/i.test(name) && !name.startsWith(`${SHAPES_BACKUP_FOLDER}/`)) count += 1;
      p += 46 + nameLength + extraLength + commentLength;
    }
    return count;
  } catch {
    return null;
  }
}

function captureBackup() {
  return new Promise((resolve, reject) => {
    const button = findBackupButton();
    if (!button) {
      reject(new Error("Go to the Layerling start page to back up (the editor is open)."));
      return;
    }
    if (button.disabled) {
      reject(new Error("Layerling's backup button is unavailable right now."));
      return;
    }

    const started = Date.now();
    let lastSeen = started; // last time Layerling's progress marker was there
    let marker = null;
    let markerChanged = started;

    const poll = setInterval(() => {
      const now = Date.now();
      const progress = localStorage.getItem(PROGRESS_KEY);
      if (progress) {
        lastSeen = now;
        if (progress !== marker) {
          marker = progress;
          markerChanged = now;
        }
      }
      if (!progress && now - lastSeen > IDLE_LIMIT_MS) finish(new Error("Layerling produced no backup - there may be nothing to back up."));
      else if (progress && now - markerChanged > STUCK_LIMIT_MS) finish(new Error("Layerling's backup stopped making progress on one design for 15 minutes."));
      else if (now - started > HARD_LIMIT_MS) finish(new Error("Layerling's backup took longer than an hour."));
    }, 1000);

    function onMessage(event) {
      if (event.source !== window || event.data?.source !== "llb-hook") return;
      if (event.data.type === "zip") finish(null, { blob: event.data.blob, fileName: event.data.fileName });
      else finish(new Error(event.data.message || "Capturing the backup failed."));
    }

    function finish(error, value) {
      clearInterval(poll);
      window.removeEventListener("message", onMessage);
      document.documentElement.removeAttribute(ARM_ATTR);
      if (error) reject(error);
      else resolve(value);
    }

    window.addEventListener("message", onMessage);
    document.documentElement.setAttribute(ARM_ATTR, "1");
    button.click();
  });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// Each chunk waits for the extension's "ack" before the next is read, so only one chunk is ever in flight.
async function sendToExtension(blob, meta) {
  const port = chrome.runtime.connect({ name: "llb-upload" });
  let waiting = null;
  let closed = null;
  const result = new Promise((resolve, reject) => {
    port.onMessage.addListener((message) => {
      if (message.type === "ack") {
        waiting?.resolve();
        return;
      }
      if (message.type === "done") resolve(message.result);
      else if (message.type === "error") reject(new Error(message.message));
      closed = new Error(message.message ?? "The backup ended.");
      waiting?.reject(closed);
      port.disconnect();
    });
    port.onDisconnect.addListener(() => {
      closed ??= new Error("The extension stopped before the backup finished.");
      waiting?.reject(closed);
      reject(closed);
    });
  });
  result.catch(() => {});
  const post = (message) => {
    if (closed) throw closed;
    const acked = new Promise((resolve, reject) => {
      waiting = { resolve, reject };
    });
    port.postMessage(message);
    return acked;
  };

  try {
    await post({ type: "start", size: blob.size, ...meta, origin: location.origin });
    for (let offset = 0; offset < blob.size; offset += CHUNK_SIZE) {
      await post({ type: "chunk", data: await blobToBase64(blob.slice(offset, offset + CHUNK_SIZE)) });
    }
    port.postMessage({ type: "end" });
  } catch {
    // The reason arrives through `result`.
  }
  return result;
}

async function runBackup(trigger) {
  if (busy) throw new Error("A backup is already running.");
  busy = true;
  try {
    if (onServerSection()) {
      if (trigger === "auto") return { skipped: "server tab open" };
      throw new Error("Switch to the browser designs tab to back up. Designs on the server tab are already stored on the server.");
    }
    const { designs, shapes, signature } = await projectState();
    if (trigger !== "auto" && !designs && !shapes) throw new Error("No designs to back up yet.");
    // Takes the extension-wide lock: one backup at a time across tabs, and the crash guard and back-off for auto.
    const response = await chrome.runtime.sendMessage({ type: "begin", trigger, count: designs + shapes, signature, origin: location.origin });
    if (!response?.ok) throw new Error(response?.error ?? "The extension did not answer.");
    const decision = response.result;
    if (!decision?.run) {
      if (decision?.reason === "paused") showToast({ kind: "warn", title: "Automatic backup paused", detail: decision.message });
      return { skipped: decision?.reason ?? "skipped" };
    }
    current = { token: decision.token, trigger };
    const beat = setInterval(() => chrome.runtime.sendMessage({ type: "beat", token: decision.token }).catch(() => {}), BEAT_MS);
    let blob;
    let missing = 0;
    try {
      ({ blob } = await captureBackup());
      const inZip = await countDesignsInZip(blob);
      missing = inZip === null ? 0 : Math.max(0, designs - inZip);
    } catch (error) {
      clearInterval(beat);
      current = null;
      chrome.runtime.sendMessage({ type: "finish", token: decision.token, trigger, origin: location.origin, message: error.message }).catch(() => {});
      throw error;
    }
    let result;
    try {
      result = await sendToExtension(blob, { signature, trigger, missing, token: decision.token });
    } finally {
      clearInterval(beat);
      current = null;
      blob = null;
    }
    showToast(result.warning
      ? { kind: "warn", title: "Backup saved with warnings", detail: result.warning }
      : { kind: "ok", title: "Backup successful", detail: result.location });
    return result;
  } catch (error) {
    showToast({ kind: "error", title: "Backup failed", detail: error.message });
    throw error;
  } finally {
    busy = false;
  }
}

function checkDashboard() {
  checkQueued = false;
  const visible = Boolean(findBackupButton());
  if (visible && !dashboardVisible) {
    clearTimeout(autoTimer);
    autoTimer = setTimeout(() => {
      if (findBackupButton()) runBackup("auto").catch(() => {});
    }, AUTO_DELAY_MS);
  }
  if (!visible) clearTimeout(autoTimer);
  dashboardVisible = visible;
}

// Leaving or reloading the page mid-backup on purpose is not a crash: let the lock go without pausing auto backup.
window.addEventListener("pagehide", () => {
  if (current) chrome.runtime.sendMessage({ type: "finish", token: current.token, left: true }).catch(() => {});
});

new MutationObserver(() => {
  if (checkQueued) return;
  checkQueued = true;
  requestAnimationFrame(checkDashboard);
}).observe(document.documentElement, { childList: true, subtree: true });
checkDashboard();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "backup-now") return;
  runBackup("manual").then(
    (result) => sendResponse({ ok: true, result }),
    (error) => sendResponse({ ok: false, error: error.message, notOnStartPage: !findBackupButton() }),
  );
  return true;
});