# Frontend Audit Report — Jolkr

**Datum:** 2026-05-03
**Versie:** v0.10.4 (huidige dev branch, 4 lokale commits niet gepusht)
**Scope:** `jolkr-app/src/` + relevante config (`tauri.conf.json`, `index.html`, `vite.config.ts`, nginx CSP-headers, Android `MainActivity.kt`)
**Codebase-omvang:** ~205 source files, ~26.097 LOC (TS/TSX) plus CSS modules
**Stack:** React 19, TypeScript strict, Zustand v5, react-router-dom v7, CSS modules + design tokens, Vite 7, Tauri 2.10
**Methodologie:** vier parallelle gespecialiseerde audit-agents (read-only), elk met eigen scope; resultaten samengevoegd, ontdubbeld, geclassificeerd

---

## 0. Executive Summary

### Totalen

| Audit-as | Findings | High | Medium | Low |
|---|---:|---:|---:|---:|
| Code Consistency (CC) | 24 | 1 | 5 | 18 |
| Clean Code & Architecture (CL) | 27 | 7 | 9 | 11 |
| React/TS Best Practices (BP) | 28 | 3 | 14 | 11 |
| Web Security & Quality (SEC, na filter) | 29 | 3 | 11 | 15 |
| **Totaal in scope** | **108** | **14** | **39** | **55** |
| Out of scope (embeds) | 3 | — | — | — |

> "High" in CC/CL/BP betekent maintainability/correctheid-impact, niet exploitable. SEC "high" is wel security-relevant.

### Top 5 systemische issues

1. **Drie monolithische hooks in `pages/App/`** — `useAppInit.ts` (701 LOC), `useAppMemos.ts`, `useAppHandlers.ts` doen samen alles: auth-init, DM-sync, routing, presence, WS-events, permissies, threads. Met 7× `// eslint-disable-line react-hooks/exhaustive-deps` en stale-ref workarounds. Eén plek waar bijna élke nieuwe feature aangeraakt moet worden — concentratierisico.
2. **God-components** — `ServerSettings.tsx` (1.292 LOC), `ChannelSidebar.tsx` (1.103 LOC), `ChatArea.tsx` (831 LOC), `Message.tsx` (~666 LOC met dubbele DM/server render-paden). Mix van presentatie + state + side-effects + drag-drop in één file.
3. **DM vs channel conditional repetition** — `dmActive ? api.dmX : api.channelX` patroon herhaalt zich ~15× door de codebase. Elke nieuwe DM/channel-feature is een copy-paste-risico.
4. **Type-safety lekken op API-grenzen** — meerdere `as unknown as X` casts (theme, DM metadata, tokens, WS payloads), 30+ non-null assertions (`!`), geen runtime schema-validatie. Schema-drift tussen backend en frontend wordt niet gedetecteerd op compile time.
5. **CSP `'unsafe-inline'` op script-src in nginx** — door één inline theme-script in `index.html`. Zwakt XSS-bescherming substantieel af terwijl er verder een goede defense-in-depth (DOMPurify, marked sanitizing, e2e encrypted content) staat.

### Top 5 quick-wins (laag risico, directe impact)

| # | Wat | Effort | Categorie |
|---|---|---|---|
| 1 | `rel="noopener noreferrer"` toevoegen aan `LinkEmbed.tsx:18`, `MessageAttachments.tsx:109`, `ImageLightbox.tsx:240` | 5 min | SEC-001, SEC-014 |
| 2 | `VAULT_PASSWORD` expliciet wissen in `api.clearTokens()` (logout flow) | 10 min | SEC-006 |
| 3 | QR-scanner regex strikter: echte UUID-vorm i.p.v. `[0-9a-f-]{36}` | 5 min | SEC-005 |
| 4 | ESLint `argsIgnorePattern: '^_'` aan `eslint.config.js` toevoegen | 5 min | CC-009 |
| 5 | `MAX_ATTACHMENT_SIZE` / `TYPING_THROTTLE_MS` / `VOICE_TIMEOUT_MS` naar `utils/constants.ts` | 15 min | CL-027 |

### Top 5 grotere refactors (aanbevolen volgorde)

1. **Splits `useAppInit` op** (CL-001) → `useAuthInit` / `useDmSync` / `useRouting` / `usePresenceSync` / `useWsSubscriptions`. Dit deblokkeert vrijwel alle andere refactors in `pages/App/`.
2. **Vervang `as unknown as X` API-casts door zod-runtime-validatie** (BP-003, CC-005). Eén keer schema definiëren, daarna komen schema-drift bugs er compile-time uit.
3. **Extract DM/channel API-strategy** (CL-006) → `useChannelApi(isDm)` retourneert `{ fetchMessages, addReaction, pinMessage, … }`. Verwijder ~15 conditional copy-pastes.
4. **Splits `ServerSettings.tsx`** (CL-003) → `OverviewTab` / `RolesTab` / `InvitesTab` / `BansTab` / `AuditTab` plus `useRoleEdit` hook. Maakt mobile Roles-tab fix (open todo) trivialer.
5. **Decomposeer `ChatArea.tsx`** (CL-004, BP-001) → `ComposerToolbar` + `InputComposer` + `MessageList` + `MessageToolbar`, met `useAutocomplete` hook voor emoji/mention.

### Bestaande mitigaties (geverifieerd, **geen actie nodig**)

- Presence store re-render bailout (2026-04-11) staat in `stores/presence.ts:19-26`.
- TypeScript strict mode aan in `tsconfig.app.json`.
- Error boundary aanwezig (`components/ErrorBoundary.tsx`).
- Modal focus traps in `Modal.tsx` via `useFocusTrap.ts` (let op: niet overal gebruikt — zie BP-020).
- Build-chunking goed geconfigureerd in `vite.config.ts` (crypto/react/dnd/emoji/hljs/qr separate chunks).
- DOMPurify + marked dual-sanitize pipeline werkt (zie SEC-007/SEC-008 voor verfijningen).
- Vault password verplaatst van localStorage naar sessionStorage (SEC-006 vraagt om aanvullende life-cycle hardening, niet om herstel).

---

## 1. Out of scope — Embeds (VidMount / YouTube / Twitch / Vimeo / TikTok)

Op uitdrukkelijk verzoek van de eigenaar zijn alle bevindingen die uitsluitend de externe video-embeds raken **niet meegenomen** in de remediation-secties. Reden: de iframe/CSP-config voor deze embeds is bewust ingericht zodat ze in de huidige vorm correct werken in zowel de webbuild als in Tauri (desktop én Android), inclusief de fullscreen-bridge. Een aanpassing zou de feature breken.

De volgende drie agent-bevindingen zijn dus geclassificeerd als geaccepteerd risico en alleen ter referentie hier opgenomen:

| ID | Titel | Reden buiten scope |
|---|---|---|
| SEC-002 | Twitch embed `parent=` parameter zonder strikte validatie (`VideoEmbed.tsx:105-122`) | Twitch CSP eist `parent=tauri.localhost` + `parent=jolkr.app`; client-side construction is vereist om embed in zowel web als Tauri te laten werken. |
| SEC-003 | `<iframe>` in `VideoEmbed.tsx:154-161` zonder `sandbox=` | Sandbox + `allow-scripts` + `allow-same-origin` heffen elkaar op; strikter sandboxen breekt YT/Vimeo/Twitch playback en de fullscreen bridge naar Android. |
| SEC-025 | `/app/twitch-embed.html` bridge serveert CSP met `'unsafe-inline'` (`nginx.conf:344`) | Bridge-page is specifiek nodig om Twitch's `frame-ancestors` enforcement te omzeilen in Tauri; inline script is functioneel kritiek. |

Mocht je later toch willen dat deze drie items worden geadresseerd (bv. via een nonce-based CSP voor de bridge-page), dan kunnen ze alsnog worden teruggehaald — voor nu staan ze gemarkeerd als **bewust geaccepteerd**.

---

## 2. Code Consistency (CC) — 24 findings

### CC-001 — Hardcoded kleuren in CSS i.p.v. design tokens
- **Severity:** medium · **Categorie:** style
- **Locations:**
  - `components/CallDialogs/CallDialogs.module.css` (`color: #fff`)
  - `components/CallPipWindow/CallPipWindow.module.css` (`color: #fff`, `background: var(--bg-deep, #0a0a0a)`)
  - `components/CallWindow/CallWindow.module.css` (idem)
  - `components/ChannelSettings/ChannelSettings.module.css` (`color: #fff`)
  - `components/FriendsPanel/FriendsPanel.module.css` (`color: #fff`)
  - `components/GifPicker/GifPicker.module.css` (`--gpr-*` cluster: `#007aeb`, `#222`, `#2b2b2b`, …)
- **Convention:** dominante codebase gebruikt `var(--…)` uit `styles/tokens.css`.
- **Recommendation:** migreer naar `--text-shout`, `--bg-dark-shout` etc. Voor GifPicker kan een subset library-tokens (`--gif-picker-bg`, `--gif-picker-accent`) als wrapper worden gedefinieerd.

### CC-002 — Inline `style={…}` mengt met CSS modules
- **Severity:** medium · **Categorie:** style
- **Locations:** 30+ totaal, o.a.:
  - `components/CallPipWindow/CallPipWindow.tsx:63` (drag pos — terecht)
  - `components/ChatArea/ChatArea.tsx:247` (`padding: '.725rem .625rem'` — naar CSS)
  - `components/ChatArea/ChatArea.tsx:273` (`width:'100%'`, etc. — naar CSS)
  - `components/CreateServerModal/CreateServerModal.tsx:75` (`background: iconBg` — terecht, dynamic hue)
  - `components/DMSidebar/DMSidebar.tsx:51` (statische padding/textAlign/opacity — naar CSS)
  - `components/EmojiPickerPopup/EmojiPickerPopup.tsx:113` (popup pos — terecht)
- **Convention:** inline alleen voor echt dynamische waarden.
- **Recommendation:** verplaats statische waarden naar `.module.css`, behoud inline voor drag-positions / dynamic colors / popup-coords.

### CC-003 — `!important` gebruik
- **Severity:** low · **Categorie:** style
- **Locations:**
  - `components/EmojiPickerPopup/EmojiPickerPopup.module.css` (7×, library override — gerechtvaardigd)
  - `components/Message/Message.module.css` (3× opacity/visibility/pointer-events; danger:hover — onnodig, kan met higher-specificity selector)
  - `components/ChatArea/ChatArea.module.css` (`cursor: grabbing !important`)
  - `styles/globals.css` (stroke transition)
- **Recommendation:** Message.danger met selector-specificity oplossen. EmojiPickerPopup behouden + commentaarregel "library override".

### CC-004 — Non-null assertions (`!`) verspreid
- **Severity:** high · **Categorie:** types
- **Locations (30+):**
  - `components/ChatArea/richInputHelpers.ts:89, 96` (`el.parentNode!`)
  - `components/Message/Message.tsx:84, 106, 154, 169` (`message.embeds!`, `message.thread_id!`, `message.author_id!`)
  - `components/TabBar/TabBar.tsx:156-158` (`remoteSessionCall!`)
  - `components/ThemePicker/ThemePicker.tsx:54` (`canvasRef.current!`)
  - `crypto/e2ee.ts:65, 66` (`bundle.pqSignedPrekey!`)
  - `pages/App/AppShell.tsx:239` (`userContextMenu.dmId!`)
  - `pages/App/useAppMemos.ts:29` (`m.user!`)
  - `platform/storage.ts:45, 46, 52, 55, 58` (`this.store!`, `this.stronghold!`)
- **Recommendation:** vervang door type guards (`assertThreadId(msg)`, `assertVaultLoaded(this)`) of refactor om de optionaliteit weg te nemen. Voor refs: `if (!ref.current) return;` patroon.

### CC-005 — `as Foo` casts inconsistent
- **Severity:** medium · **Categorie:** types
- **Locations (15+):**
  - `api/client.ts:34, 35` (`as unknown as TokenPair` — geen runtime check)
  - `api/ws.ts:29` (`as string`)
  - `components/ChannelSidebar/ChannelSidebar.tsx:266, 268, 276, 277` (drag IDs)
  - `components/MessageContent.tsx:110` (`marked.parse` returnt `string | Promise<string>`)
  - `components/ProfileCard/ProfileCard.tsx:180-182` (`as Error`)
  - `platform/detect.ts:5, 8` (Tauri env)
- **Recommendation:** voor TokenPair → zod schema. Voor `marked.parse` → gebruik sync overload. Voor errors → `instanceof Error` guard.

### CC-006 — Mixed error-handling patronen
- **Severity:** medium · **Categorie:** errors
- **Patronen:**
  - `.catch(() => {})` silent swallow — 11×: `api/client.ts:158, 174, 242`, `components/GifPicker/GifPicker.tsx:112, 160`, `components/Message/Message.tsx:131`, …
  - `.catch(console.warn)` — 3×: `App.tsx:34, 37, 38`
  - `.catch(() => setState(error))` — 4×
  - `.catch(e => { console.warn(...); set(...) })` hybrid — 5×: `stores/call.ts:98`, …
- **Recommendation:** baseline `console.warn(prefix, err)`; toast voor user-zichtbare failures; silent catch alleen voor best-effort (clipboard, telemetry). Eventueel one-liner helper `logErr(ctx, err)`.

### CC-007 — Zustand `set({…})` vs `set((s)=>…)` patroon
- **Severity:** low · **Categorie:** stores
- **Observation:** dominant `set({…})` voor simpele replacements; `set((s)=>…)` updater-fn alleen waar op huidige state wordt gebouwd. Eén uitzondering: `useAuthStore.applyUserUpdate`.
- **Recommendation:** geen actie — patroon is feitelijk consistent. Eventueel een 2-regel CONTRIBUTING-comment in `stores/index.ts` om het te documenteren.

### CC-008 — Default vs named exports
- **Severity:** low · **Categorie:** structure
- **Observation:** ~23 default exports, ~43 named exports, 6 barrel `index.ts`. Geen enforced regel.
- **Recommendation:** kies één — voorkeur: named + barrels (betere tree-shaking en refactor-resistant). Voeg eslint-rule `import/no-default-export` toe en migreer in passes.

### CC-009 — `_unused` prefix niet door eslint geëffectueerd
- **Severity:** low · **Categorie:** naming
- **Locations:** `pages/App/AppShell.tsx:239`, `stores/voice.ts`
- **Recommendation:** voeg toe aan `eslint.config.js`:
  ```js
  '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }]
  ```

### CC-010 — `unknown` op API-grenzen
- **Severity:** low · **Categorie:** types
- **Locations:** `api/ws.ts:13, 20, 41` (`Record<string, unknown>`), `stores/call.ts:7` (`err: unknown`), etc.
- **Observation:** correct gebruik. Géén actie nodig — dit is goede praktijk.

### CC-011 — `import type`-keyword gebruik
- **Severity:** medium · **Categorie:** imports
- **Observation:** ~82× `import type`, ~473× `import`. Convention is goed gevolgd, maar niet enforced.
- **Recommendation:** voeg eslint rule `@typescript-eslint/consistent-type-imports: 'error'` toe.

### CC-012 — `px` vs `rem` in CSS
- **Severity:** low · **Categorie:** style
- **Locations:** `components/AppShell/AppShell.module.css` (28px/24px gemixt met rem)
- **Convention:** rem dominant, px alleen voor borders/safe-area.
- **Recommendation:** geen verplichte fix; documenteer uitzonderingen.

### CC-013 — Event-handler prop-naming (`on*` vs `handle*`)
- **Severity:** low · **Categorie:** naming
- **Observation:** props consistent `on*` (294×), interne handlers `handle*`. Goed patroon.
- **Recommendation:** geen actie.

### CC-014 — Boolean prop-naming (`isX`/`hasX`/`canX`)
- **Severity:** low · **Categorie:** naming
- **Observation:** semantisch correct verdeeld (`isActive`, `hasMore`, `canManageMessages`).
- **Recommendation:** geen actie.

### CC-015 — Procentuele animaties / rem transitions
- **Severity:** low · **Categorie:** style
- **Observation:** `PollDisplay.tsx:157` `width: ${pct}%` is correct dynamisch.
- **Recommendation:** geen actie.

### CC-016 — Inline Zustand selectors
- **Severity:** low · **Categorie:** stores
- **Observation:** alle selectors zijn inline `useStore(s => s.x)` (100+). Geen extracted selector-functions.
- **Recommendation:** prima zoals het is. Overweeg extracted selectors zodra een selector >3 regels wordt of in 5+ plekken voorkomt.

### CC-017 — Async error-handling per store
- **Severity:** low · **Categorie:** stores
- **Observation:** `call.ts` heeft `toastErr(prefix, err)` helper; andere stores doen ad-hoc.
- **Recommendation:** verplaats `toastErr` (of varianten) naar `utils/storeError.ts` en hergebruik.

### CC-018 — CSS-module class-naming (camelCase)
- **Severity:** low · **Categorie:** style
- **Observation:** consistent camelCase. Geen actie.

### CC-019 — Component folder vs single file
- **Severity:** low · **Categorie:** structure
- **Observation:** pragmatisch — folder bij meerdere bestanden, root-file bij solo. Goed patroon.
- **Recommendation:** geen actie.

### CC-020 — `ApiError` class onderbenut
- **Severity:** medium · **Categorie:** types
- **Locations:** `api/client.ts:159` definieert `class ApiError extends Error`. Maar 15+ catch-blocks doen `(e as Error).message || 'Failed to ...'`.
- **Recommendation:** export `ApiError`, gebruik in alle `client.ts` rejection paths, en `if (e instanceof ApiError) { … }` guard in componenten.

### CC-021 — Orphaned of mismatched `.module.css`
- **Severity:** low · **Categorie:** structure
- **Observation:** geen orphans. 1:1 .tsx ↔ .module.css. Geen actie.

### CC-022 — `AppShell` plaatsing
- **Severity:** low · **Categorie:** structure
- **Locations:** `components/AppShell/AppShell.tsx` — dit is de hoofd-shell, conceptueel een "page".
- **Recommendation:** verplaats naar `pages/App/AppShell.tsx` (let op: hooks `useAppInit/Memos/Handlers` staan al in `pages/App/`).

### CC-023 — Console-logging consistentie
- **Severity:** low · **Categorie:** style
- **Observation:** mix van `console.warn` (12), `console.error` (8), met of zonder `[ctx]` prefix.
- **Recommendation:** simpele helper `log.warn(ctx, err)` in `utils/log.ts` met vaste prefix-format.

### CC-024 — Dynamic className-constructie
- **Severity:** low · **Categorie:** style
- **Observation:** template-strings + ternary, schoon en consistent.
- **Recommendation:** geen actie. Bij groei naar >3 conditions: overweeg `clsx`.

---

## 3. Clean Code & Architecture (CL) — 27 findings

### CL-001 — Monolithische `useAppInit.ts` (701 LOC)
- **Severity:** high · **Categorie:** size, complexity
- **Locations:** `pages/App/useAppInit.ts:1-701`
- **Observation:** 40+ state vars, 16 useEffect-blokken, 7× `// eslint-disable react-hooks/exhaustive-deps`. Doet auth-init + DM-list-sync + URL-routing + presence + keyboard-shortcuts + WS-events + role-cache + permissions + threads.
- **Impact:** elk nieuw feature raakt deze hook → concentratierisico, onmogelijk te unit-testen.
- **Recommendation:** splits in `useAuthInit`, `useDmSync`, `useRouting`, `usePresenceSync`, `useWsSubscriptions`. Behoud `useAppInit` als thin composition.

### CL-002 — `useAppMemos` rebuilds met te brede deps
- **Severity:** medium · **Categorie:** complexity, performance
- **Locations:** `pages/App/useAppMemos.ts:82-92` (userMap), `:114-129` (uiDmList — 6 deps), `:198-204` (mentionableUsers), `:104` (uiServers — 8 deps)
- **Observation:** memo-deps over-broad: presence-update triggert volledige uiServers-rebuild.
- **Recommendation:** smallere selectors uit Zustand + per-veld dependencies. Splits userMap-build in eigen hook.

### CL-003 — `ServerSettings.tsx` (1.292 LOC)
- **Severity:** high · **Categorie:** size, abstraction
- **Locations:** `components/ServerSettings/ServerSettings.tsx:1-1292`
- **Observation:** overview + roles CRUD + invites + bans + audit log + delete-confirm in één file. 16 useState + 6 nested role-edit hooks.
- **Recommendation:** splitsen in tab-componenten + `useRoleEdit` hook. Maakt mobile Roles-tab fix (open todo) trivialer.

### CL-004 — `ChatArea.tsx` (831 LOC)
- **Severity:** high · **Categorie:** size, abstraction
- **Locations:** `components/ChatArea/ChatArea.tsx:1-831`
- **Observation:** scroll + reveal animation + emoji/mention autocomplete + formatting toolbar + drag-drop + voice-call UI + typing indicator + reply context.
- **Recommendation:** decomposeer in `<ComposerToolbar>`, `<InputComposer>`, `<MessageList>`, `<MessageToolbar>`. Extract `useAutocomplete()`.

### CL-005 — `ChannelSidebar.tsx` (1.103 LOC)
- **Severity:** high · **Categorie:** size, complexity
- **Locations:** `components/ChannelSidebar/ChannelSidebar.tsx:1-1103`
- **Observation:** drag-drop (custom collision @74-85) + create/delete/rename + context menu + reveal anim. `persistLayout` (47 LOC) is inline.
- **Recommendation:** extract `useDragDropChannels` hook + `<ChannelContextMenu>` + `<CreateChannelForm>` componenten. Verplaats `persistLayout` naar `utils/channelLayout.ts`.

### CL-006 — DM vs channel conditional duplicatie
- **Severity:** medium · **Categorie:** duplication
- **Locations (15+):** `pages/App/useAppHandlers.ts:236-249, 301-306, 323-347`; `components/ChatArea/ChatArea.tsx:327-365, 425-433`; en 10+ andere
- **Observation:** patroon `dmActive ? api.removeDmReaction : api.removeReaction` herhaalt continu.
- **Recommendation:** abstractielaag `useChannelApi(isDm)` → `{ fetchMessages, addReaction, pinMessage, … }`.

### CL-007 — `useAppHandlers` retourneert 20+ losse functies
- **Severity:** medium · **Categorie:** abstraction
- **Locations:** `pages/App/useAppHandlers.ts:535-548`
- **Observation:** flat object met 20 handlers. AppShell destructureert 50+ properties.
- **Recommendation:** groepeer: `{ auth: {...}, messages: {...}, servers: {...}, dms: {...} }`.

### CL-008 — WS event-dispatch met 7 nested if-statements
- **Severity:** medium · **Categorie:** complexity
- **Locations:** `pages/App/useAppInit.ts:431-652` (220-line useEffect)
- **Observation:** sequentiële `if (e.op === 'DmClose')`, `if (e.op === 'DmMessageHide')`, … geen exhaustiveness-check.
- **Recommendation:** event-handler-map: `const handlers: Record<EventOp, Handler> = { DmClose: …, … }; wsClient.on(e => handlers[e.op]?.(e))`.

### CL-009 — `Message.tsx` dubbel render-pad voor DM vs server
- **Severity:** high · **Categorie:** duplication, size
- **Locations:** `components/Message/Message.tsx:450-666` (DM card), plus ~330 LOC server-layout boven.
- **Observation:** if `isDm` returnt aparte JSX-tree. Toolbar/menu/thread-badge logic dubbel.
- **Recommendation:** extract `<MessageActionToolbar actions={…} />`, gebruik CSS-variant `is-dm` class voor positioning. Eén render-pad.

### CL-010 — File-attachment-validatie dubbel
- **Severity:** low · **Categorie:** duplication
- **Locations:** `ChatArea.tsx:96-105` + `RichInput.tsx:274-280`
- **Recommendation:** `utils/files.ts` → `validateAttachments(files): { valid, oversized }`.

### CL-011 — Fire-and-forget API-calls zonder error-handling
- **Severity:** high · **Categorie:** errors
- **Locations:**
  - `pages/App/useAppHandlers.ts:130` (`void leaveChannel()`)
  - `pages/App/useAppHandlers.ts:133` (`void joinChannel()`)
  - `components/ChatArea/ChatArea.tsx:358, 363` (`void startCall()`)
  - `pages/App/useAppInit.ts:176` (`loadServerData()` zonder await)
- **Impact:** voice-join failure silent → user denkt dat hij joint terwijl het niet zo is.
- **Recommendation:** `.catch(err => useToast.getState().show({ kind: 'error', text: '…' }))` op kritieke paden.

### CL-012 — Silent `.catch(() => {})`
- **Severity:** medium · **Categorie:** errors
- **Locations:**
  - `components/Message/Message.tsx:138` (clipboard.writeText)
  - `hooks/useNMPlayer.ts:198-200` (exitFullscreen)
  - `components/GifPicker/GifPicker.tsx:55-66`
- **Recommendation:** minimaal `console.warn(ctx, err)`. Bij user-actions: targeted toast.

### CL-013 — useEffect-deps explosie in `useAppMemos`
- **Severity:** medium · **Categorie:** complexity
- **Locations:** `useAppMemos.ts:104` (8 deps), `:129` (6 deps incl. hele `storeMessages`)
- **Observation:** elke presence-update rebuildt uiServers-list met 100+ servers.
- **Recommendation:** Zustand selector-pattern per gebruikt veld i.p.v. hele state-objects in deps.

### CL-014 — Geen tests
- **Severity:** medium · **Categorie:** testing
- **Locations:** zero `*.test.ts` / `*.spec.ts` files. Pure functies in `utils/emoji.ts` (499 LOC), `utils/format.ts`, `crypto/keys.ts` (285 LOC), `adapters/transforms.ts` (316 LOC) ongetest.
- **Recommendation:** vitest setup. Start met `crypto/keys.ts` (high-value, low-mockery) en `adapters/transforms.ts`. Niet alles tegelijk.

### CL-015 — Onaangelinkte TODO-comments
- **Severity:** low · **Categorie:** dead-code
- **Locations:** `Settings.tsx:380` (analytics), `TabBar.tsx:171, 562` (voice/call-kind tracking)
- **Recommendation:** ofwel resolven, ofwel `// TODO(#issue): …` met issue-link.

### CL-016 — Direct `useStore.getState()` in componenten
- **Severity:** medium · **Categorie:** abstraction
- **Locations:** `pages/App/AppShell.tsx:212`, `pages/App/useAppHandlers.ts:374`, en meer
- **Observation:** components reiken in store-internals (`useServersStore.getState().fetchMembersWithRoles`).
- **Recommendation:** ofwel actions-only via subscription, ofwel wrapper service-laag (`servers.fetch()` die intern `getState()` doet).

### CL-017 — `eslint-disable` van exhaustive-deps maskeert closures
- **Severity:** medium · **Categorie:** complexity
- **Locations:** `useAppInit.ts:227, 253, 282, 307, 327, 388, 405` (7×)
- **Recommendation:** elk geval óf justify met inline reden + bewuste keuze, óf alle deps expliciet listen. Bij conditional deps: extract conditional naar stable variable.

### CL-018 — Message-content rendering verspreid over 3 plekken
- **Severity:** low · **Categorie:** duplication
- **Locations:** `components/MessageContent.tsx`, `components/Message/Message.tsx:259`, `adapters/transforms.ts`
- **Recommendation:** consolideer in `MessageContent` als single source of truth; transforms doen alleen normalisatie.

### CL-019 — Modal-scaffolding niet ge-uniformeerd
- **Severity:** low · **Categorie:** abstraction
- **Locations:** `Settings.tsx`, `ServerSettings.tsx`, `ReportModal.tsx`, `ChannelSettings.tsx`. Sommige migreerden al naar `SettingsShell`-look (FriendsPanel, NewDMModal — 2026-05-03), andere niet.
- **Recommendation:** een `<Modal>` wrapper met header/body/footer slots, alle modals migreren.

### CL-020 — Presence-sync verspreid over meerdere effects
- **Severity:** low · **Categorie:** complexity
- **Locations:** `useAppInit.ts:215-222, 302-305, 150-153`
- **Observation:** drie plekken doen eigen `api.queryPresence(userIds)` + `setBulk(p)`.
- **Recommendation:** `services/presenceSync.ts` met dedupe/batching.

### CL-021 — Unhandled promise-rejection in async effects
- **Severity:** medium · **Categorie:** errors
- **Locations:** `useAppInit.ts:142-149` (Promise.all DM users), `:632-650` (setDmUsers na cancelled)
- **Observation:** cancelled-flag wordt soms niet gechecked vóór setState.
- **Recommendation:** AbortController of `if (cancelled) return;` vóór elke setState in async-effects.

### CL-022 — Permission-check switches >8 branches
- **Severity:** low · **Categorie:** complexity
- **Locations:** `Message.tsx:398-442` (delete-action branching), `utils/permissions.ts` bitfield-checks inline
- **Recommendation:** `useMessageActions(msg, perms)` hook → `{ canDelete, canEdit, canHide, deleteLabel }`.

### CL-023 — Stale-ref workaround in `useAppInit`
- **Severity:** medium · **Categorie:** complexity
- **Locations:** `useAppInit.ts:428-430` (`activeDmIdRef`)
- **Observation:** ref stored om `useEffect(…, [])`-WS-subscriber actuele waarde te geven.
- **Recommendation:** verplaats WS-subscriber dichter bij state (separate hook met eigen deps), niet in oneindige init-effect.

### CL-024 — `formatDayLabel` / `dayKey` inline in ChatArea
- **Severity:** low · **Categorie:** duplication
- **Locations:** `ChatArea.tsx:306-322`
- **Recommendation:** `utils/dateFormat.ts` (zal door threads/search hergebruikt worden).

### CL-025 — Emoji + mention autocomplete logic verweven
- **Severity:** low · **Categorie:** complexity
- **Locations:** `ChatArea.tsx:174-211, 245-272`
- **Recommendation:** `useAutocomplete(input)` → `{ emoji: { query, index, matches, insert }, mention: {…} }`.

### CL-026 — Premature `loadServerData` helper (2 callsites)
- **Severity:** low · **Categorie:** abstraction
- **Locations:** `useAppInit.ts:200-223`, called op 176 en 188
- **Recommendation:** óf inline beide, óf hijs de helper naar module-niveau zodra een derde callsite ontstaat.

### CL-027 — Magic numbers verspreid
- **Severity:** low · **Categorie:** comments
- **Locations:** `ChatArea.tsx:96` (25 MB), `useAppHandlers.ts:79` (3000ms), `voice/voiceService.ts:132` (15000ms)
- **Recommendation:** `utils/constants.ts`:
  ```ts
  export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
  export const TYPING_THROTTLE_MS = 3_000;
  export const VOICE_TIMEOUT_MS = 15_000;
  ```

---

## 4. React / TypeScript Best Practices (BP) — 28 findings

### BP-001 — `ChatArea` heeft 22 props
- **Severity:** high · **Categorie:** components
- **Locations:** `components/ChatArea/ChatArea.tsx:66`
- **Recommendation:** groep-context (`ChatActionsContext`, `ChatPermissionsContext`) of een `chatActions` object.

### BP-002 — Geen virtualisatie op message-list
- **Severity:** high · **Categorie:** performance
- **Locations:** `ChatArea.tsx:533-583`
- **Observation:** bij 1.000+ berichten → 1.000+ DOM nodes; layout/paint thrash.
- **Recommendation:** `react-virtual` (TanStack Virtual) of `react-window`. Behoud column-reverse + sticky-bottom-pinning. Dit is de hotste performance-actie.

### BP-003 — `as unknown as X` op API-grenzen
- **Severity:** high · **Categorie:** typescript
- **Locations:** `useAppInit.ts:160` (theme), `:662`, `api/client.ts`, `platform/detect.ts`
- **Recommendation:** zod (of valibot) schemas voor API-responses. `satisfies` operator voor compile-time checks. Schema-drift vroeg vangen.

### BP-004 — GIF-picker niet ge-virtualiseerd
- **Severity:** medium · **Categorie:** performance
- **Locations:** `components/GifPicker/GifPicker.tsx:80-90`
- **Recommendation:** `react-window VariableSizeGrid` of custom intersection-observer-based windowing.

### BP-005 — `forwardRef` legacy patroon
- **Severity:** medium · **Categorie:** hooks
- **Locations:** `RichInput.tsx`, `ui/Button.tsx`, `ui/Input.tsx`, `ui/Select.tsx`
- **Observation:** React 19 accepteert `ref` als gewone prop.
- **Recommendation:** strip `forwardRef` uit Button/Input/Select. RichInput behoudt het wegens `useImperativeHandle` voor `getTextBeforeCursor()`.

### BP-006 — `key={index}` op dynamische lijsten
- **Severity:** medium · **Categorie:** components
- **Locations:**
  - `Message.tsx:226` reactions (`key={i}`)
  - `ChatArea.tsx:431` group avatars (`key={i}`)
- **Recommendation:** reactions: `key={r.emoji}`. Avatars: `key={participants.map(p=>p.userId).join('-')}`.

### BP-007 — Per-render URL parsing in `Message.tsx`
- **Severity:** medium · **Categorie:** performance
- **Locations:** `Message.tsx:83-106` (clientEmbeds useMemo)
- **Observation:** per visible message een regex over content + URL parsing. 100 visible messages × elke render = duur.
- **Recommendation:** verplaats embed-detectie naar `adapters/transforms.ts` zodat het 1× per message-create gebeurt en cached blijft op de MessageVM.

### BP-008 — Avatar-URL recompute per render
- **Severity:** medium · **Categorie:** performance
- **Locations:** `components/Avatar/Avatar.tsx:18-27`, `useAppMemos.ts:61-62, 76-77`
- **Recommendation:** depends-array `[user?.id, user?.avatar_url]` i.p.v. hele user-object.

### BP-009 — `useShallow` ontbreekt op grote selectors
- **Severity:** medium · **Categorie:** performance
- **Locations:** `useAppInit.ts:28-37` (servers/channels selectors)
- **Recommendation:**
  ```ts
  const { servers, channels } = useServersStore(useShallow(s => ({ servers: s.servers, channels: s.channels })));
  ```

### BP-010 — Race condition in `useDecryptedContent`
- **Severity:** medium · **Categorie:** hooks
- **Locations:** `hooks/useDecryptedContent.ts:34-85`
- **Observation:** retry-timer cleanup, maar in-flight `decryptChannelMessage` promise wordt niet gecanceld.
- **Recommendation:** `cancelled = true` flag + `if (!cancelled) setState(…)` guard, of AbortController.

### BP-011 — `newDmOpen` close zonder feedback / dubbel-submit
- **Severity:** medium · **Categorie:** components
- **Locations:** `components/NewDMModal/NewDMModal.tsx`, `useAppHandlers.ts:532`
- **Recommendation:** loading-state + disabled submit + toast op success.

### BP-012 — `eslint-disable exhaustive-deps`
- **Severity:** medium · **Categorie:** hooks
- **Locations:** `useAppInit.ts:227, 253, 282`, `useAppHandlers.ts:234`
- **Recommendation:** elke disable: comment met expliciete reden, of ref-pattern (`callbackRef.current = …`), of refactor naar correcte deps. Zie ook CL-017.

### BP-013 — Inline-functions in JSX defeated memoization
- **Severity:** medium · **Categorie:** components
- **Locations:** `ChatArea.tsx:561` (`onToggleReaction={readOnly || ... ? undefined : (emoji) => onToggleReaction(msg.id, emoji)}`)
- **Recommendation:** factory-functies stable maken (`useCallback` met juiste deps), of `Message` met custom comparator memoizen die de relevante props vergelijkt.

### BP-014 — `presenceMap` rebuild per render
- **Severity:** medium · **Categorie:** components
- **Locations:** `useAppMemos.ts:49-92`
- **Observation:** `new Map(Object.entries(presences))` elke keer.
- **Recommendation:** custom `usePresenceMap()` hook met intern cache; of presence store retourneert direct een Map.

### BP-015 — Async modal-acties zonder loading/error state
- **Severity:** medium · **Categorie:** async
- **Locations:** `NewDMModal.tsx:85-100`, `Settings.tsx` profile updates
- **Recommendation:** try/catch + inline error, disabled submit tijdens promise.

### BP-016 — Status-Record zonder exhaustiveness
- **Severity:** low · **Categorie:** components
- **Locations:** `Avatar.tsx:49-51`
- **Observation:** als API een nieuwe status toevoegt → undefined className.
- **Recommendation:** discriminated union + switch, of fallback `_default`.

### BP-017 — Refs gemuteerd tijdens render
- **Severity:** low · **Categorie:** hooks
- **Locations:** `Avatar.tsx:63-69` (`prevKeyRef.current` update buiten useEffect)
- **Recommendation:** `useEffect` wrap of `usePrevious()` hook.

### BP-018 — Ontbrekende `alt`-text op semantisch belangrijke images
- **Severity:** low · **Categorie:** a11y
- **Locations:** `ChatArea.tsx:438, 446` (group/DM avatars met `alt=""`); `Message.tsx:236` reaction emoji
- **Recommendation:** `alt={dmFirstP?.name ?? 'User avatar'}`. Voor groep: "Group DM with X and Y".

### BP-019 — Icon-only buttons zonder `aria-label`
- **Severity:** low · **Categorie:** a11y
- **Locations:** `ChatArea.tsx:422, 465, 473, 486, 494, 505`
- **Observation:** `title` aanwezig maar screenreaders pakken `aria-label` met voorkeur.
- **Recommendation:** `aria-label="Start voice call"` etc.

### BP-020 — `Settings` modal mist focus-trap
- **Severity:** low · **Categorie:** a11y
- **Locations:** `Settings/Settings.tsx`
- **Observation:** `Modal.tsx` heeft `useFocusTrap`, Settings gebruikt hem niet.
- **Recommendation:** wrap Settings in `<Modal>` of voeg `useFocusTrap` toe.

### BP-021 — Form-inputs zonder `<label>`-koppeling
- **Severity:** low · **Categorie:** a11y
- **Locations:** `Settings/Settings.tsx` (display name, bio), `NewDMModal.tsx:58` (search)
- **Recommendation:** wrap in `<label>` of `aria-labelledby`.

### BP-022 — Avatar-fallback OKLCH color contrast
- **Severity:** low · **Categorie:** a11y
- **Locations:** `adapters/transforms.ts:42` (`oklch(55% 0.18 ${hue})`), `FriendsPanel.tsx:54`
- **Observation:** vaste 55%/0.18 — gele/lichtblauwe hues kunnen onleesbaar zijn op licht thema.
- **Recommendation:** WCAG AA contrast check, of token met gegarandeerde luminantie.

### BP-023 — DM-list optimistic-update race-window
- **Severity:** low · **Categorie:** hooks
- **Locations:** `useAppHandlers.ts:156-162`
- **Observation:** functional setState patterns staan goed; concurrente DM-mutations zouden elkaar kunnen overschrijven.
- **Recommendation:** request-id of debounce per DM.

### BP-024 — Emoji/mention-autocomplete zonder debounce
- **Severity:** low · **Categorie:** performance
- **Locations:** `ChatArea.tsx:245-270` (`setTimeout(…, 0)` is geen echte debounce)
- **Recommendation:** hergebruik `useDebouncedValue` (al aanwezig in GifPicker/NewDMModal) met 100-150ms.

### BP-025 — Geen AbortController op search-fetches
- **Severity:** low · **Categorie:** async
- **Locations:** `GifPicker.tsx:80-90`, `NewDMModal.tsx:85-100`
- **Observation:** snelle typer → meerdere in-flight requests; laatste-wint kan stale resultaat zijn.
- **Recommendation:** `AbortController` per query, abort op nieuwe query of unmount.

### BP-026 — Presence bailout effectiveness
- **Severity:** low · **Categorie:** performance
- **Observation:** store-bailout (2026-04-11) staat correct. Maar consumers zonder `useShallow` evalueren selector nog steeds. Zie BP-009/BP-014.
- **Recommendation:** zie BP-009.

### BP-027 — `useTypingUsers` in `useAppMemos`
- **Severity:** low · **Categorie:** performance
- **Locations:** `useAppMemos.ts:169`
- **Observation:** `useTypingUsers` gebruikt al `useShallow` intern (typing.ts). Dit is in orde.
- **Recommendation:** geen actie.

### BP-028 — URL-parsing met regex i.p.v. URL API
- **Severity:** low · **Categorie:** routing
- **Locations:** `useAppInit.ts:122-125` (`/\/dm\/([^/]+)/`)
- **Recommendation:** `new URL(window.location).pathname.split('/')` of `useParams`.

---

## 5. Web Security & Quality (SEC) — 29 findings (na filter)

> 3 embed-gerelateerde findings (SEC-002, SEC-003, SEC-025) zijn verplaatst naar §1 "Out of scope".

### SEC-001 — `target="_blank"` zonder `rel="noopener noreferrer"`
- **Severity:** high · **Categorie:** xss
- **Locations:**
  - `components/LinkEmbed/LinkEmbed.tsx:18`
  - `components/MessageAttachments/MessageAttachments.tsx:109`
- **Observation:** `window.opener`-vulnerability — geopende pagina kan parent-tab redirecten.
- **Recommendation:** voeg `rel="noopener noreferrer"` toe. **Quick win.**

### SEC-004 — CSP-mismatch tussen Tauri-config en nginx
- **Severity:** medium · **Categorie:** csp
- **Locations:** `src-tauri/tauri.conf.json:53`, `jolkr-server/docker/security_headers.conf:6`
- **Observation:** Tauri staat ruimere `style-src 'unsafe-inline'`, en bredere `connect-src` / `frame-src` toe (jQuery CDN, Discord API). Web-CSP is strikter. Beide staan `style-src 'unsafe-inline'` toe.
- **Recommendation:** documenteer waarom Tauri-CSP breder is. Op web: kwartaal-review van `frame-src` allowlist; eventueel `'unsafe-inline'` weg via CSS-in-JS of `<link rel="stylesheet">`-only.

### SEC-005 — QR-code regex valideert geen UUID-vorm
- **Severity:** medium · **Categorie:** deeplink
- **Locations:** `components/QrCodeScanner/QrCodeScanner.tsx:25-30`
- **Observation:** `[0-9a-f-]{36}` matcht ook `aaaa…aaaa` (36×). Backend faalt met 404, UX is verwarrend.
- **Recommendation:** `\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i` of UUID-validate na extract. **Quick win.**

### SEC-006 — Vault-password lifecycle in sessionStorage
- **Severity:** medium · **Categorie:** secrets
- **Locations:** `platform/storage.ts:49-67`
- **Observation:** verbetering t.o.v. localStorage (audit C6) staat — maar `api.clearTokens()` wist `VAULT_PASSWORD` niet expliciet, en er is geen idle-timeout.
- **Recommendation:**
  - `api.clearTokens()`: `sessionStorage.removeItem(STORAGE_KEYS.VAULT_PASSWORD)`.
  - 30 min idle timer die hem opnieuw wist en stronghold sluit.
  - **Quick win** voor de removal-step.

### SEC-007 — DOMPurify allowlist bevat `<button>`, `<svg>`, `<path>`
- **Severity:** medium · **Categorie:** xss
- **Locations:** `components/MessageContent.tsx:174-175`
- **Observation:** `<button form="externalForm">` zou form hijacking kunnen doen als er ergens op de pagina een form met dat id staat. Onnodige attack-surface — die elementen worden door eigen rendering geïnjecteerd, niet uit user content.
- **Recommendation:** strip `'button'`, `'svg'`, `'path'` uit ALLOWED_TAGS. Render het GIF-favorite-heart-button als React component i.p.v. via injected HTML.

### SEC-008 — Tweede DOMPurify pass is fragiel defense-in-depth
- **Severity:** low · **Categorie:** xss
- **Locations:** `MessageContent.tsx:200-203`
- **Observation:** `marked.parse → DOMPurify → highlightMentions → renderCustomEmojis → renderUnicodeEmojis → DOMPurify` (2e pass essentieel). Als iemand later de 2e DOMPurify call verwijdert, breekt veiligheid stilletjes.
- **Recommendation:** comment-blok dat de noodzaak documenteert + idealiter migreer mention/emoji-rendering naar React-component-tree (geen string-manipulatie meer nodig).

### SEC-009 — `Math.random` voor non-crypto uses
- **Severity:** medium (was: low) · **Categorie:** crypto
- **Locations:** `hooks/useNMPlayer.ts` (DOM id), `utils/theme.ts` (orb positions)
- **Observation:** géén crypto-context, dus geen vulnerability. Maar voorkom dat een toekomstige refactor abuseert.
- **Recommendation:** ESLint custom rule of een `no-restricted-syntax` om `Math.random` te bannen in `crypto/`, `voice/`, `api/`, `platform/`. Bestaande crypto gebruikt `crypto.getRandomValues` correct.

### SEC-010 — `compareBytes` is niet timing-safe
- **Severity:** low · **Categorie:** crypto
- **Locations:** `crypto/keys.ts`
- **Observation:** vergelijking `a[i] !== b[i]` met early return. Identity-keys zijn publiek → impact nihil. Maar code-smell als de functie ooit op secrets toegepast zou worden.
- **Recommendation:** comment "public material; non-constant-time OK" of vervang door `subtle.timingSafeEqual`-equivalent (XOR-fold).

### SEC-011 — Legacy vault-password fallback
- **Severity:** low · **Categorie:** secrets
- **Locations:** `platform/storage.ts:82-83`
- **Observation:** als per-installatie wachtwoord faalt, fallback naar `'io.jolkr.app'`. Legacy installs blijven decrypteerbaar bij file-access tot fallback verwijderd is.
- **Recommendation:** zet sunset-datum (bv. 6 maanden post-release). Op succesvolle legacy-load: re-encrypt met fresh password en force migrate.

### SEC-012 — Android `JolkrNative` JS-bridge bereikbaar vanuit cross-origin iframes
- **Severity:** high · **Categorie:** tauri
- **Locations:** `src-tauri/gen/android/app/src/main/java/io/jolkr/app/MainActivity.kt:145, 272-282`
- **Observation:** `addJavascriptInterface` exposeert bridge aan ALLE JS in de WebView, inclusief embed-iframes. Huidige methods (`enterFullscreen`/`exitFullscreen`) zijn laag-impact, maar:
  - Een toekomstige uitbreiding (file access, camera, etc.) is meteen exploiteerbaar door cross-origin embed.
  - Embeds kunnen onverwacht fullscreen toggle triggeren (UX-misuse).
- **Recommendation:** in JS-bridge: voeg origin-check toe (`if (window.self !== window.top) return;`) of vereis een nonce die alleen het top-frame kent. Hard-document dat de bridge nooit privileged operations mag exposen. Dit is een **architectuur-regel**, niet alleen een fix.

### SEC-013 — WS-token zonder challenge-response
- **Severity:** medium · **Categorie:** transport
- **Locations:** `api/ws.ts:37`
- **Observation:** `Identify`-message bevat access-token. Geen replay-protectie aan client-zijde. Backend zou multi-IP moeten weigeren — dit is een beleid dat backend-zijdig hoort, niet alleen frontend.
- **Recommendation:** lange termijn: nonce-based challenge-response. Korte termijn: bevestig backend-policy en log.

### SEC-014 — `window.open(...)` zonder `noopener` in ImageLightbox
- **Severity:** low · **Categorie:** xss
- **Locations:** `components/ImageLightbox/ImageLightbox.tsx:240` (regel 245 doet het wél goed)
- **Recommendation:** `window.open(displaySrc, '_blank', 'noopener')`. **Quick win.**

### SEC-015 — Auth-store niet geclearded vóór redirect bij refresh-failure
- **Severity:** low · **Categorie:** secrets
- **Locations:** `api/client.ts:217, 235`
- **Observation:** redirect-to-login zonder `useAuthStore.getState().logout()`. Korte race-window waarin componenten oude user-state zien.
- **Recommendation:** vóór redirect: `await useAuthStore.getState().logout()`.

### SEC-016 — `PENDING_INVITE` / `PENDING_ADD_FRIEND` in sessionStorage
- **Severity:** medium · **Categorie:** secrets
- **Locations:** `App.tsx:152, 167`
- **Observation:** clearing gebeurt al na replay (lijnen 41, 53). Maar als de app crashed tussen write en replay → blijven staan tot tab-close. UUID's zijn niet zélf secrets, maar koppeling user→bestemming lekt.
- **Recommendation:** overweeg router-state (`navigate('/login', { state: { pendingInvite } })`) i.p.v. sessionStorage.

### SEC-017 — Backend-error messages verbatim aan user getoond
- **Severity:** low · **Categorie:** logging
- **Locations:** `App.tsx:176` en gelijkaardige
- **Observation:** "User not found" lekt schema. Bij een goed gehardende backend is dit prima; bij ooit een information-disclosure-bug op de backend versterkt dit het lek.
- **Recommendation:** error-code → generic-message map in `utils/errorMessages.ts`.

### SEC-018 — Geen client-side rate limit op `sendFriendRequest` deeplink
- **Severity:** low · **Categorie:** quality
- **Locations:** `App.tsx:172`
- **Observation:** automatische scan-spam mogelijk. Server limiteert al (30r/s nginx).
- **Recommendation:** lokaal cooldown van 5s na scan.

### SEC-019 — `marked.parse` zonder expliciete sanitizing-renderer
- **Severity:** low · **Categorie:** xss
- **Locations:** `MessageContent.tsx:195`
- **Observation:** custom renderer, output → DOMPurify. Veilig zo, maar afhankelijk van DOMPurify-aanwezigheid.
- **Recommendation:** comment + `marked-sanitize-html` als 2e laag, of marked-renderer die `&lt;`-encoded HTML returnt.

### SEC-020 — `resetE2EE().catch(console.warn)` in logout
- **Severity:** medium · **Categorie:** crypto
- **Locations:** `stores/auth.ts:114`
- **Observation:** als reset faalt → keys blijven in IndexedDB/memory. Volgende user op dezelfde browser kan ze potentieel zien.
- **Recommendation:** geen silent catch — toon toast "Failed to clear keys, restart browser before logging in again". Optioneel: refuse logout-completion tot reset slaagt (of forced reload).

### SEC-021 — IndexedDB E2EE-keys clearance niet geverifieerd
- **Severity:** medium · **Categorie:** crypto
- **Locations:** `services/e2ee.ts` (referentie, niet diep ge-audit)
- **Observation:** `resetE2EE` zou idealiter `indexedDB.deleteDatabase()` aanroepen voor élke E2EE-DB.
- **Recommendation:** audit `e2ee.ts` op database-namen + verifieer dat reset álles wist (prekeys, message keys, identity, channel keys, dm session keys). Voeg test toe.

### SEC-022 — `LinkEmbed` URL-validatie alleen `https://`-prefix
- **Severity:** low · **Categorie:** quality
- **Locations:** `components/LinkEmbed/LinkEmbed.tsx:10`
- **Observation:** `https://evil.com/phishing` passeert. Link opent met noopener (mits SEC-001 fixed) — phishing-risico via legitiem-ogende preview.
- **Recommendation:** allowlist van trusted domains, of server-side preview-validatie.

### SEC-023 — Encryption-worker CSP niet expliciet gespecified
- **Severity:** low · **Categorie:** csp
- **Locations:** `src-tauri/tauri.conf.json:53`
- **Observation:** `worker-src 'self'` aanwezig. Voice encryption-worker zou same-origin moeten zijn.
- **Recommendation:** verifieer dat worker uit `/voice/encryptionWorker.js` (of wat het pad is) wordt geladen en niet inline.

### SEC-024 — nginx CSP `script-src 'unsafe-inline'`
- **Severity:** medium · **Categorie:** csp
- **Locations:** `jolkr-server/docker/security_headers.conf:6`, oorzaak: `index.html:11-17` inline theme-detect-script
- **Observation:** **Dit is een echte verzwakking.** Eén inline-script forceert de hele app om elke geïnjecteerde `<script>` toe te staan. Defense-in-depth (DOMPurify, marked) staat nu te dragen wat de CSP zou moeten dragen.
- **Recommendation:**
  - Optie A: extracteer theme-script naar `/theme.js` + `<script src="/theme.js">`. Verwijder `'unsafe-inline'`. Test op flash-of-unstyled-content.
  - Optie B: nonce-based CSP. nginx `sub_filter` of `ngx_http_sub_module` om nonce te injecteren per request.
  - Optie A is simpeler; B is robuster.

### SEC-026 — Geen client-side MIME-validatie op uploads
- **Severity:** low · **Categorie:** quality
- **Locations:** `api/client.ts` (`uploadFile`/`uploadAttachment`), `ChatArea.tsx`
- **Observation:** backend zou ook moeten valideren — maar UX wint bij vroege detectie.
- **Recommendation:** in `<input type="file" accept="image/*,video/*,...">` + JS magic-byte check (al aanwezig in backend voor emoji uploads — H5).

### SEC-027 — `X-Frame-Options: SAMEORIGIN`
- **Severity:** low · **Categorie:** csp
- **Locations:** `jolkr-server/docker/security_headers.conf:3`
- **Observation:** als jolkr.app geen subdomeinen-die-frame-de-app gebruikt, kan dit naar `DENY`. SAMEORIGIN laat een gecompromitteerd subdomein clickjacken.
- **Recommendation:** verifieer of er subdomeinen gebruikt worden om de app te framen; zo niet → `DENY`.

### SEC-028 — Geen Subresource Integrity op Google Fonts
- **Severity:** low · **Categorie:** supply-chain
- **Locations:** `index.html:7-9`
- **Recommendation:** SRI-hashes op `<link rel="preload">` voor `fonts.googleapis.com`. Of selfhost de fonts.

### SEC-029 — Caret-ranges op security-kritieke deps
- **Severity:** low · **Categorie:** supply-chain
- **Locations:** `package.json` — `marked@^17.0.3`, `dompurify@^3.3.1`, `@noble/curves@^2.0.1`, `@noble/post-quantum@^0.5.4`, `qrcode.react@^4.2.0`, `html5-qrcode@^2.3.8`
- **Recommendation:** pin exact (`marked: 17.0.3`) voor security-critical libs; `npm audit` in CI; renovate-bot review. Voor `@noble/*` is pinnen extra belangrijk (crypto correctness).

### SEC-030 — HSTS preload-header zonder ingeschreven preload
- **Severity:** low · **Categorie:** csp
- **Locations:** `jolkr-server/docker/nginx.conf:133`
- **Observation:** `preload` directive zonder daadwerkelijke inschrijving op `hstspreload.org`.
- **Recommendation:** verifieer status; of inschrijven, of `preload` weghalen.

### SEC-031 — Geen client-side rate limit op WS subscribe/unsubscribe
- **Severity:** low · **Categorie:** quality
- **Locations:** `api/ws.ts:74-93`
- **Recommendation:** debounce 500ms op subscribe-aanroepen; nginx WS-rate-limit (5r/s) is connectie-niveau, niet message-niveau.

### SEC-032 — Console-logs lekken interne state-hints
- **Severity:** low · **Categorie:** logging
- **Locations:** 104 `console.*` calls; specifiek:
  - `platform/storage.ts` `[TauriStorage] Using legacy vault password …`
  - `services/e2ee.ts` `E2EE: Failed to upload prekeys …`
  - `crypto/channelKeys.ts` `Channel E2EE: …`
- **Recommendation:** Sentry (of een lichte logger) met PII-filter; redact interne state in user-zichtbare logs.

---

## 6. Cross-cutting thema's

| Thema | Categorieën | Findings | Actie |
|---|---|---:|---|
| Monolith in `pages/App/` | CL, BP | CL-001/2/8/13/17/20/21/23, BP-009/12/14 | Splits useAppInit (zie aanbevolen volgorde) |
| Type-safety op API-grenzen | CC, BP | CC-004/5/20, BP-003 | zod schemas + typed client |
| Async error-handling | CC, CL, SEC | CC-006, CL-011/12/21, SEC-015/17/20 | log+toast helper, never-silent-catch policy |
| Performance op chat-list | BP, CL | BP-002/7/8/9/13/14/24, CL-013 | virtualization + transforms-once-then-cached |
| CSP / inline | SEC | SEC-024 (en buiten scope SEC-002/3/25) | extract theme-script of nonce |
| Logout / session lifecycle | SEC | SEC-006/15/20/21 | logout-cleanup checklist |
| Modal scaffolding | CL, BP | CL-019, BP-020/21 | unified `<Modal>` component met focus-trap + label-koppeling |

---

## 7. Voorgestelde remediatie-roadmap

> Volgorde-suggestie. Niets wordt zonder jouw akkoord doorgevoerd.

### Fase 0 — Quick wins (~1 sessie)
- SEC-001 (rel=noopener)
- SEC-005 (UUID regex)
- SEC-006 (vault password clear)
- SEC-014 (ImageLightbox window.open)
- CC-009 (eslint argsIgnorePattern)
- CL-027 (constants file)
- BP-019 (aria-labels)

### Fase 1 — Architectuur deblokkeer (1-2 sessies)
- CL-001 (split useAppInit)
- CL-006 (DM/channel API strategy)
- BP-003 / CC-005 (zod op API boundaries) — kan parallel
- CL-016 (store-getState wrapper)

### Fase 2 — God-components decomposeren (2-3 sessies)
- CL-003 (ServerSettings tabs) — deblokkeert mobile Roles-tab fix
- CL-004 (ChatArea decompositie) — koppel met BP-001
- CL-005 (ChannelSidebar drag-hook)
- CL-009 (Message DM/server unify)

### Fase 3 — Performance pass (1-2 sessies)
- BP-002 (message virtualization) — grootste impact
- BP-007 (transform-side embed parsing)
- BP-008 (avatar memoization deps)
- BP-009 / BP-014 (useShallow + presence map)
- BP-024 (autocomplete debounce)
- BP-025 (AbortController)

### Fase 4 — Security hardening (1-2 sessies)
- SEC-024 (CSP unsafe-inline) — grootste impact
- SEC-007 (DOMPurify allowlist tighten)
- SEC-012 (Android JS bridge origin check)
- SEC-020/21 (E2EE clear op logout — verify)
- SEC-029 (pin security-critical deps)

### Fase 5 — Polish (1 sessie)
- CC-001/3 (CSS tokens cleanup)
- CC-008/22 (export-strategy + AppShell move)
- CC-020 (ApiError adoption)
- CL-019 (unified Modal)
- BP-005 (forwardRef cleanup)
- BP-018/20/21/22 (a11y pass)
- CL-014 (vitest setup + crypto-keys + transforms tests)

---

## 8. Notities

- **Reeds gemitigeerd in code (geverifieerd):** presence store re-render bailout, vault sessionStorage, plaintext-fallback block, double-storage E2EE bug, HTTP→HTTPS redirect, /metrics restriction, server_tokens off, NATS mandatory creds, focus-trap-hook (waar gebruikt), CSS reveal-animation hook (geen meer dupes), `displayName()` consolidation. Niet opnieuw flaggen.
- **Bewust geaccepteerd risico (jouw beslissing):** embed-iframe-config voor VidMount/YT/Twitch (zie §1).
- **Open dev-branch context:** vier lokale commits (`69d8de8`, `8f106be`, `e835fce`, `e4aeb27`) op `dev`. Audit was uitgevoerd op die HEAD.

---

*Einde rapport.*
