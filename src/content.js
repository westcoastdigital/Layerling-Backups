// Isolated content script on layerling.com.
// - Watches for the start page appearing (first load, or coming back from the editor) and asks
//   the extension whether an automatic backup is due.
// - Runs a backup by clicking Layerling's own "Back up all" button, so the file is exactly what
//   Layerling's "Restore backup" expects, then streams the ZIP to the extension in chunks.

const ARM_ATTR = "data-llb-capture";
const PROJECTS_KEY = "layerling.projects";
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

async function projectState() {
  let list = [];
  try {
    const parsed = JSON.parse(localStorage.getItem(PROJECTS_KEY) ?? "[]");
    if (Array.isArray(parsed)) list = parsed;
  } catch {
    // Unreadable list: treat as empty.
  }
  const raw = list
    .map((p) => `${p.id}:${p.updatedAt ?? ""}:${p.revision ?? ""}:${p.name ?? ""}`)
    .sort()
    .join("|");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  const signature = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return { count: list.length, signature };
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

async function sendToExtension(blob, signature, trigger) {
  const port = chrome.runtime.connect({ name: "llb-upload" });
  const result = new Promise((resolve, reject) => {
    port.onMessage.addListener((message) => {
      if (message.type === "done") resolve(message.result);
      else if (message.type === "error") reject(new Error(message.message));
      port.disconnect();
    });
    port.onDisconnect.addListener(() => reject(new Error("The extension stopped before the backup finished.")));
  });

  port.postMessage({ type: "start", size: blob.size, signature, trigger });
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
    const { count, signature } = await projectState();
    if (trigger === "auto") {
      const response = await chrome.runtime.sendMessage({ type: "auto-check", count, signature });
      const decision = response?.result;
      if (!decision?.run) return { skipped: decision?.reason ?? "skipped" };
    }
    const { blob } = await captureBackup();
    return await sendToExtension(blob, signature, trigger);
  } catch (error) {
    if (trigger === "auto") chrome.runtime.sendMessage({ type: "report-error", trigger, message: error.message }).catch(() => {});
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
