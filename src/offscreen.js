// Window context for File System Access writes (not available to the service worker).
import { getDirHandle, dirPermission, base64ToBytes, BACKUP_FILE_PATTERN } from "./shared.js";

let job = null;
let objectUrl = null;

function fail(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function commit() {
  const dir = await getDirHandle();
  if (!dir) throw fail("No backup folder chosen.", "no-folder");
  if ((await dirPermission(dir)) !== "granted") throw fail("Folder access needs re-granting.", "permission");

  const file = await dir.getFileHandle(job.fileName, { create: true });
  const writable = await file.createWritable();
  await writable.write(new Blob(job.parts, { type: "application/zip" }));
  await writable.close();

  let pruned = 0;
  if (job.keep > 0) {
    const names = [];
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind === "file" && BACKUP_FILE_PATTERN.test(name)) names.push(name);
    }
    names.sort().reverse();
    for (const name of names.slice(job.keep)) {
      await dir.removeEntry(name);
      pruned += 1;
    }
  }
  return { folderName: dir.name, pruned };
}

async function handle(message) {
  switch (message.type) {
    case "begin":
      job = { fileName: message.fileName, keep: message.keep, parts: [] };
      return {};
    case "chunk":
      job.parts.push(base64ToBytes(message.data));
      return {};
    case "commit":
      return commit();
    case "object-url":
      objectUrl = URL.createObjectURL(new Blob(job.parts, { type: "application/zip" }));
      return { url: objectUrl };
    case "release":
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = null;
      job = null;
      return {};
    default:
      throw new Error(`Unknown offscreen task: ${message.type}`);
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== "offscreen") return;
  handle(message).then(
    (result) => sendResponse({ ok: true, ...result }),
    (error) => sendResponse({ ok: false, error: error.message, code: error.code }),
  );
  return true;
});
