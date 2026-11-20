// feed.js — reads Gmail through its Atom feed using the Gmail session already
// signed in inside Chrome. No OAuth, no client ID, no API key: the browser's own
// cookies authenticate the request (host permission for mail.google.com).
// Limits (Gmail's design, not ours): unread inbox mail only, newest 20, read-only.

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00A0' };

export function decodeEntities(str) {
  if (!str) return '';
  const once = (s) =>
    s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (m, e) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        try { return String.fromCodePoint(code); } catch { return m; }
      }
      return NAMED[e] ?? m;
    });
  return once(once(str)); // snippets arrive double-escaped (&amp;#39;)
}

function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? decodeEntities(m[1]).trim() : '';
}

/** Returns { email, fullCount, entries[] } or null when not signed in. */
export function parseFeed(xml) {
  if (!xml || !xml.includes('<feed')) return null;
  const head = xml.split('<entry>')[0];
  const who = head.match(/<title>[^<]*\sfor\s([^<\s]+@[^<\s]+)\s*<\/title>/);
  if (!who) return null;
  const entries = [];
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1];
    const id = (tag(e, 'id').split(':').pop() || '').trim();
    const link = (e.match(/<link[^>]*href="([^"]+)"/) || [])[1] || '';
    const author = e.match(/<author>([\s\S]*?)<\/author>/)?.[1] || '';
    const senderEmail = tag(author, 'email');
    entries.push({
      id,
      link: decodeEntities(link),
      subject: tag(e, 'title') || '(no subject)',
      snippet: tag(e, 'summary'),
      senderName: tag(author, 'name') || senderEmail || 'Unknown sender',
      senderEmail,
      receivedAt: Date.parse(tag(e, 'issued') || tag(e, 'modified')) || Date.now(),
    });
  }
  return { email: who[1], fullCount: Number(tag(head, 'fullcount')) || entries.length, entries };
}

/** Fetches the unread feed for Chrome's Nth signed-in Google account (u/N). */
export async function fetchFeed(index) {
  const res = await fetch(`https://mail.google.com/mail/u/${index}/feed/atom`, {
    credentials: 'include',
    cache: 'no-store',
  });
  if (!res.ok) return null;
  return parseFeed(await res.text());
}
