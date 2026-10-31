// Publisher setting - set once before packaging/publishing. End users never touch this.
// Google Cloud Console → Credentials → OAuth client ID → type "Web application",
// with each redirect URI below added under "Authorized redirect URIs":
//   https://<extension-id>.chromiumapp.org/
// (the unpacked dev ID and, once published, the Chrome Web Store ID).
export const GOOGLE_CLIENT_ID = "392228829969-h0pmk061c4902cjf3q8ot3g5gftg5r3a.apps.googleusercontent.com";
