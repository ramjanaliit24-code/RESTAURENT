import { google } from "googleapis";
import fs from "fs";

const SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/drive" // required to set public permission
];

function getOAuthClient() {
  const oAuth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_DRIVE_REDIRECT_URI
  );
  return oAuth2Client;
}

// Generates URL to start auth (admin clicks)
export function generateAuthUrl() {
  const oAuth2Client = getOAuthClient();
  return oAuth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES
  });
}

// Exchange code for tokens (called in callback)
export async function getTokensFromCode(code) {
  const oAuth2Client = getOAuthClient();
  const { tokens } = await oAuth2Client.getToken(code);
  return tokens; // contains access_token, refresh_token, expiry_date...
}

// Helper to set credentials using refresh token or access token
export function getDriveClient(tokensOrRefreshToken) {
  const oAuth2Client = getOAuthClient();
  if (typeof tokensOrRefreshToken === "string") {
    // refresh token
    oAuth2Client.setCredentials({ refresh_token: tokensOrRefreshToken });
  } else if (tokensOrRefreshToken?.access_token) {
    oAuth2Client.setCredentials(tokensOrRefreshToken);
  } else {
    // nothing
  }
  return google.drive({ version: "v3", auth: oAuth2Client });
}

/**
 * Upload a local file to Drive and optionally set public sharing.
 * @param {string} localPath - path to the local file
 * @param {string} name - filename in Drive
 * @param {string} mimeType - mime type
 * @param {string} refreshTokenOrTokens - refresh token string or tokens object used to authorize
 * @param {string|null} folderId - optional Drive folder id to place file into
 * @returns {object} { id, webViewLink, webContentLink, shareableLink }
 */
export async function uploadFileToDrive(localPath, name, mimeType, refreshTokenOrTokens, folderId = null) {
  const drive = getDriveClient(refreshTokenOrTokens);
  const fileMetadata = { name };
  if (folderId) fileMetadata.parents = [folderId];

  const media = {
    mimeType: mimeType || "application/octet-stream",
    body: fs.createReadStream(localPath)
  };

  const res = await drive.files.create({
    requestBody: fileMetadata,
    media,
    fields: "id, webViewLink, webContentLink"
  });

  const fileId = res.data.id;

  // Make it shareable (anyoneWithLink) - requires drive scope
  try {
    await drive.permissions.create({
      fileId,
      requestBody: { role: "reader", type: "anyone" }
    });
  } catch (err) {
    // If permission fails due to insufficient scope, log and continue
    console.warn("Could not set permission:", err?.message || err);
  }

  // Get file metadata to return webViewLink / webContentLink
  const meta = await drive.files.get({ fileId, fields: "id, webViewLink, webContentLink" });
  const shareableLink = meta.data.webViewLink || meta.data.webContentLink;
  return { id: fileId, webViewLink: meta.data.webViewLink, webContentLink: meta.data.webContentLink, shareableLink };
}
