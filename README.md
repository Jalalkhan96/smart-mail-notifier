# Smart Mail Notifier (v2 — zero setup)

Desktop notifications + a "received today" badge for Gmail. **No Google Cloud, no client ID, no copying anything.**

## Install
1. `chrome://extensions` → Developer mode → **Load unpacked** → pick this folder.
2. Click the extension icon → **Sign in with Google**.
   - Already signed into Gmail in Chrome? It connects instantly (every signed-in account, automatically).
   - Not signed in? Gmail's login opens in a new tab; sign in and the extension connects by itself.

That's it. Updating later: replace files in the same folder and hit reload — there's nothing of yours inside the code to lose.

## How it works
Reads Gmail's own inbox feed using the Gmail session already in Chrome (host permission for `mail.google.com`). Nothing is sent anywhere else.

## Trade-offs vs. the old API version (be aware)
- Sees **unread inbox mail only** (newest 20). Mail you read before the extension polled it is never seen.
- "Today" count = unread mail the extension saw arrive today; it stays counted after you read it.
- **Read-only**: no Mark-as-read / Archive buttons (the feed can't modify mail). Open-in-Gmail works.
- Label filter removed (sender / keyword / Do-Not-Disturb filters still work).
- Opening Gmail in any tab triggers an instant check; otherwise it polls on your chosen interval.
- Multiple accounts: whichever Gmail accounts are signed into Chrome's account switcher (up to 6). Sign out of one in Gmail and it shows "Not signed in" here.
- Google could change the feed someday; if it stops working, the old OAuth build is the fallback.
