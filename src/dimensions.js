// Shift+Q on layerling.com: hide or show the transform numbers (the sizes beside a selected shape
// and the clickable dimensions in sketch mode). Remembered across reloads.
// Layerling's own Q hides the 3D sizes only and resets on reload; this covers sketch mode too.

const HIDE_CLASS = "llb-hide-dimensions";
const HIDE_KEY = "hideDimensions";

const hideStyle = document.createElement("style");
hideStyle.textContent = `
  html.${HIDE_CLASS} button.dimension-label,
  html.${HIDE_CLASS} .sketch-geometry-dimension.clickable { display: none !important; }
`;
document.documentElement.append(hideStyle);

function applyHidden(hidden) {
  document.documentElement.classList.toggle(HIDE_CLASS, hidden);
}

chrome.storage.local.get(HIDE_KEY).then((stored) => applyHidden(Boolean(stored[HIDE_KEY]))).catch(() => {});

function isTyping(target) {
  if (!(target instanceof Element)) return false;
  return target.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']") !== null;
}

window.addEventListener(
  "keydown",
  (event) => {
    if (event.key?.toLowerCase() !== "q" || !event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.repeat || isTyping(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    const hidden = !document.documentElement.classList.contains(HIDE_CLASS);
    applyHidden(hidden);
    chrome.storage.local.set({ [HIDE_KEY]: hidden }).catch(() => {});
    showToast({ kind: "info", title: hidden ? "Transform numbers hidden" : "Transform numbers shown", detail: "Shift+Q to toggle", always: true });
  },
  true,
);

// Keep other Layerling tabs in step.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && HIDE_KEY in changes) applyHidden(Boolean(changes[HIDE_KEY].newValue));
});