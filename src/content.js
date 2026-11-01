// Isolated content script on layerling.com.
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
const IDLE_LIMIT_MS = 20000;
const HARD_LIMIT_MS = 10 * 60 * 1000;

let busy = false;
let dashboardVisible = false;
let autoTimer = null;
let checkQueued = false;

function findBackupButton() {
  // Several dashboard buttons share .dashboard-backup-button; "Back up all" is the one with the Archive icon.
  const icon = document.querySelector(".dashboard-backup-button svg.lucide-archive");
  return icon ? icon.closest("button") : null;
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
    let lastActivity = started;

    const poll = setInterval(() => {
      const now = Date.now();
      if (localStorage.getItem(PROGRESS_KEY)) lastActivity = now;
      if (now - lastActivity > IDLE_LIMIT_MS) finish(new Error("Layerling produced no backup - there may be nothing to back up."));
      else if (now - started > HARD_LIMIT_MS) finish(new Error("Layerling's backup took longer than 10 minutes."));
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

async function sendToExtension(blob, signature, trigger, missing) {
  const port = chrome.runtime.connect({ name: "llb-upload" });
  const result = new Promise((resolve, reject) => {
    port.onMessage.addListener((message) => {
      if (message.type === "done") resolve(message.result);
      else if (message.type === "error") reject(new Error(message.message));
      port.disconnect();
    });
    port.onDisconnect.addListener(() => reject(new Error("The extension stopped before the backup finished.")));
  });

  port.postMessage({ type: "start", size: blob.size, signature, trigger, missing });
  for (let offset = 0; offset < blob.size; offset += CHUNK_SIZE) {
    port.postMessage({ type: "chunk", data: await blobToBase64(blob.slice(offset, offset + CHUNK_SIZE)) });
  }
  port.postMessage({ type: "end" });
  return result;
}

async function runBackup(trigger) {
  if (busy) throw new Error("A backup is already running.");
  busy = true;
  try {
    const { designs, shapes, signature } = await projectState();
    if (trigger === "auto") {
      const response = await chrome.runtime.sendMessage({ type: "auto-check", count: designs + shapes, signature });
      const decision = response?.result;
      if (!decision?.run) return { skipped: decision?.reason ?? "skipped" };
    } else if (!designs && !shapes) {
      throw new Error("No designs to back up yet.");
    }
    const { blob } = await captureBackup();
    const inZip = await countDesignsInZip(blob);
    const missing = inZip === null ? 0 : Math.max(0, designs - inZip);
    const result = await sendToExtension(blob, signature, trigger, missing);
    showToast(result.warning
      ? { kind: "warn", title: "Backup saved with warnings", detail: result.warning }
      : { kind: "ok", title: "Backup successful", detail: result.location });
    return result;
  } catch (error) {
    if (trigger === "auto") chrome.runtime.sendMessage({ type: "report-error", trigger, message: error.message }).catch(() => {});
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