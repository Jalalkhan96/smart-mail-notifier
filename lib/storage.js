// storage.js
// Thin wrapper around chrome.storage so every other file reads/writes the
// same shape of data. Settings live in `storage.sync` (small, follows the
// user's Chrome profile across devices). Everything else - cached message
// lists, Gmail historyId cursors, per-account auth state - lives in
// `storage.local`, since it's per-device and can be larger than sync's quota.

export const DEFAULT_SETTINGS = {
  // General
  enabled: true,
  checkFrequencyMinutes: 2,

  // Notifications
  notificationsEnabled: true,
  groupNotifications: true,
  showPreview: true, // false = subject only, no body snippet
  soundEnabled: true,

  // Filters - apply the same way across every connected account
  watchedLabelIds: ['INBOX'], // empty array = watch every label
  senderMode: 'none', // 'none' | 'allow' | 'block'
  senderList: [], // list of email addresses or @domain.com strings
  keywordMode: 'none', // 'none' | 'include' | 'exclude'
  keywordList: [],
  dndEnabled: false,
  dndStart: '22:00',
  dndEnd: '07:00',
  dndWeekendsAllDay: false, // mute all day Sat/Sun regardless of the window above

  // Badge & counter - the badge is a single number combined across accounts
  badgeMode: 'total', // 'total' | 'unread' | 'both'
  badgeLowMax: 10, // < this => green
  badgeHighMax: 30, // < this => amber, else red
  badgeResetHour: 0, // local hour (0-23) the daily counter resets at
};

/**
 * One entry per connected Gmail account, keyed by email address.
 *   email          - the Gmail address (also the map key)
 *   method         - 'primary' (chrome.identity.getAuthToken) or
 *                     'webAuthFlow' (chrome.identity.launchWebAuthFlow + PKCE)
 *   refreshToken   - only set for method:'webAuthFlow'; 'primary' accounts
 *                     are refreshed transparently by Chrome itself
 *   color          - hex string, assigned once, used as this account's tag
 *                     color throughout the popup
 *   historyId      - Gmail's incremental-sync cursor for this account
 *   emails         - cached metadata for today's messages, newest first
 *   lastResetAt    - ISO date (yyyy-mm-dd) the badge last reset for
 *   lastSyncAt     - epoch ms of the last successful poll
 *   lastError      - human-readable string, or null
 */
export const DEFAULT_STATE = {
  accounts: {}, // { [email]: AccountState }
  ignored: [], // emails the user removed; skipped during discovery
  lastPopupOpenAt: 0, // epoch ms, used to compute the icon's "unseen" state
  lastGlobalError: null, // setup-level errors not tied to one account
};

export async function getSettings() {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function setSettings(partial) {
  await chrome.storage.sync.set(partial);
  return getSettings();
}

export async function getState() {
  const stored = await chrome.storage.local.get(DEFAULT_STATE);
  return { ...DEFAULT_STATE, ...stored, accounts: { ...(stored.accounts || {}) } };
}

export async function setState(partial) {
  await chrome.storage.local.set(partial);
}

/** Merges a partial patch into one account's entry and persists it. */
export async function patchAccount(email, patch) {
  const state = await getState();
  const existing = state.accounts[email] || {};
  const accounts = { ...state.accounts, [email]: { ...existing, ...patch } };
  await setState({ accounts });
  return accounts[email];
}

export async function removeAccount(email) {
  const state = await getState();
  const accounts = { ...state.accounts };
  delete accounts[email];
  await setState({ accounts });
}

export async function clearAllData() {
  await chrome.storage.local.clear();
  await chrome.storage.sync.clear();
}
