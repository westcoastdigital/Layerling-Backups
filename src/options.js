import { getSettings, getDirHandle, setDirHandle, dirPermission, SELF_HOSTED_KEY, getSelfHostedOrigins, normalizeOrigin, originPattern } from "./shared.js";

const $ = (id) => document.getElementById(id);
let savedTimer = null;

async function send(type) {
  const response = await chrome.runtime.sendMessage({ type });
  if (!response?.ok) throw new Error(response?.error ?? "No response from the extension.");
  return response.result;
}

async function save(values) {
  await chrome.storage.sync.set(values);
  $("saved").classList.remove("hidden");
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => $("saved").classList.add("hidden"), 1500);
}

function setState(el, kind, text) {
  el.innerHTML = "";
  const dot = document.createElement("span");
  dot.className = `dot ${kind}`;
  el.append(dot, text);
}

async function renderDrive() {
  const drive = await send("drive-status").catch((error) => ({ connected: false, error: error.message }));
  setState($("drive-state"), drive.connected ? "ok" : "off", drive.connected ? drive.email ?? "Connected" : "Not connected");
  $("drive-connect").textContent = drive.connected ? "Disconnect" : "Connect";
  $("drive-switch").classList.toggle("hidden", !drive.connected);
  $("drive-connect").dataset.connected = drive.connected ? "1" : "";
  $("drive-open").classList.toggle("hidden", !drive.folderLink);
  if (drive.folderLink) $("drive-open").href = drive.folderLink;
}

async function renderLocal() {
  const handle = await getDirHandle();
  const permission = await dirPermission(handle);
  if (!handle) setState($("local-state"), "off", "No folder chosen");
  else setState($("local-state"), permission === "granted" ? "ok" : "warn", permission === "granted" ? handle.name : `${handle.name} (access needed)`);
  $("local-regrant").classList.toggle("hidden", !handle || permission === "granted");
  $("local-choose").textContent = handle ? "Change folder…" : "Choose folder…";
}

function renderSections(destination) {
  $("drive-section").style.opacity = destination !== "local" ? "1" : "0.6";
  $("local-section").style.opacity = destination !== "drive" ? "1" : "0.6";
}

// ---------------------------------------------------------------- self-hosted addresses

function hostError(message) {
  $("host-error").textContent = message ?? "";
  $("host-error").classList.toggle("hidden", !message);
}

async function renderHosts() {
  const list = $("hosts");
  list.innerHTML = "";
  for (const origin of await getSelfHostedOrigins()) {
    const granted = await chrome.permissions.contains({ origins: [originPattern(origin)] });
    const row = document.createElement("div");
    row.className = "row";
    const state = document.createElement("span");
    setState(state, granted ? "ok" : "warn", granted ? origin : `${origin} (access needed)`);
    const actions = document.createElement("span");
    if (!granted) {
      const grant = document.createElement("button");
      grant.textContent = "Allow access";
      grant.addEventListener("click", () => grantHost(origin));
      actions.append(grant, " ");
    }
    const remove = document.createElement("button");
    remove.textContent = "Remove";
    remove.addEventListener("click", () => removeHost(origin));
    actions.append(remove);
    row.append(state, actions);
    list.append(row);
  }
}

// Called straight from a click: Chrome only shows the permission prompt during a user gesture.
async function grantHost(origin) {
  hostError();
  try {
    const granted = await chrome.permissions.request({ origins: [originPattern(origin)] });
    if (!granted) hostError(`Access to ${origin} wasn't allowed, so backups won't run there.`);
  } catch (error) {
    hostError(error.message);
  }
  await send("sync-self-hosted").catch(() => {});
  renderHosts();
}

async function addHost() {
  hostError();
  const raw = $("host-input").value;
  const origin = normalizeOrigin(raw);
  if (!origin) {
    hostError(/layerling\.com/i.test(raw) ? "layerling.com is always supported, no need to add it." : "Enter an address like localhost:3000, 192.168.1.50:3000 or https://cad.example.com.");
    return;
  }
  const permission = chrome.permissions.request({ origins: [originPattern(origin)] }); // before any await
  const origins = await getSelfHostedOrigins();
  if (!origins.includes(origin)) await save({ [SELF_HOSTED_KEY]: [...origins, origin] });
  $("host-input").value = "";
  try {
    if (!(await permission)) hostError(`Access to ${origin} wasn't allowed. Click "Allow access" to try again.`);
  } catch (error) {
    hostError(error.message);
  }
  await send("sync-self-hosted").catch(() => {});
  renderHosts();
}

async function removeHost(origin) {
  hostError();
  await save({ [SELF_HOSTED_KEY]: (await getSelfHostedOrigins()).filter((entry) => entry !== origin) });
  await chrome.permissions.remove({ origins: [originPattern(origin)] }).catch(() => {});
  await send("sync-self-hosted").catch(() => {});
  renderHosts();
}

$("host-add").addEventListener("click", addHost);
$("host-input").addEventListener("keydown", (event) => {
  if (event.key === "Enter") addHost();
});

async function init() {
  $("version").textContent = chrome.runtime.getManifest().version;
  const settings = await getSettings();
  document.querySelector(`input[name="destination"][value="${settings.destination}"]`).checked = true;
  $("drive-folder").value = settings.driveFolderName;
  $("auto-backup").checked = settings.autoBackup;
  $("only-changed").checked = settings.onlyWhenChanged;
  $("show-toast").checked = settings.showToast;
  $("keep-count").value = settings.keepCount;
  renderSections(settings.destination);
  renderDrive();
  renderLocal();
  renderHosts();
}

for (const input of document.querySelectorAll('input[name="destination"]')) {
  input.addEventListener("change", () => {
    save({ destination: input.value });
    renderSections(input.value);
  });
}

$("drive-folder").addEventListener("change", (event) => {
  const name = event.target.value.trim() || "Layerling Backups";
  event.target.value = name;
  save({ driveFolderName: name });
});
$("auto-backup").addEventListener("change", (event) => save({ autoBackup: event.target.checked }));
$("only-changed").addEventListener("change", (event) => save({ onlyWhenChanged: event.target.checked }));
$("show-toast").addEventListener("change", (event) => save({ showToast: event.target.checked }));
$("keep-count").addEventListener("change", (event) => {
  const keep = Math.max(0, Math.min(999, Number.parseInt(event.target.value, 10) || 0));
  event.target.value = keep;
  save({ keepCount: keep });
});

$("drive-connect").addEventListener("click", async () => {
  const button = $("drive-connect");
  button.disabled = true;
  try {
    await send(button.dataset.connected ? "drive-disconnect" : "drive-connect");
  } catch (error) {
    alert(error.message);
  }
  button.disabled = false;
  renderDrive();
});

$("drive-switch").addEventListener("click", async () => {
  $("drive-switch").disabled = true;
  try {
    await send("drive-connect");
  } catch (error) {
    alert(error.message);
  }
  $("drive-switch").disabled = false;
  renderDrive();
});

$("local-choose").addEventListener("click", async () => {
  try {
    const handle = await window.showDirectoryPicker({ id: "layerling-backups", mode: "readwrite" });
    await setDirHandle(handle);
  } catch (error) {
    if (error.name !== "AbortError") alert(error.message);
  }
  renderLocal();
});

$("local-regrant").addEventListener("click", async () => {
  const handle = await getDirHandle();
  await handle?.requestPermission({ mode: "readwrite" }).catch(() => {});
  renderLocal();
});

init();