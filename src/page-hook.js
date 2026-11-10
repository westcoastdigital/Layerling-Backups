// Runs in Layerling's own page world. Layerling's "Back up all" builds a ZIP and downloads it
// through a temporary <a download> click. When the extension has armed a capture, that one click
// is intercepted: the ZIP is handed to the extension instead of being downloaded.
(() => {
  const ARM_ATTR = "data-llb-capture";
  const BACKUP_NAME = /^layerling-.*\.zip$/i;
  const originalClick = HTMLAnchorElement.prototype.click;

  // Layerling 1.15x+ asks for a save location with showSaveFilePicker in Chrome/Edge before falling back
  // to the <a download> click. While a capture is armed, refuse the picker (a non-Abort error makes
  // Layerling fall back to the download), so an auto backup never pops a Save dialog and the ZIP still
  // reaches the click hook below. Any other picker use goes through untouched.
  if (typeof window.showSaveFilePicker === "function") {
    const originalPicker = window.showSaveFilePicker;
    window.showSaveFilePicker = function (options, ...rest) {
      if (document.documentElement.hasAttribute(ARM_ATTR) && options?.id === "layerling-backups") {
        return Promise.reject(new DOMException("Captured by Layerling Backup", "NotAllowedError"));
      }
      return originalPicker.call(this, options, ...rest);
    };
  }

  HTMLAnchorElement.prototype.click = function (...args) {
    const root = document.documentElement;
    const isBackup = root.hasAttribute(ARM_ATTR) && this.href.startsWith("blob:") && BACKUP_NAME.test(this.download || "");
    if (!isBackup) return originalClick.apply(this, args);

    root.removeAttribute(ARM_ATTR);
    const fileName = this.download;
    fetch(this.href)
      .then((response) => response.blob())
      .then((blob) => window.postMessage({ source: "llb-hook", type: "zip", fileName, blob }, location.origin))
      .catch((error) => window.postMessage({ source: "llb-hook", type: "error", message: String(error) }, location.origin));
  };
})();