// Shared by the service worker, offscreen document, popup and options page.

export const DEFAULTS = {
  destination: "drive", // "drive" | "local" | "both"
  autoBackup: true,
  showToast: true,
  onlyWhenChanged: true,
  keepCount: 20, // 0 = keep every backup
  driveFolderName: "Layerling Backups",
};

export const BACKUP_FILE_PATTERN = /^layerling-backup-\d{4}-\d{2}-\d{2}-\d{6}\.zip$/;
export const FALLBACK_DOWNLOAD_FOLDER = "Layerling Backups";

export async function getSettings() {
  return { ...DEFAULTS, ...(await chrome.storage.sync.get(DEFAULTS)) };
}

export function backupFileName(date = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `layerling-backup-${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}.zip`;
}

export function base64ToBytes(base64) {
  if (typeof Uint8Array.fromBase64 === "function") return Uint8Array.fromBase64(base64);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function timeAgo(time) {
  const seconds = Math.round((Date.now() - time) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(time).toLocaleString();
}

// --- Chosen local folder: the directory handle lives in IndexedDB (extension origin). ---

const DB_NAME = "layerling-backup";
const STORE = "handles";
const DIR_KEY = "backupDir";

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request?.result);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export const getDirHandle = () => withStore("readonly", (store) => store.get(DIR_KEY)).then((h) => h ?? null);
export const setDirHandle = (handle) => withStore("readwrite", (store) => store.put(handle, DIR_KEY));
export const clearDirHandle = () => withStore("readwrite", (store) => store.delete(DIR_KEY));

export async function dirPermission(handle) {
  if (!handle) return "none";
  try {
    return await handle.queryPermission({ mode: "readwrite" });
  } catch {
    return "prompt";
  }
}