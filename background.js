// background.js — Smart Mail Notifier service worker (session mode)
//
// No OAuth. Accounts are discovered from the Gmail sessions already signed in
// inside Chrome by reading Gmail's Atom feed (lib/feed.js). Consequences, all
// inherent to the feed: only UNREAD inbox mail is visible, newest 20, read-only
// (no mark-as-read / archive buttons). "Received today" = unread mail we've seen
// arrive today; it stays counted after you read it elsewhere.

import { fetchFeed } from './lib/feed.js';
import { getSettings, getState, setState, patchAccount, removeAccount, clearAllData } from './lib/storage.js';

const ALARM_POLL = 'sm-poll-mail';
const ALARM_MIDNIGHT = 'sm-midnight-reset';
const MAX_ACCOUNTS = 6;
const BADGE_GREEN = '#2FA36B';
const BADGE_AMBER = '#E8A33D';
const BADGE_RED = '#D34B3D';
const ACCOUNT_COLORS = ['#2e8b84', '#e87a4a', '#5b6bd6', '#c2564f', '#3f9142', '#9457c4'];
const LOGIN_URL = 'https://accounts.google.com/ServiceLogin?service=mail&continue=https://mail.google.com/mail/';

let lastTabPoll = 0;

/* ---------------------------- lifecycle ---------------------------- */

chrome.runtime.onInstalled.addListener(boot);
chrome.runtime.onStartup.addListener(boot);

async function boot() {
  await scheduleAlarms(await getSettings());
  await pollMail(); // auto-connect: picks up any Gmail already signed in
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_POLL) await pollMail();
  else if (alarm.name === ALARM_MIDNIGHT) await performMidnightReset();
});

// Opening/using Gmail in a tab = instant sync (also finishes "Sign in" automatically).
chrome.tabs.onUpdated.addListener((_id, info, tab) => {
  if (info.status !== 'complete' || !tab.url?.startsWith('https://mail.google.com/')) return;
  if (Date.now() - lastTabPoll < 15000) return;
  lastTabPoll = Date.now();
  pollMail();
});

chrome.notifications.onClicked.addListener(async (id) => {
  chrome.notifications.clear(id);
  if (id.startsWith('sm-msg-')) {
    const { accountEmail, messageId } = parseMsgId(id);
    const acc = (await getState()).accounts[accountEmail];
    const email = acc?.emails.find((e) => e.id === messageId);
    chrome.tabs.create({ url: email?.link || inboxUrl(acc) });
  } else {
    chrome.tabs.create({ url: 'https://mail.google.com/mail/' });
  }
});

chrome.runtime.onMessage.addListener((message, _s, sendResponse) => {
  handleMessage(message).then(sendResponse).catch((e) => sendResponse({ ok: false, error: e?.message || String(e) }));
  return true;
});

async function handleMessage(m) {
  switch (m?.type) {
    case 'sm-get-popup-state': return getPopupState();
    case 'sm-get-accounts-state': return getAccountsState();
    case 'sm-sign-in': return signIn();
    case 'sm-remove-account': return removeOne(m.email);
    case 'sm-revoke-access': return clearEverything();
    case 'sm-refresh-now': return pollMail();
    case 'sm-settings-changed':
      await scheduleAlarms(await getSettings());
      await refreshBadgeAndIcon();
      return { ok: true };
    case 'sm-clear-cache': return clearCache();
    case 'sm-play-chime': return { ok: true };
    default: return { ok: false, error: `Unknown message type: ${m?.type}` };
  }
}

/* ------------------------------ alarms ------------------------------ */

async function scheduleAlarms(settings) {
  await chrome.alarms.clear(ALARM_POLL);
  if (settings.enabled) {
    const p = Math.max(1, settings.checkFrequencyMinutes);
    chrome.alarms.create(ALARM_POLL, { periodInMinutes: p, delayInMinutes: p });
  }
  scheduleMidnight(settings.badgeResetHour);
}

function scheduleMidnight(hour) {
  const n = new Date();
  const next = new Date(n.getFullYear(), n.getMonth(), n.getDate(), hour, 0, 0, 0);
  if (next <= n) next.setDate(next.getDate() + 1);
  chrome.alarms.create(ALARM_MIDNIGHT, { when: next.getTime() });
}

async function performMidnightReset() {
  const state = await getState();
  const accounts = {};
  for (const [k, a] of Object.entries(state.accounts)) accounts[k] = { ...a, emails: [] };
  await setState({ accounts });
  await refreshBadgeAndIcon();
  scheduleMidnight((await getSettings()).badgeResetHour);
}

/* ------------------------------- sync ------------------------------- */

async function pollMail() {
  const settings = await getSettings();
  if (!settings.enabled) return { ok: true, skipped: 'disabled' };

  const found = [];
  try {
    for (let i = 0; i < MAX_ACCOUNTS; i++) {
      const feed = await fetchFeed(i);
      if (!feed) break; // first index without a session = end of signed-in accounts
      found.push({ index: i, ...feed });
    }
  } catch {
    await setState({ lastGlobalError: "Can't reach Gmail. Check your connection." });
    return { ok: false, error: "Can't reach Gmail. Check your connection." };
  }

  const state = await getState();
  const ignored = new Set(state.ignored);
  const midnight = localMidnightMs();
  const notify = [];
  const seenNow = new Set();
  let accounts = { ...state.accounts };

  for (const f of found) {
    if (ignored.has(f.email)) continue;
    seenNow.add(f.email);
    const existing = accounts[f.email];
    const color = existing?.color || ACCOUNT_COLORS[Object.keys(accounts).length % ACCOUNT_COLORS.length];
    const unreadIds = new Set(f.entries.map((e) => e.id));

    const known = (existing?.emails || []).map((e) => ({ ...e, isUnread: unreadIds.has(e.id) }));
    const knownIds = new Set(known.map((e) => e.id));
    const fresh = f.entries
      .filter((e) => e.receivedAt >= midnight && !knownIds.has(e.id))
      .map((e) => ({ ...e, isUnread: true, accountEmail: f.email, accountColor: color }))
      .filter((e) => passesWatchFilters(e, settings));

    if (existing) notify.push(...fresh); // first sight of an account is a silent seed

    accounts[f.email] = {
      ...(existing || {}),
      email: f.email,
      index: f.index,
      color,
      emails: sortDesc([...fresh, ...known]),
      lastSyncAt: Date.now(),
      lastError: null,
    };
  }

  for (const [email, acc] of Object.entries(accounts)) {
    if (!seenNow.has(email)) accounts[email] = { ...acc, lastError: 'Not signed in to this account in Chrome.' };
  }

  await setState({ accounts, lastGlobalError: null });

  if (notify.length && settings.notificationsEnabled && !isInDnd(settings)) {
    await maybeNotify(notify, settings, Object.keys(accounts).length);
  }
  await refreshBadgeAndIcon();
  return { ok: true, added: notify.length, accounts: found.length };
}

const sortDesc = (list) => list.sort((a, b) => b.receivedAt - a.receivedAt);

/* --------------------- filters + Do Not Disturb --------------------- */

function passesWatchFilters(email, s) {
  if (s.senderMode !== 'none' && s.senderList?.length) {
    const hay = (email.senderEmail || '').toLowerCase();
    const hit = s.senderList.some((raw) => {
      const n = raw.trim().toLowerCase();
      if (!n) return false;
      return n.startsWith('@') ? hay.endsWith(n) : hay === n || hay.includes(n);
    });
    if (s.senderMode === 'allow' && !hit) return false;
    if (s.senderMode === 'block' && hit) return false;
  }
  if (s.keywordMode !== 'none' && s.keywordList?.length) {
    const hay = email.subject.toLowerCase();
    const hit = s.keywordList.some((k) => hay.includes(k.trim().toLowerCase()));
    if (s.keywordMode === 'include' && !hit) return false;
    if (s.keywordMode === 'exclude' && hit) return false;
  }
  return true;
}

function isInDnd(s) {
  const now = new Date();
  const day = now.getDay();
  if (s.dndWeekendsAllDay && (day === 0 || day === 6)) return true;
  if (!s.dndEnabled) return false;
  const mins = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = s.dndStart.split(':').map(Number);
  const [eh, em] = s.dndEnd.split(':').map(Number);
  const a = sh * 60 + sm;
  const b = eh * 60 + em;
  if (a === b) return false;
  return a < b ? mins >= a && mins < b : mins >= a || mins < b;
}

/* --------------------------- notifications --------------------------- */

function parseMsgId(id) {
  const rest = id.slice('sm-msg-'.length);
  const i = rest.lastIndexOf('-');
  return { accountEmail: rest.slice(0, i), messageId: rest.slice(i + 1) };
}

const inboxUrl = (acc) => `https://mail.google.com/mail/u/${acc?.index ?? 0}/`;

async function maybeNotify(list, s, accountCount) {
  const iconUrl = chrome.runtime.getURL('icons/icon128-active.png');
  const tag = accountCount > 1;
  if (list.length === 1 || !s.groupNotifications) {
    for (const e of list) {
      const preview = s.showPreview ? truncate(e.snippet, 120) : '';
      await chrome.notifications.create(`sm-msg-${e.accountEmail}-${e.id}`, {
        type: 'basic',
        iconUrl,
        title: e.senderName,
        message: e.subject,
        contextMessage: tag ? [e.accountEmail, preview].filter(Boolean).join(' · ') : preview || 'Smart Mail Notifier',
        priority: 1,
      });
    }
  } else {
    await chrome.notifications.create(`sm-group-${Date.now()}`, {
      type: 'list',
      iconUrl,
      title: `${list.length} new emails`,
      message: 'Click to open Gmail',
      items: list.slice(0, 5).map((e) => ({
        title: tag ? `${e.senderName} · ${e.accountEmail}` : e.senderName,
        message: s.showPreview ? truncate(e.subject, 80) : '',
      })),
      priority: 1,
    });
  }
  if (s.soundEnabled) await playChime();
}

const truncate = (s, n) => (!s ? '' : s.length > n ? `${s.slice(0, n - 1)}…` : s);

async function playChime() {
  try {
    try {
      await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['AUDIO_PLAYBACK'], justification: 'Play a short tone when new mail arrives' });
    } catch (e) {
      if (!String(e?.message || '').includes('single offscreen')) throw e;
    }
    chrome.runtime.sendMessage({ type: 'sm-play-chime' });
  } catch (e) {
    console.warn('[SmartMailNotifier] chime failed', e);
  }
}

/* ------------------------- badge + toolbar icon ------------------------- */

async function refreshBadgeAndIcon() {
  const settings = await getSettings();
  const state = await getState();
  const all = Object.values(state.accounts).flatMap((a) => a.emails);
  const total = all.length;
  const unread = all.filter((e) => e.isUnread).length;
  const count = settings.badgeMode === 'total' ? total : unread;
  const color = count < settings.badgeLowMax ? BADGE_GREEN : count < settings.badgeHighMax ? BADGE_AMBER : BADGE_RED;
  await chrome.action.setBadgeText({ text: count > 0 ? (count > 999 ? '999+' : String(count)) : '' });
  await chrome.action.setBadgeBackgroundColor({ color });
  try { await chrome.action.setBadgeTextColor?.({ color: '#FFFFFF' }); } catch { /* older Chrome */ }
  await applyIcon(all.some((e) => e.receivedAt > state.lastPopupOpenAt));
}

async function applyIcon(active) {
  const s = active ? '-active' : '';
  await chrome.action.setIcon({ path: { 16: `icons/icon16${s}.png`, 32: `icons/icon32${s}.png`, 48: `icons/icon48${s}.png`, 128: `icons/icon128${s}.png` } });
}

/* ------------------------------ handlers ------------------------------ */

async function getPopupState() {
  const settings = await getSettings();
  const state = await getState();
  await setState({ lastPopupOpenAt: Date.now() });
  await applyIcon(false);
  const accounts = Object.values(state.accounts);
  const emails = sortDesc(accounts.flatMap((a) => a.emails));
  return {
    ok: true,
    signedIn: accounts.length > 0,
    accounts: accounts.map((a) => ({ email: a.email, color: a.color, lastError: a.lastError })),
    emails,
    total: emails.length,
    unread: emails.filter((e) => e.isUnread).length,
    badgeMode: settings.badgeMode,
    lastGlobalError: state.lastGlobalError,
  };
}

async function getAccountsState() {
  const state = await getState();
  return {
    ok: true,
    accounts: Object.values(state.accounts).map((a) => ({ email: a.email, color: a.color, lastError: a.lastError })),
  };
}

/** One click: connect whatever Gmail sessions exist; if none, open Google sign-in. */
async function signIn() {
  await setState({ ignored: [] });
  const r = await pollMail();
  if (!r.ok) return r;
  if (r.accounts > 0) return getPopupState();
  chrome.tabs.create({ url: LOGIN_URL }); // tabs.onUpdated finishes the connection once Gmail loads
  return { ok: true, opened: true };
}

async function removeOne(email) {
  const state = await getState();
  await setState({ ignored: [...new Set([...state.ignored, email])] });
  await removeAccount(email);
  await refreshBadgeAndIcon();
  return getAccountsState();
}

async function clearEverything() {
  await chrome.alarms.clear(ALARM_POLL);
  await clearAllData();
  await refreshBadgeAndIcon();
  return { ok: true };
}

async function clearCache() {
  const state = await getState();
  const accounts = {};
  for (const [k, a] of Object.entries(state.accounts)) accounts[k] = { ...a, emails: [], lastError: null };
  await setState({ accounts });
  await refreshBadgeAndIcon();
  return { ok: true };
}

const localMidnightMs = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
