// Google sign-in through Google's own consent/account-chooser window (chrome.identity.launchWebAuthFlow).
// Works in any Chromium browser and needs no Chrome profile sign-in.
// Access tokens last an hour; they are renewed silently (prompt=none) while the user's
// browser still has a Google session for that account.
import { GOOGLE_CLIENT_ID } from "./config.js";

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const SCOPES = [DRIVE_SCOPE, "openid", "email"];
const ACCOUNT_KEY = "googleAccount"; // storage.local: { email } - survives restarts
const TOKEN_KEY = "googleToken"; // storage.session: { token, expiresAt } - memory only

function assertConfigured() {
  if (!GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID.startsWith("YOUR_")) {
    throw new Error("This build has no Google client ID (src/config.js).");
  }
}

function authUrl({ interactive, loginHint }) {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    response_type: "token",
    redirect_uri: chrome.identity.getRedirectURL(),
    scope: SCOPES.join(" "),
    include_granted_scopes: "true",
    prompt: interactive ? "select_account" : "none",
  });
  if (loginHint) params.set("login_hint", loginHint);
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function fetchEmail(token) {
  const response = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) return null;
  return (await response.json()).email ?? null;
}

async function authorize({ interactive, loginHint }) {
  assertConfigured();
  let responseUrl;
  try {
    responseUrl = await chrome.identity.launchWebAuthFlow({
      url: authUrl({ interactive, loginHint }),
      interactive,
      ...(interactive ? {} : { abortOnLoadForNonInteractive: false, timeoutMsForNonInteractive: 15000 }),
    });
  } catch (error) {
    if (interactive && /did not approve|cancel|closed/i.test(error.message)) throw new Error("Google sign-in was cancelled.");
    throw new Error(`Google sign-in failed: ${error.message}`);
  }

  const result = new URLSearchParams(new URL(responseUrl).hash.slice(1));
  if (result.get("error")) throw new Error(`Google sign-in failed: ${result.get("error")}`);
  const token = result.get("access_token");
  if (!token) throw new Error("Google sign-in returned no access token.");
  if (!(result.get("scope") ?? "").split(" ").includes(DRIVE_SCOPE)) {
    throw new Error("Google Drive access wasn't granted. Connect again and tick the Google Drive permission.");
  }

  const expiresAt = Date.now() + (Number(result.get("expires_in")) || 3600) * 1000;
  const email = (await fetchEmail(token).catch(() => null)) ?? loginHint ?? null;
  await chrome.storage.session.set({ [TOKEN_KEY]: { token, expiresAt } });
  await chrome.storage.local.set({ [ACCOUNT_KEY]: { email } });
  return { token, email };
}

/** Interactive: shows Google's account chooser and consent screen. */
export async function connect() {
  const { email } = await authorize({ interactive: true });
  return { connected: true, email };
}

/** A valid access token, renewed silently when needed. Throws if the user must connect again. */
export async function getAccessToken() {
  const { [ACCOUNT_KEY]: account } = await chrome.storage.local.get(ACCOUNT_KEY);
  if (!account) throw new Error("Google Drive is not connected. Open the extension and click Connect.");
  const { [TOKEN_KEY]: cached } = await chrome.storage.session.get(TOKEN_KEY);
  if (cached?.token && cached.expiresAt - 60_000 > Date.now()) return cached.token;
  try {
    return (await authorize({ interactive: false, loginHint: account.email })).token;
  } catch {
    throw new Error("Google Drive sign-in has expired. Open the extension and click Connect.");
  }
}

export async function invalidateToken() {
  await chrome.storage.session.remove(TOKEN_KEY);
}

export async function disconnect() {
  const { [TOKEN_KEY]: cached } = await chrome.storage.session.get(TOKEN_KEY);
  if (cached?.token) {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(cached.token)}`, { method: "POST" }).catch(() => {});
  }
  await chrome.storage.session.remove(TOKEN_KEY);
  await chrome.storage.local.remove(ACCOUNT_KEY);
  return { connected: false };
}

export async function accountStatus() {
  const { [ACCOUNT_KEY]: account } = await chrome.storage.local.get(ACCOUNT_KEY);
  return account ? { connected: true, email: account.email } : { connected: false };
}
