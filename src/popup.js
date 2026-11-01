import { getSettings, getDirHandle, dirPermission, formatBytes, timeAgo } from "./shared.js";

const $ = (id) => document.getElementById(id);

async function send(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  if (!response?.ok) throw new Error(response?.error ?? "No response from the extension.");
  return response.result;
}

function showMessage(text, kind) {
  const el = $("action-message");
  el.textContent = text;
  el.className = `small status-${kind}`;
}

async function renderStatus() {
  const { status } = await chrome.storage.local.get("status");
  const line = $("status-line");
  const detail = $("status-detail");
  if (!status) return;

  const kind = !status.ok ? "err" : status.warning ? "warn" : "ok";
  const how = status.trigger === "auto" ? "Auto backup" : "Backup";
  line.innerHTML = "";
  const dot = document.createElement("span");
  dot.className = `dot ${kind}`;
  line.append(dot, status.ok ? `${how} ${timeAgo(status.time)}` : `${how} failed ${timeAgo(status.time)}`);

  detail.classList.remove("hidden");
  detail.innerHTML = "";
  if (status.ok) {
    detail.append(`${status.fileName} · ${formatBytes(status.size)}`, document.createElement("br"));
    if (status.link) {
      const a = document.createElement("a");
      a.href = status.link;
      a.target = "_blank";
      a.textContent = status.location;
      detail.append(a);
    } else {
      detail.append(status.location ?? "");
    }
    if (status.warning) {
      const warn = document.createElement("div");
      warn.className = "status-warn";
      warn.textContent = status.warning;
      detail.append(warn);
    }
  } else {
    const err = document.createElement("span");
    err.className = "status-err";
    err.textContent = status.error;
    detail.append(err);
  }
}

async function renderDestination() {
  const settings = await getSettings();
  document.querySelector(`input[name="destination"][value="${settings.destination}"]`).checked = true;
  $("auto-backup").checked = settings.autoBackup;
  const useDrive = settings.destination !== "local";
  const useLocal = settings.destination !== "drive";
  $("drive-row").classList.toggle("hidden", !useDrive);
  $("local-row").classList.toggle("hidden", !useLocal);

  if (useDrive) {
    const drive = await send("drive-status").catch(() => ({ connected: false }));
    $("drive-state").innerHTML = "";
    const dot = document.createElement("span");
    dot.className = `dot ${drive.connected ? "ok" : "off"}`;
    $("drive-state").append(dot, drive.connected ? drive.email ?? "Connected" : "Not connected");
    $("drive-state").title = drive.connected ? `Backing up to ${settings.driveFolderName}` : "";
    $("drive-connect").classList.toggle("hidden", drive.connected);
  }
  if (useLocal) {
    const handle = await getDirHandle();
    const permission = await dirPermission(handle);
    $("local-state").innerHTML = "";
    const dot = document.createElement("span");
    dot.className = `dot ${permission === "granted" ? "ok" : handle ? "warn" : "off"}`;
    $("local-state").append(dot, handle ? handle.name : "No folder chosen");
    $("local-regrant").classList.toggle("hidden", !handle || permission === "granted");
    $("local-choose").classList.toggle("hidden", Boolean(handle));
  }
}

$("open-options").addEventListener("click", (event) => {
  event.preventDefault();
  chrome.runtime.openOptionsPage();
});

$("local-choose").addEventListener("click", () => chrome.runtime.openOptionsPage());

for (const input of document.querySelectorAll('input[name="destination"]')) {
  input.addEventListener("change", async () => {
    await chrome.storage.sync.set({ destination: input.value });
    renderDestination();
  });
}

$("auto-backup").addEventListener("change", (event) => chrome.storage.sync.set({ autoBackup: event.target.checked }));

$("drive-connect").addEventListener("click", async () => {
  $("drive-connect").disabled = true;
  try {
    await send("drive-connect");
  } catch (error) {
    showMessage(error.message, "err");
  }
  $("drive-connect").disabled = false;
  renderDestination();
});

$("local-regrant").addEventListener("click", async () => {
  const handle = await getDirHandle();
  try {
    const result = await handle.requestPermission({ mode: "readwrite" });
    if (result !== "granted") showMessage("Access was not granted.", "warn");
  } catch (error) {
    showMessage(error.message, "err");
  }
  renderDestination();
});

$("backup-now").addEventListener("click", async () => {
  const button = $("backup-now");
  button.disabled = true;
  button.textContent = "Backing up…";
  $("action-message").classList.add("hidden");
  try {
    await send("backup-now");
  } catch (error) {
    showMessage(error.message, "err");
  }
  button.disabled = false;
  button.textContent = "Back up now";
  renderStatus();
  renderDestination();
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.status) renderStatus();
});

renderStatus();
renderDestination();