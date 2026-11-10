// Window context for File System Access writes (not available to the service worker).
import { getDirHandle, dirPermission, base64ToBytes, BACKUP_FILE_PATTERN } from "./shared.js";

let job = null;
let objectUrl = null;

function fail(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

// The backup is written into the chosen folder chunk by chunk as it arrives, so it is never held in memory whole.
// Without a usable folder the chunks are kept as Blob parts (which Chrome can page out) for the Downloads fallback,
// and the reason is reported at commit, as before.
async function begin(message) {
  job = { fileName: message.fileName, keep: message.keep, parts: [], dir: null, writable: null, code: null };
  const dir = await getDirHandle();
  if (!dir) job.code = "no-folder";
  else if ((await dirPermission(dir)) !== "granted") job.code = "permission";
  else {
    job.dir = dir;
    const file = await dir.getFileHandle(job.fileName, { create: true });
    job.writable = await file.createWritable();
  }
}

async function writeChunk(data) {
  const bytes = base64ToBytes(data);
  if (job.writable) await job.writable.write(bytes);
  else job.parts.push(new Blob([bytes]));
}

async function commit() {
  if (job.code === "no-folder") throw fail("No backup folder chosen.", "no-folder");
  if (job.code === "permission") throw fail("Folder access needs re-granting.", "permission");
  const { dir } = job;
  await job.writable.close();
  job.writable = null;

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

/** Drops an unfinished file: the half-written data is discarded and the empty placeholder removed. */
async function release() {
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = null;
  if (job?.writable) {
    await job.writable.abort().catch(() => {});
    await job.dir.removeEntry(job.fileName).catch(() => {});
  }
  job = null;
}

async function handle(message) {
  switch (message.type) {
    case "begin":
      await release();
      await begin(message);
      return {};
    case "chunk":
      await writeChunk(message.data);
      return {};
    case "commit":
      return commit();
    case "object-url":
      objectUrl = URL.createObjectURL(new Blob(job.parts, { type: "application/zip" }));
      return { url: objectUrl };
    case "release":
      await release();
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