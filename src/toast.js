// On-page notification for backup results, top right of the Layerling window.
// Fades in, waits, then slides up while fading out. Hovering keeps it open.
// Lives in a shadow root so Layerling's styles and ours never mix.

const TOAST_TIMES = { ok: 3500, warn: 7000, error: 8000 };

const TOAST_CSS = `
  :host { all: initial; }
  .toast {
    position: fixed; top: 16px; right: 16px; z-index: 2147483647;
    display: flex; gap: 10px; align-items: flex-start;
    width: min(340px, calc(100vw - 32px)); box-sizing: border-box;
    padding: 12px 14px; border-radius: 12px;
    background: #2b2116; color: #f3ebe0;
    border: 1px solid rgba(255,255,255,0.08);
    box-shadow: 0 10px 30px rgba(0,0,0,0.28), 0 2px 6px rgba(0,0,0,0.18);
    font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
    opacity: 0; transform: translateY(0) scale(0.98);
    animation: llb-in 260ms ease-out forwards;
  }
  .toast.leaving { animation: llb-out 420ms ease-in forwards; }
  @keyframes llb-in { from { opacity: 0; transform: translateY(0) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
  @keyframes llb-out { from { opacity: 1; transform: translateY(0); } to { opacity: 0; transform: translateY(-24px); } }
  @media (prefers-reduced-motion: reduce) {
    @keyframes llb-out { from { opacity: 1; } to { opacity: 0; } }
  }
  .icon { flex: none; width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; font-weight: 700; font-size: 13px; color: #1d1712; }
  .ok .icon { background: #5cc28a; }
  .warn .icon { background: #f0b04a; }
  .error .icon { background: #ef6b5b; }
  .body { min-width: 0; flex: 1; }
  .title { font-weight: 600; }
  .detail { color: #c9b9a4; font-size: 12px; margin-top: 2px; overflow-wrap: anywhere; }
  .close { all: unset; cursor: pointer; color: #b3a491; font-size: 16px; line-height: 1; padding: 2px 4px; border-radius: 4px; }
  .close:hover { color: #f3ebe0; background: rgba(255,255,255,0.08); }
`;

let toastHost = null;

function ensureToastHost() {
  if (toastHost?.isConnected) return toastHost.shadowRoot;
  toastHost = document.createElement("layerling-backup-toast");
  const root = toastHost.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = TOAST_CSS;
  root.append(style);
  document.documentElement.append(toastHost);
  return root;
}

async function showToast({ kind = "ok", title, detail }) {
  try {
    const { showToast: enabled = true } = await chrome.storage.sync.get("showToast");
    if (!enabled) return;
  } catch {
    // Extension reloaded under the page: skip.
    return;
  }

  const root = ensureToastHost();
  root.querySelector(".toast")?.remove();

  const toast = document.createElement("div");
  toast.className = `toast ${kind}`;
  toast.setAttribute("role", kind === "error" ? "alert" : "status");

  const icon = document.createElement("div");
  icon.className = "icon";
  icon.textContent = kind === "ok" ? "✓" : "!";

  const body = document.createElement("div");
  body.className = "body";
  const titleEl = document.createElement("div");
  titleEl.className = "title";
  titleEl.textContent = title;
  body.append(titleEl);
  if (detail) {
    const detailEl = document.createElement("div");
    detailEl.className = "detail";
    detailEl.textContent = detail;
    body.append(detailEl);
  }

  const close = document.createElement("button");
  close.className = "close";
  close.setAttribute("aria-label", "Dismiss");
  close.textContent = "×";

  toast.append(icon, body, close);
  root.append(toast);

  let timer = null;
  const leave = () => {
    if (toast.classList.contains("leaving")) return;
    toast.classList.add("leaving");
    toast.addEventListener("animationend", () => toast.remove(), { once: true });
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(leave, TOAST_TIMES[kind] ?? 4000);
  };
  toast.addEventListener("mouseenter", () => clearTimeout(timer));
  toast.addEventListener("mouseleave", schedule);
  close.addEventListener("click", leave);
  schedule();
}