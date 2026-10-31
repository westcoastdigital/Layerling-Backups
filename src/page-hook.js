// Runs in Layerling's own page world. Layerling's "Back up all" builds a ZIP and downloads it
// through a temporary <a download> click. When the extension has armed a capture, that one click
// is intercepted: the ZIP is handed to the extension instead of being downloaded.
(() => {
  const ARM_ATTR = "data-llb-capture";
  const BACKUP_NAME = /^layerling-.*\.zip$/i;
  const originalClick = HTMLAnchorElement.prototype.click;

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
