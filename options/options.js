// options.js
import { getSettings, setSettings } from '../lib/storage.js';

const PRESET_FREQUENCIES = ['1', '2', '5', '15', '30'];

const $ = (id) => document.getElementById(id);
const els = {
  status: $('saveStatus'),
  enabledToggle: $('enabledToggle'),
  frequencySelect: $('frequencySelect'),
  frequencyCustom: $('frequencyCustom'),
  accountsList: $('accountsList'),
  signInBtn: $('signInBtn'),
  notifToggle: $('notifToggle'),
  soundToggle: $('soundToggle'),
  groupToggle: $('groupToggle'),
  previewToggle: $('previewToggle'),
  senderModeGroup: $('senderModeGroup'),
  senderList: $('senderList'),
  keywordModeGroup: $('keywordModeGroup'),
  keywordList: $('keywordList'),
  dndToggle: $('dndToggle'),
  dndTimes: $('dndTimes'),
  dndStart: $('dndStart'),
  dndEnd: $('dndEnd'),
  dndWeekendToggle: $('dndWeekendToggle'),
  badgeModeSelect: $('badgeModeSelect'),
  thresholdLow: $('thresholdLow'),
  thresholdHigh: $('thresholdHigh'),
  resetHourSelect: $('resetHourSelect'),
  clearCacheBtn: $('clearCacheBtn'),
  revokeBtn: $('revokeBtn'),
};

let statusTimer = null;

function flashStatus(text) {
  els.status.textContent = text;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => (els.status.textContent = ''), 2200);
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

async function saveSettings(partial) {
  await setSettings(partial);
  chrome.runtime.sendMessage({ type: 'sm-settings-changed' });
  flashStatus('Saved');
}

function bindToggle(el, key) {
  el.addEventListener('change', () => saveSettings({ [key]: el.checked }));
}

function listToText(list) {
  return (list || []).join('\n');
}
function textToList(text) {
  return text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

function hourLabel(h) {
  if (h === 0) return '12:00 AM (midnight)';
  if (h === 12) return '12:00 PM (noon)';
  return h < 12 ? `${h}:00 AM` : `${h - 12}:00 PM`;
}

function setupSegmented(groupEl, initialValue, onChange) {
  const buttons = [...groupEl.querySelectorAll('.segmented-btn')];
  const apply = (value) => buttons.forEach((b) => b.classList.toggle('active', b.dataset.value === value));
  apply(initialValue);
  buttons.forEach((b) =>
    b.addEventListener('click', () => {
      apply(b.dataset.value);
      onChange(b.dataset.value);
    })
  );
}

/* ---------------------------------------------------------------------- */
/*  Accounts                                                                */
/* ---------------------------------------------------------------------- */

function renderAccountRow(account) {
  const row = document.createElement('div');
  row.className = 'account-row';

  const dot = document.createElement('span');
  dot.className = 'account-dot';
  dot.style.background = account.color || '#9599ab';

  const info = document.createElement('div');
  info.className = 'account-info';
  const emailEl = document.createElement('p');
  emailEl.className = 'account-email-text';
  emailEl.textContent = account.email;
  const meta = document.createElement('p');
  meta.className = `account-meta${account.lastError ? ' error' : ''}`;
  meta.textContent = account.lastError || 'Connected via your Chrome sign-in';
  info.append(emailEl, meta);

  const removeBtn = document.createElement('button');
  removeBtn.className = 'account-row-remove';
  removeBtn.textContent = 'Remove';
  removeBtn.addEventListener('click', async () => {
    removeBtn.disabled = true;
    await chrome.runtime.sendMessage({ type: 'sm-remove-account', email: account.email });
    flashStatus('Removed');
    await refreshAccountsUI();
  });

  row.append(dot, info, removeBtn);
  return row;
}

async function refreshAccountsUI() {
  const res = await chrome.runtime.sendMessage({ type: 'sm-get-accounts-state' });
  const accounts = res?.accounts || [];
  els.accountsList.innerHTML = '';
  for (const account of accounts) els.accountsList.appendChild(renderAccountRow(account));
  els.signInBtn.textContent = accounts.length ? 'Check for more accounts' : 'Sign in with Google';
}

function bindAccountControls() {
  els.signInBtn.addEventListener('click', async () => {
    els.signInBtn.disabled = true;
    const res = await chrome.runtime.sendMessage({ type: 'sm-sign-in' });
    els.signInBtn.disabled = false;
    flashStatus(res?.ok === false ? res.error : res?.opened ? 'Sign in to Gmail in the new tab' : 'Connected');
    await refreshAccountsUI();
  });
}

function initScrollspy() {
  const sections = [...document.querySelectorAll('main.content > section')];
  const navLinks = [...document.querySelectorAll('.rail-nav a')];
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        navLinks.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === `#${entry.target.id}`));
      });
    },
    { rootMargin: '-35% 0px -55% 0px' }
  );
  sections.forEach((s) => observer.observe(s));
}

async function init() {
  const settings = await getSettings();

  // General
  els.enabledToggle.checked = settings.enabled;
  bindToggle(els.enabledToggle, 'enabled');

  if (PRESET_FREQUENCIES.includes(String(settings.checkFrequencyMinutes))) {
    els.frequencySelect.value = String(settings.checkFrequencyMinutes);
  } else {
    els.frequencySelect.value = 'custom';
    els.frequencyCustom.value = settings.checkFrequencyMinutes;
    els.frequencyCustom.classList.remove('hidden');
  }
  els.frequencySelect.addEventListener('change', () => {
    const v = els.frequencySelect.value;
    if (v === 'custom') {
      els.frequencyCustom.classList.remove('hidden');
      els.frequencyCustom.value = els.frequencyCustom.value || String(settings.checkFrequencyMinutes);
      els.frequencyCustom.focus();
    } else {
      els.frequencyCustom.classList.add('hidden');
      saveSettings({ checkFrequencyMinutes: Number(v) });
    }
  });
  els.frequencyCustom.addEventListener(
    'input',
    debounce(() => {
      const n = Math.max(1, Math.min(180, Number(els.frequencyCustom.value) || 1));
      saveSettings({ checkFrequencyMinutes: n });
    }, 500)
  );

  bindAccountControls();
  await refreshAccountsUI();

  // Notifications
  els.notifToggle.checked = settings.notificationsEnabled;
  bindToggle(els.notifToggle, 'notificationsEnabled');
  els.soundToggle.checked = settings.soundEnabled;
  bindToggle(els.soundToggle, 'soundEnabled');
  els.groupToggle.checked = settings.groupNotifications;
  bindToggle(els.groupToggle, 'groupNotifications');
  els.previewToggle.checked = settings.showPreview;
  bindToggle(els.previewToggle, 'showPreview');

  // Filters — sender / keyword
  setupSegmented(els.senderModeGroup, settings.senderMode, (value) => saveSettings({ senderMode: value }));
  els.senderList.value = listToText(settings.senderList);
  els.senderList.addEventListener(
    'input',
    debounce(() => saveSettings({ senderList: textToList(els.senderList.value) }), 500)
  );

  setupSegmented(els.keywordModeGroup, settings.keywordMode, (value) => saveSettings({ keywordMode: value }));
  els.keywordList.value = listToText(settings.keywordList);
  els.keywordList.addEventListener(
    'input',
    debounce(() => saveSettings({ keywordList: textToList(els.keywordList.value) }), 500)
  );

  // Filters — DND
  const syncDndVisibility = () => els.dndTimes.classList.toggle('hidden', !els.dndToggle.checked);
  els.dndToggle.checked = settings.dndEnabled;
  syncDndVisibility();
  els.dndToggle.addEventListener('change', () => {
    syncDndVisibility();
    saveSettings({ dndEnabled: els.dndToggle.checked });
  });
  els.dndStart.value = settings.dndStart;
  els.dndEnd.value = settings.dndEnd;
  els.dndStart.addEventListener('change', () => saveSettings({ dndStart: els.dndStart.value }));
  els.dndEnd.addEventListener('change', () => saveSettings({ dndEnd: els.dndEnd.value }));
  els.dndWeekendToggle.checked = settings.dndWeekendsAllDay;
  bindToggle(els.dndWeekendToggle, 'dndWeekendsAllDay');

  // Badge & counter
  els.badgeModeSelect.value = settings.badgeMode;
  els.badgeModeSelect.addEventListener('change', () => saveSettings({ badgeMode: els.badgeModeSelect.value }));

  els.thresholdLow.value = settings.badgeLowMax;
  els.thresholdHigh.value = settings.badgeHighMax;
  els.thresholdLow.addEventListener('change', () => {
    const low = Math.max(1, Number(els.thresholdLow.value) || 1);
    const high = Math.max(low + 1, Number(els.thresholdHigh.value) || low + 1);
    els.thresholdLow.value = low;
    els.thresholdHigh.value = high;
    saveSettings({ badgeLowMax: low, badgeHighMax: high });
  });
  els.thresholdHigh.addEventListener('change', () => {
    const high = Math.max(2, Number(els.thresholdHigh.value) || 2);
    const low = Math.min(Number(els.thresholdLow.value) || 1, high - 1);
    els.thresholdLow.value = low;
    els.thresholdHigh.value = high;
    saveSettings({ badgeLowMax: low, badgeHighMax: high });
  });

  for (let h = 0; h < 24; h++) {
    const opt = document.createElement('option');
    opt.value = String(h);
    opt.textContent = hourLabel(h);
    els.resetHourSelect.appendChild(opt);
  }
  els.resetHourSelect.value = String(settings.badgeResetHour);
  els.resetHourSelect.addEventListener('change', () =>
    saveSettings({ badgeResetHour: Number(els.resetHourSelect.value) })
  );

  // Privacy
  els.clearCacheBtn.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'sm-clear-cache' });
    flashStatus('Cache cleared');
  });
  els.revokeBtn.addEventListener('click', async () => {
    const confirmed = window.confirm(
      "This forgets every account and erases all local data and settings. Continue?"
    );
    if (!confirmed) return;
    await chrome.runtime.sendMessage({ type: 'sm-revoke-access' });
    await refreshAccountsUI();
    flashStatus('Access revoked');
  });

  initScrollspy();
}

init();
