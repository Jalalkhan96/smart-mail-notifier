// popup.js
// The popup never talks to Gmail or chrome.storage directly - everything
// goes through the background service worker via runtime messages, so
// there's exactly one place that owns sync/auth/notification logic.

const els = {
  countNumber: document.getElementById('countNumber'),
  countLabel: document.getElementById('countLabel'),
  accountLine: document.getElementById('accountLine'),
  unreadPill: document.getElementById('unreadPill'),
  accountWarning: document.getElementById('accountWarning'),
  emailList: document.getElementById('emailList'),
  emptyState: document.getElementById('emptyState'),
  loadingState: document.getElementById('loadingState'),
  errorState: document.getElementById('errorState'),
  errorMessage: document.getElementById('errorMessage'),
  signedOutState: document.getElementById('signedOutState'),
  signedOutSub: document.getElementById('signedOutSub'),
  refreshBtn: document.getElementById('refreshBtn'),
  refreshFooterBtn: document.getElementById('refreshFooterBtn'),
  optionsBtn: document.getElementById('optionsBtn'),
  optionsFooterBtn: document.getElementById('optionsFooterBtn'),
  signInBtn: document.getElementById('signInBtn'),
  retryBtn: document.getElementById('retryBtn'),
};

const AVATAR_COLORS = ['#2e8b84', '#e87a4a', '#5b6bd6', '#c2564f', '#3f9142', '#9457c4'];

function send(type, extra = {}) {
  return chrome.runtime.sendMessage({ type, ...extra });
}

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

function initialsFor(name) {
  const trimmed = (name || '').trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/);
  return parts.length === 1 ? parts[0][0].toUpperCase() : (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatTime(ms) {
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function setAllStatesHidden() {
  els.emailList.classList.add('hidden');
  els.emptyState.classList.add('hidden');
  els.loadingState.classList.add('hidden');
  els.errorState.classList.add('hidden');
  els.signedOutState.classList.add('hidden');
}

function showLoading() {
  setAllStatesHidden();
  els.accountWarning.classList.add('hidden');
  els.loadingState.classList.remove('hidden');
}

function showError(message) {
  setAllStatesHidden();
  els.errorMessage.textContent = message || 'Could not reach Gmail. Check your connection and try again.';
  els.errorState.classList.remove('hidden');
}

function showSignedOut() {
  setAllStatesHidden();
  els.accountWarning.classList.add('hidden');
  els.signedOutState.classList.remove('hidden');
  els.countNumber.textContent = '—';
  els.countLabel.textContent = 'not connected';
  els.accountLine.textContent = '';
  els.unreadPill.classList.add('hidden');
}

function renderAccountWarning(accounts) {
  const failing = accounts.filter((a) => a.lastError);
  if (!failing.length) {
    els.accountWarning.classList.add('hidden');
    return;
  }
  els.accountWarning.innerHTML = '';
  const text = document.createElement('span');
  text.textContent =
    failing.length === 1
      ? `${failing[0].email} needs attention`
      : `${failing.length} accounts need attention`;
  const btn = document.createElement('button');
  btn.textContent = 'Settings';
  btn.addEventListener('click', () => chrome.runtime.openOptionsPage());
  els.accountWarning.append(text, btn);
  els.accountWarning.classList.remove('hidden');
}

function renderRow(email) {
  const li = document.createElement('li');
  li.className = `email-row${email.isUnread ? ' unread' : ''}`;

  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.style.background = AVATAR_COLORS[hashString(email.senderEmail || email.senderName) % AVATAR_COLORS.length];
  avatar.textContent = initialsFor(email.senderName);

  const main = document.createElement('div');
  main.className = 'row-main';

  const line1 = document.createElement('div');
  line1.className = 'row-line1';

  if (email.isUnread) {
    const dot = document.createElement('span');
    dot.className = 'unread-dot';
    line1.appendChild(dot);
  }

  const sender = document.createElement('span');
  sender.className = 'sender';
  sender.textContent = email.senderName;
  line1.appendChild(sender);

  if (email.accountColor) {
    const accountDot = document.createElement('span');
    accountDot.className = 'account-dot';
    accountDot.style.background = email.accountColor;
    accountDot.title = email.accountEmail;
    line1.appendChild(accountDot);
  }

  const time = document.createElement('span');
  time.className = 'time';
  time.textContent = formatTime(email.receivedAt);
  line1.appendChild(time);

  const subject = document.createElement('div');
  subject.className = 'subject';
  subject.textContent = email.subject;

  const snippet = document.createElement('div');
  snippet.className = 'snippet';
  snippet.textContent = email.snippet;

  const actions = document.createElement('div');
  actions.className = 'row-actions';

  actions.appendChild(
    makeActionButton('Open in Gmail', iconOpen(), () => {
      chrome.tabs.create({ url: email.link || 'https://mail.google.com/mail/' });
    })
  );

  main.append(line1, subject, snippet, actions);
  li.append(avatar, main);
  return li;
}

function makeActionButton(label, svg, onClick) {
  const btn = document.createElement('button');
  btn.title = label;
  btn.setAttribute('aria-label', label);
  btn.innerHTML = svg;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return btn;
}

function iconCheck() {
  return '<svg viewBox="0 0 20 20" fill="none"><path d="M4 10.5 8 14.5 16 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}
function iconArchive() {
  return '<svg viewBox="0 0 20 20" fill="none"><rect x="3.5" y="5" width="13" height="3" rx="1" stroke="currentColor" stroke-width="1.5"/><path d="M4.5 8v6.5A1.5 1.5 0 0 0 6 16h8a1.5 1.5 0 0 0 1.5-1.5V8" stroke="currentColor" stroke-width="1.5"/><path d="M8 11h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
}
function iconOpen() {
  return '<svg viewBox="0 0 20 20" fill="none"><path d="M8.5 5H15v6.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 5 8 12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M12 5H5.8A.8.8 0 0 0 5 5.8v8.4a.8.8 0 0 0 .8.8h8.4a.8.8 0 0 0 .8-.8V12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}

function renderList(state) {
  setAllStatesHidden();
  renderAccountWarning(state.accounts);

  els.countNumber.textContent = String(state.total);
  els.countLabel.textContent = state.total === 1 ? 'new email today' : 'new emails today';
  els.accountLine.textContent =
    state.accounts.length === 1 ? state.accounts[0].email : `${state.accounts.length} accounts connected`;

  if (state.badgeMode === 'both' && state.unread > 0) {
    els.unreadPill.textContent = `${state.unread} unread`;
    els.unreadPill.classList.remove('hidden');
  } else {
    els.unreadPill.classList.add('hidden');
  }

  if (!state.emails.length) {
    els.emptyState.classList.remove('hidden');
    return;
  }

  els.emailList.innerHTML = '';
  for (const email of state.emails) {
    els.emailList.appendChild(renderRow(email));
  }
  els.emailList.classList.remove('hidden');
}

async function load() {
  showLoading();
  try {
    let state = await send('sm-get-popup-state');
    if (state?.ok && !state.signedIn) {
      await send('sm-refresh-now'); // auto-connect any Gmail already signed in
      state = await send('sm-get-popup-state');
    }
    if (!state?.ok) throw new Error(state?.error || 'Unknown error');
    if (!state.signedIn) {
      showSignedOut();
      return;
    }
    renderList(state);
  } catch (err) {
    showError(err?.message);
  }
}

async function refresh(button) {
  if (button) button.classList.add('spinning');
  try {
    const result = await send('sm-refresh-now');
    if (result && result.ok === false) {
      showError(result.error);
    } else {
      await load();
    }
  } finally {
    if (button) button.classList.remove('spinning');
  }
}

els.refreshBtn.addEventListener('click', () => refresh(els.refreshBtn));
els.refreshFooterBtn.addEventListener('click', () => refresh());
els.retryBtn.addEventListener('click', () => load());
els.optionsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());
els.optionsFooterBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());

els.signInBtn.addEventListener('click', async () => {
  showLoading();
  const result = await send('sm-sign-in');
  if (result && result.ok === false) {
    showError(result.error);
  } else if (result?.opened) {
    showSignedOut();
    els.signedOutSub.textContent = 'Sign in to Gmail in the tab that just opened — it connects automatically.';
  } else {
    await load();
  }
});

load();
