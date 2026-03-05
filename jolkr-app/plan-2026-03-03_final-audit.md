# Final Audit Report — Jolkr Chat Application

**Date:** 2026-03-03
**Scope:** All 44 source files in `src/`
**Auditor:** Claude Code

---

## Summary

**6 CRITICAL** | **13 HIGH** | **14 MEDIUM** | **12 LOW** = **45 total issues**

The application is structurally sound and feature-complete for a Discord-like chat app. However, there are several functional bugs that will affect real users, particularly around WebSocket initialization timing, N+1 API call patterns, stale presence data, and mobile/touch accessibility gaps.

---

## CRITICAL Issues (6)

### C1. WebSocket URL computed at module top level — potential crash
**File:** `src/api/ws.ts` line 6
**Code:** `const WS_URL = getWsUrl();`
**Problem:** `getWsUrl()` accesses `window.location` at module evaluation time. In SSR contexts, test environments, or if the module is imported before the DOM is ready, `window` may not have `location.protocol` or `location.host` set correctly. Additionally, this means the WS_URL is locked in at import time and never changes.
**Fix:** Make it lazy — compute the URL inside `connect()`:
```ts
// Remove line 6 and use getWsUrl() directly in connect()
this.ws = new WebSocket(getWsUrl());
```

### C2. `useEffect` stale closure in ChannelList
**File:** `src/components/ChannelList.tsx` lines 47-49
**Code:**
```ts
useEffect(() => {
  loadChannels();
}, [server.id]);
```
**Problem:** `loadChannels` is not in the dependency array. `loadChannels` is defined inside the component and closes over `fetchChannels`, `setLoading`, `setError` which are stable, but React's rules-of-hooks lint will flag this. More critically, if `loadChannels` reference changes, the effect won't re-run. The function references `server.id` via closure but `server.id` IS in the dep array, so in practice it works — but it is still a violation that may cause subtle bugs during refactors.
**Fix:** Add `loadChannels` to deps or inline the logic, or use `useCallback` for `loadChannels`.

### C3. `useEffect` stale closure in DmList
**File:** `src/components/DmList.tsx` lines 38-40, 43-50
**Code:**
```ts
useEffect(() => { fetchDms(); }, [currentUser?.id]);
useEffect(() => { const unsub = wsClient.on(...); return unsub; }, [currentUser?.id]);
```
**Problem:** `fetchDms` is not in the dependency arrays. It closes over `setDms`, `currentUser?.id`, `fetchedUserIds`. The function reference changes every render since it's defined inline, but React will not re-run the effect. If `currentUser` changes identity but same ID, `fetchDms` would still use the old closure.
**Fix:** Use `useCallback` for `fetchDms` or move API call inline.

### C4. Emoji picker focus race on mobile
**File:** `src/components/MessageInput.tsx` line 304
**Code:** `onFocus={() => setShowEmoji(false)}`
**Problem:** On mobile/touch devices, tapping the emoji picker button first triggers `onFocus` on the textarea (closing the picker) and then the button click (opening it). The race condition means the picker toggles and immediately closes. On desktop with keyboard nav, focusing the textarea also closes any open picker unexpectedly.
**Fix:** Remove `onFocus` handler or use a click-outside pattern instead. The existing backdrop overlay already handles closing.

### C5. Potential crash on null attachments
**File:** `src/components/MessageTile.tsx` line 170
**Code:** `{message.attachments?.length > 0 && ...}`
**Problem:** If `message.attachments` is `undefined` (backend didn't include it), the optional chain `?.length` returns `undefined`, and `undefined > 0` is `false` — safe. BUT the `Message` type declares `attachments: Attachment[]` (not optional), so TypeScript allows `message.attachments.length` without optional chain elsewhere. If the backend returns `null` for a specific message, this would crash at the `.map()` inside the block since `null.map()` throws.
**Fix:** Add null coalescing: `{(message.attachments ?? []).length > 0 && ...}` or normalize in the store.

### C6. Auth store `logout` async mismatch
**File:** `src/stores/auth.ts` line 67
**Code:**
```ts
logout: async () => {
  wsClient.disconnect();
  await api.clearTokens();
  set({ user: null });
},
```
**Problem:** The interface declares `logout: () => void` but the implementation is `async`. While JavaScript allows this, callers (e.g., `Settings.tsx` line 42: `logout(); navigate('/login');`) call it synchronously and navigate immediately without awaiting the token clear. On slow storage, the token might not be cleared before the navigation completes, causing the user to still be "authenticated" on the login page.
**Fix:** Either make the interface `logout: () => Promise<void>` and `await` it in callers, or make `clearTokens` fire-and-forget.

---

## HIGH Issues (13)

### H1. N+1 user fetch in MessageList
**File:** `src/components/MessageList.tsx` lines 45-55
**Problem:** Every time `allMsgs` changes (which is every new message via WebSocket), the effect iterates ALL unique author IDs and fetches each one. The `fetchedIdsRef` prevents duplicate fetches, but the effect still runs on every message arrival. For a busy channel, this means re-running the loop on every new message.
**Fix:** Debounce the user-fetch effect, or fetch authors only for new messages.

### H2. N+1 user fetch in MemberList
**File:** `src/components/MemberList.tsx` lines 23-39
**Problem:** Fetches every member's user profile one by one: `ids.forEach((id) => api.getUser(id)...)`. For a server with 100 members, this is 100 parallel API requests.
**Fix:** Use batch user endpoint or use the `member.user` field that the API likely returns.

### H3. N+1 user fetch in DmList
**File:** `src/components/DmList.tsx` lines 23-36
**Problem:** Same pattern — fetches each DM participant individually.
**Fix:** Batch the user fetches or use a search/bulk endpoint.

### H4. WS_URL never updates after settings change
**File:** `src/api/ws.ts` line 6
**Problem:** If the user changes the server URL in Tauri settings (`localStorage.setItem('jolkr_server_url', ...)`), the WebSocket URL remains the old value until a full page reload because `WS_URL` is captured at module init.
**Fix:** Compute URL lazily in `connect()`.

### H5. Server icon URL not rewritten through storage proxy
**File:** `src/components/ServerSidebar.tsx` line 80
**Code:** `<img src={server.icon_url} ...>`
**Problem:** `server.icon_url` is a raw MinIO URL (e.g., `http://minio:9000/...`) that browsers cannot reach. All other image displays use `rewriteStorageUrl()` but ServerSidebar does not.
**Fix:** `<img src={rewriteStorageUrl(server.icon_url) ?? ''} ...>`

### H6. DM list shows stale presence status
**File:** `src/components/DmList.tsx` line 163
**Code:** `status={otherUser?.status}`
**Problem:** `otherUser.status` is the status returned from the initial `getUser` API call and is never updated. The presence store has real-time status from WebSocket, but DmList doesn't use it. Users will always see offline status for DM partners even if they are online.
**Fix:** Use `usePresenceStore` to get `statuses[otherUser.id]` and pass that to `Avatar`.

### H7. Friends page shows stale status
**File:** `src/pages/App/Friends.tsx` line 144, 153
**Code:** `status={friendUser?.status}`, `{friendUser?.status ?? 'offline'}`
**Problem:** Same as H6 — uses API-returned `status` field instead of presence store.
**Fix:** Import `usePresenceStore` and use real-time status.

### H8. Non-null assertion on `serverId` from useParams
**File:** `src/pages/App/Channel.tsx` line 19
**Code:** `channels[serverId!]?.find(...)`
**Problem:** `serverId` from `useParams` is `string | undefined`. The `!` non-null assertion is unsafe. If the route somehow renders without a `serverId`, this would access `channels[undefined]`.
**Fix:** Add early return: `if (!serverId || !channelId) return null;` (already partially done at line 71 for `channelId` but `serverId` is still used unsafely before that).

### H9. Textarea height not reset after sending
**File:** `src/components/MessageInput.tsx` lines 83-126
**Problem:** After `handleSend` clears content with `setContent('')`, the textarea's `height` is still set to the old scrollHeight via the inline style. The `onInput` handler that recalculates height only fires on actual input events, not on React state changes.
**Fix:** After `setContent('')`, manually reset textarea height: `if (inputRef.current) inputRef.current.style.height = 'auto';`

### H10. Silent error on profile save failure
**File:** `src/pages/App/Settings.tsx` line 37
**Code:** `catch { /* ignore */ }`
**Problem:** If `updateProfile` fails (e.g., username taken, network error), the user sees no error feedback. The `Saving...` button just goes back to `Save Changes`.
**Fix:** Add error state and display it.

### H11. Layout settings sync is fragile
**File:** `src/pages/App/Layout.tsx` lines 16-27
**Problem:** `window.addEventListener('storage')` only fires for cross-tab changes per the Web API spec. The Settings page dispatches a synthetic `storage` event which works but is a hack. If any browser doesn't propagate synthetic events correctly, font size and compact mode changes won't apply until navigation.
**Fix:** Use a shared store (Zustand) for appearance settings, or use a custom event name.

### H12. `@types/marked` v5 may not match `marked` v17
**File:** `package.json` lines 31, 19
**Problem:** `@types/marked: "^5.0.2"` but `marked: "^17.0.3"`. Marked v17 ships its own types, making `@types/marked` potentially conflicting or outdated.
**Fix:** Remove `@types/marked` from devDependencies since modern marked ships its own types.

### H13. Unread badge on server icon requires channels to be fetched first
**File:** `src/components/ServerSidebar.tsx` lines 61-62
**Code:**
```ts
const serverChannelIds = (channels[server.id] ?? []).map((c) => c.id);
const serverUnread = serverChannelIds.reduce(...);
```
**Problem:** `channels[server.id]` is only populated when the user navigates to that server (fetchChannels is called in ChannelList). For servers the user hasn't visited this session, `channels[server.id]` is `[]`, so unread badges never show.
**Fix:** Fetch channels for all servers on app init, or track unread at server level in the backend.

---

## MEDIUM Issues (14)

### M1. No Escape key to close channel search
**File:** `src/pages/App/Channel.tsx` lines 110-118
**Problem:** The search input has no `onKeyDown` handler for Escape to close it.
**Fix:** Add `onKeyDown={(e) => { if (e.key === 'Escape') { setSearch(''); setShowSearch(false); } }}`.

### M2. No scroll-to-bottom button
**File:** `src/components/MessageList.tsx`
**Problem:** When user scrolls up to read history and new messages arrive, there's no visual indicator or button to jump back to the bottom. Users may miss new messages.
**Fix:** Add a "New messages" banner or scroll-to-bottom FAB.

### M3. No auto-navigation to first channel
**File:** `src/pages/App/Server.tsx`
**Problem:** When navigating to `/servers/:serverId` with no channel selected, it shows a "Select a channel" placeholder. Discord auto-navigates to the first text channel.
**Fix:** After channels are fetched, if no `channelId` in URL, navigate to the first text channel.

### M4. InviteDialog swallows errors silently
**File:** `src/components/dialogs/InviteDialog.tsx` lines 24, 38
**Code:** `catch { /* ignore */ }`, `catch { /* ignore - invite may already be deleted */ }`
**Problem:** Create and delete failures give no user feedback.
**Fix:** Add error state and display it.

### M5. UserProfileCard fetches all friends on every open
**File:** `src/components/UserProfileCard.tsx` line 64
**Problem:** `Promise.all([api.getFriends(), api.getPendingFriends()])` runs every time ANY user profile card opens. For users with many friends, this is expensive and unnecessary.
**Fix:** Cache friendship data or use a dedicated endpoint like `GET /friends/:userId/status`.

### M6. DmChat fetches ALL DMs to find current one
**File:** `src/pages/App/DmChat.tsx` line 25
**Code:** `api.getDms().then((channels) => { const dm = channels.find(...) ... })`
**Problem:** Fetches the entire DM list just to find the partner user ID for one DM.
**Fix:** Store DM data in a Zustand store that DmList already populates, or use a dedicated endpoint.

### M7. ServerPage loading vs not-found ambiguity
**File:** `src/pages/App/Server.tsx` lines 20-26
**Problem:** When `!server`, it shows "Loading server..." but there's no distinction between "still fetching" and "server doesn't exist". After fetch completes, if server still isn't found, the loading message persists forever.
**Fix:** Track loading state and show 404-like UI after fetch completes.

### M8. Message actions inaccessible on touch devices
**File:** `src/components/MessageTile.tsx` lines 106-108
**Problem:** Action buttons (reply, react, edit, delete) only appear on `onMouseEnter`. Touch devices never trigger hover, so these actions are completely inaccessible on mobile.
**Fix:** Add long-press handler or always-visible action menu (e.g., three-dot menu).

### M9. `highlightMentions` regex can corrupt HTML
**File:** `src/components/MessageContent.tsx` line 41
**Code:** `html.replace(/(@\w+)/g, '<span ...>$1</span>')`
**Problem:** This regex runs on the final HTML string after sanitization. If a sanitized attribute happens to contain `@word` (e.g., inside an `href`), it will inject a `<span>` inside the attribute, producing broken HTML.
**Fix:** Run mention highlighting on the raw text BEFORE markdown parsing, or use a marked extension.

### M10. CreateChannelDialog defined inside ChannelList — state loss risk
**File:** `src/components/ChannelList.tsx` lines 246-320
**Problem:** `CreateChannelDialog` is a function component defined inside the same file, not inside `ChannelList` itself — so this is actually fine (it's a separate component in the same module). No state loss issue here. **Retracted.**

### M11. No keyboard navigation in server dropdown
**File:** `src/components/ChannelList.tsx` lines 79-117
**Problem:** The dropdown menu items are not navigable via arrow keys. Only mouse clicks work.
**Fix:** Add `onKeyDown` handler for ArrowUp/ArrowDown/Enter/Escape.

### M12. Compact mode CSS selector is invalid
**File:** `src/components/MessageTile.tsx` line 106
**Code:** `'[div[data-compact]_&]:py-0.5'`
**Problem:** This is not valid Tailwind CSS syntax. Tailwind doesn't support arbitrary attribute selectors in this format. Compact mode set via `data-compact` on Layout has no actual visual effect on message tiles.
**Fix:** Use a proper Tailwind v4 variant, or pass `compact` as a prop/context, or use `group` variants.

### M13. Avatar initials edge case
**File:** `src/components/Avatar.tsx` line 12-16
**Code:** `name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?'`
**Problem:** If `name` is a single space `' '`, `split(' ')` produces `['', '']`, `map(w => w[0])` produces `[undefined, undefined]`, `join('')` produces `'undefinedundefined'`, then `.slice(0, 2)` is `'un'` and `.toUpperCase()` is `'UN'` — wrong initials for an empty name.
**Fix:** Filter out empty strings: `name.split(' ').filter(Boolean).map(...)`.

### M14. ErrorBoundary "Try Again" can loop
**File:** `src/components/ErrorBoundary.tsx` line 38
**Problem:** Clicking "Try Again" resets `hasError` to `false`, causing the children to re-render. If the children immediately throw again, the boundary catches it and shows the error again. This creates a potential infinite render loop.
**Fix:** Add a cooldown or counter to prevent rapid re-tries.

---

## LOW Issues (12)

### L1. Missing `aria-label` on icon-only buttons
**Files:** Throughout (`ChannelList.tsx`, `ServerSidebar.tsx`, `MessageTile.tsx`, `UserPanel.tsx`, etc.)
**Problem:** Many buttons have only SVG icons and no text. Screen readers cannot determine their purpose.
**Fix:** Add `aria-label` to all icon-only buttons.

### L2. Missing `role="dialog"` on modals
**Files:** All dialog components (`ConfirmDialog.tsx`, `CreateServer.tsx`, `EditChannelDialog.tsx`, etc.)
**Problem:** Modal overlays don't have `role="dialog"` or `aria-modal="true"`, making them invisible to assistive technology.
**Fix:** Add roles and aria attributes to dialog containers.

### L3. No file size/type validation on upload
**File:** `src/components/MessageInput.tsx` line 270
**Problem:** Users can select files of any size. No validation before upload attempt.
**Fix:** Add max file size check (e.g., 25MB) and show error.

### L4. No loading indicator for avatar upload
**File:** `src/pages/App/Settings.tsx` line 46-54
**Problem:** `avatarUploading` state exists but the visual feedback is just `...` inside a hover overlay that may not be visible.
**Fix:** Add a more prominent loading indicator.

### L5. NotFound doesn't distinguish auth state
**File:** `src/pages/NotFound.tsx`
**Problem:** "Go Home" navigates to `/` which redirects to `/login` if not authenticated. A non-authenticated user gets bounced twice.
**Fix:** Check auth state and navigate accordingly.

### L6. No loading indicator in ImageLightbox
**File:** `src/components/ImageLightbox.tsx`
**Problem:** Large images may take time to load, but there's no loading spinner while the image loads.
**Fix:** Add `onLoad`/`onError` handlers with loading state.

### L7. Duplicate `formatBytes` utility
**Files:** `src/components/MessageTile.tsx` line 319, `src/components/MessageInput.tsx` line 330
**Problem:** Same function defined twice.
**Fix:** Extract to shared utility file.

### L8. Voice channel notice mentions "Phase 5"
**File:** `src/components/ChannelList.tsx` line 233
**Problem:** The notice says "Voice chat is coming soon! This feature will be available in Phase 5." — this internal project language shouldn't be in user-facing text.
**Fix:** Change to "Voice chat is coming soon!" or remove the phase reference.

### L9. No password strength indicator on Register
**File:** `src/pages/Register.tsx`
**Problem:** Only `minLength={6}` on the HTML input. No visual indicator of password strength.
**Fix:** Add a password strength meter.

### L10. No auto-focus on Login/Register first input
**Files:** `src/pages/Login.tsx`, `src/pages/Register.tsx`
**Problem:** First input field doesn't have `autoFocus`, requiring an extra click.
**Fix:** Add `autoFocus` to the email input.

### L11. No toast/snackbar system
**Problem:** The app has no global notification system for success/error messages. Copy feedback is per-component. Profile save has a simple "Saved!" text replacement.
**Fix:** Add a toast component or use a library.

### L12. WebSocket silent disconnect after 10 retries
**File:** `src/api/ws.ts` line 146
**Problem:** After `MAX_ATTEMPTS` (10) reconnect failures, the WebSocket gives up silently. The user has no indication they are disconnected and messages will stop arriving.
**Fix:** Show a banner: "Connection lost. Click to reconnect." or expose disconnect state to the UI.

---

## User Flow Verification

| # | Flow | Status | Issues |
|---|------|--------|--------|
| 1 | Register -> Login -> Auto-redirect | WORKS | No auto-focus (L10) |
| 2 | Create server -> Create channel -> Send message | WORKS | No auto-navigate to first channel (M3) |
| 3 | Edit/delete message -> Confirm dialog | WORKS | |
| 4 | Reply to message -> Reply indicator | WORKS | |
| 5 | Add/toggle/remove reaction | WORKS | Optimistic updates work correctly |
| 6 | Upload attachment -> Image lightbox | WORKS | No file validation (L3), no loading (L6) |
| 7 | Server settings -> Edit name/icon -> Delete | WORKS | Icon URL not rewritten (H5) |
| 8 | Channel settings -> Edit/Delete | WORKS | |
| 9 | DM search -> Start DM -> Send message | WORKS | N+1 fetches (H3), stale presence (H6) |
| 10 | Friend request -> Accept/Decline -> Block | WORKS | Stale status (H7) |
| 11 | User profile card | WORKS | Expensive friend fetch (M5) |
| 12 | Settings -> Edit profile -> Avatar -> Appearance | PARTIAL | Silent save errors (H10), fragile sync (H11) |
| 13 | Unread badges | PARTIAL | Server-level badges need channel data (H13) |
| 14 | @mentions -> Autocomplete -> Highlight | WORKS | Regex HTML corruption risk (M9) |
| 15 | Typing indicator | WORKS | |
| 16 | Presence -> Status picker -> Dots | PARTIAL | DMs/Friends show stale status (H6, H7) |
| 17 | Error boundary -> Recovery | WORKS | Potential loop (M14) |
| 18 | 404 page -> Navigate home | WORKS | Auth-unaware (L5) |

---

## Doel
Identify all bugs, missing features, broken UX, and inconsistencies before moving to the next development phase.

## Stappen
1. [x] Read all 44 source files
2. [x] Audit each file for 7 categories of issues
3. [x] Verify all 18 user flows end-to-end
4. [x] Categorize issues by severity
5. [x] Generate structured report with file paths and line numbers
6. [ ] Fix issues (pending user decision on priority)

## Status
Steps 1-5 complete. Awaiting user decision on which fixes to prioritize.
