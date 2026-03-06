# Plan v0.2.0 — UI/UX: Zero Jank, Smooth Transitions, No Content Jumping

## Datum: 2026-03-06

## Doel
Elimineer alle visuele jank, content jumping (CLS), loading state flashes, en abrupte show/hide gedrag. De app moet "instant" en "smooth" aanvoelen — geen enkel element mag springen, flashen of abrupt verschijnen.

---

## Fase 1: Critical — Layout Shifts & Loading Flashes (HIGH)

### 1.1 Messages store: loading state reset op channel switch
**Bestanden:** `jolkr-app/src/stores/messages.ts` (regels 103-127)
**Probleem:** Bij channel switch met gecachede data wordt `loading[channelId]` niet expliciet op `false` gezet, waardoor een kort "Loading messages..." flash zichtbaar is voordat cached berichten verschijnen.
**Fix:** Als cached data bestaat, direct `loading[channelId] = false` zetten en cached data tonen. Alleen loading state activeren als er geen cache is.
**Status:** [ ]

### 1.2 MessageList: scroll positie reset op channel switch
**Bestanden:** `jolkr-app/src/components/MessageList.tsx` (regels 40, 55-61)
**Probleem:** Bij navigatie tussen channels behoudt de virtualizer de oude scroll positie. Dit veroorzaakt dat de message list op de verkeerde offset start en dan auto-scrollt — zichtbaar als jank.
**Fix:** Expliciet `containerRef.current?.scrollTo(0, containerRef.current.scrollHeight)` aanroepen bij channel change vóór fetch. Reset virtualizer state.
**Status:** [ ]

### 1.3 MessageTile: attachment images zonder dimensies
**Bestanden:** `jolkr-app/src/components/MessageTile.tsx` (regels 218-259)
**Probleem:** `<img>` tags voor attachments hebben `max-w-[400px] max-h-[300px]` maar geen vaste hoogte/breedte of `aspect-ratio`. Wanneer een afbeelding laadt, springt de content eronder omlaag.
**Fix:** Voeg `aspect-ratio` toe op basis van attachment metadata (als beschikbaar), of gebruik een placeholder container met vaste `min-h-[200px]` + skeleton pulse achtergrond. Fade image in met `opacity` transition bij `onLoad`.
**Status:** [ ]

### 1.4 LinkEmbed: embed images zonder aspect ratio
**Bestanden:** `jolkr-app/src/components/LinkEmbed.tsx` (regels 33-42)
**Probleem:** Embed afbeeldingen hebben `max-h-[200px]` maar geen reservering van ruimte. Content springt wanneer de embed afbeelding laadt. `onError` zet `display: none` via inline style — inconsistent.
**Fix:** Container met `aspect-video` (16:9) als fallback. Skeleton placeholder tonen totdat image geladen is. Error handling via React state i.p.v. inline `style.display`.
**Status:** [ ]

### 1.5 Channel.tsx: MessageInput canSend tri-state flash
**Bestanden:** `jolkr-app/src/pages/App/Channel.tsx` (regels 186-194, 429-437)
**Probleem:** `canSend` is `true | false | undefined`. Bij `undefined` wordt MessageInput normaal gerenderd, bij `false` verschijnt een permission-denied state met andere hoogte. Dit veroorzaakt een layout jump van ~50-100ms wanneer permissions laden.
**Fix:** Reserveer een vaste container hoogte voor de input area. Render een placeholder/skeleton met dezelfde afmetingen terwijl permissions laden (`canSend === undefined`).
**Status:** [ ]

---

## Fase 2: Important — Conditional Rendering & Transitions (MEDIUM)

### 2.1 MessageInput: conditional panels stacking
**Bestanden:** `jolkr-app/src/components/MessageInput.tsx` (regels 436-545)
**Probleem:** Reply bar, file preview, slowmode indicator, error message en upload indicator worden allemaal conditioneel gerenderd met `mb-1`/`mb-2` margins. Elke keer dat een van deze verschijnt of verdwijnt, springt de input area.
**Fix:** Gebruik een wrapper container met `min-h` die ruimte reserveert. Gebruik `opacity-0` + `pointer-events-none` i.p.v. conditioneel renderen, of animeer met `max-height` transition.
**Status:** [ ]

### 2.2 MessageList: typing indicator layout shift
**Bestanden:** `jolkr-app/src/components/MessageList.tsx` (regels 212-226)
**Probleem:** Typing indicator wordt alleen gerenderd als `otherTyping.length > 0`. Verschijnt en verdwijnt abrupt, schuift content omhoog/omlaag.
**Fix:** Altijd renderen met vaste hoogte. Gebruik `opacity-0/opacity-100` + `transition-opacity` voor smooth fade. `pointer-events-none` wanneer verborgen.
**Status:** [ ]

### 2.3 Friends.tsx: tab content switching zonder reserved space
**Bestanden:** `jolkr-app/src/pages/App/Friends.tsx` (regels 173-340)
**Probleem:** Wisselen tussen tabs (All, Pending, Add) verandert de content hoogte significant. Loading state is minimaal, actual content varieert sterk in hoogte.
**Fix:** `min-h-[400px]` op tab content container. Fade transition bij tab switch (`transition-opacity duration-150`).
**Status:** [ ]

### 2.4 DmChat: member sidebar toggle zonder transitie (desktop)
**Bestanden:** `jolkr-app/src/pages/App/DmChat.tsx` (regels 337-398)
**Probleem:** Op desktop verschijnt/verdwijnt de member sidebar (240px breed) abrupt. Content area past zich instant aan — zichtbare layout shift.
**Fix:** CSS `transition: width 0.2s ease` op de sidebar container. Of `overflow: hidden` met `max-width` transition.
**Status:** [ ]

### 2.5 Channel.tsx: topic panel zonder animatie
**Bestanden:** `jolkr-app/src/pages/App/Channel.tsx` (regels 377-385)
**Probleem:** Expanded topic panel verschijnt instant, duwt content omlaag zonder animatie. Dismissal is ook instant.
**Fix:** `animate-fade-in` + `max-height` transition voor smooth appearance. Of overlay i.p.v. inline — geen content push.
**Status:** [ ]

### 2.6 Modal/dialog entrance animaties
**Bestanden:** Alle dialogs in `jolkr-app/src/components/dialogs/*.tsx`
**Probleem:** Modal backdrops en dialog content verschijnen instant. Geen fade, scale of slide animatie. Voelt "hard" aan.
**Fix:** Backdrop: `animate-fade-in` (opacity 0→1, 150ms). Dialog content: `animate-modal-scale` (scale 0.95→1 + opacity, 200ms). Toevoegen als CSS keyframes in `index.css`.
**Status:** [ ]

### 2.7 Skeleton loading states voor channel list & member list
**Bestanden:** `jolkr-app/src/components/ChannelList.tsx` (regel 297), `jolkr-app/src/components/MemberList.tsx` (regels 89-100)
**Probleem:** "Loading channels..." en "Loading members..." tekst i.p.v. skeleton UI. Blank area → tekst → content = dubbele shift.
**Fix:** Skeleton blokken met `.skeleton` class (al aanwezig in CSS). 5-8 grijze rounded bars die pulseren, zelfde afmetingen als echte channel/member items.
**Status:** [ ]

### 2.8 Permission cache invalidatie bij role changes
**Bestanden:** `jolkr-app/src/stores/servers.ts` (regels 310-324)
**Probleem:** Bij `MemberUpdate` WS event met `role_ids` changes worden `permissions` en `channelPermissions` caches NIET geïnvalideerd. UI toont stale permissions tot page refresh.
**Fix:** Bij role_ids change: verwijder de betreffende server uit permission caches zodat ze opnieuw berekend worden.
**Status:** [ ]

### 2.9 Voice state cleanup bij connection failure
**Bestanden:** `jolkr-app/src/stores/voice.ts` (regels 63-95)
**Probleem:** `channelId`, `serverId` en `channelName` worden gezet VÓÓR de connection attempt. Bij failure toont de UI dat de user "in een channel" zit terwijl voice disconnected is.
**Fix:** Channel info pas zetten NA succesvolle connectie.
**Status:** [ ]

### 2.10 DmList: search results layout shift
**Bestanden:** `jolkr-app/src/components/DmList.tsx` (regels 327-348)
**Probleem:** Bij zoeken verschijnen zoekresultaten die de Friends/New Group DM buttons omlaag duwen.
**Fix:** Search results in een `absolute` positioned overlay, of een `max-h` container met `overflow-auto` zodat de rest van de layout niet verschuift.
**Status:** [ ]

---

## Fase 3: Polish — Micro-interactions & Visual Refinement (LOW)

### 3.1 ImageLightbox: loading text flash
**Bestanden:** `jolkr-app/src/components/ImageLightbox.tsx` (regels 37-46)
**Probleem:** "Loading..." tekst flasht kort voordat afbeelding verschijnt, zelfs bij gecachede images.
**Fix:** Verwijder loading tekst. Gebruik alleen opacity transition op de image. Optioneel: toon spinner alleen na 500ms delay.
**Status:** [ ]

### 3.2 PollDisplay: loading state flash
**Bestanden:** `jolkr-app/src/components/PollDisplay.tsx` (regels 12, 42-43)
**Probleem:** "Loading poll..." tekst verschijnt kort. Geen gereserveerde hoogte.
**Fix:** Skeleton layout met dezelfde hoogte als actual poll. Pre-fetch polls met messages.
**Status:** [ ]

### 3.3 Register.tsx: password strength indicator flash
**Bestanden:** `jolkr-app/src/pages/Register.tsx` (regels 83-96)
**Probleem:** Strength indicator verschijnt/verdwijnt bij eerste keystroke — layout shift.
**Fix:** Altijd ruimte reserveren (zelfs lege `h-[20px]` div). Fade in met opacity transition.
**Status:** [ ]

### 3.4 ChannelList: unread badge position shift
**Bestanden:** `jolkr-app/src/components/ChannelList.tsx` (regels 600-604)
**Probleem:** Unread badge verschijnt/verdwijnt, verschuift channel naam naar links.
**Fix:** Reserveer badge ruimte met `visibility: hidden` placeholder wanneer geen unreads.
**Status:** [ ]

### 3.5 Avatar: ontbrekende HTML width/height attributen
**Bestanden:** `jolkr-app/src/components/Avatar.tsx` (regels 30-35)
**Probleem:** Avatar `<img>` heeft inline style dimensies maar geen HTML `width`/`height` attributen. Kan CLS veroorzaken bij lazy loading.
**Fix:** Voeg `width={size} height={size}` HTML attributen toe naast de inline styles.
**Status:** [ ]

### 3.6 Dropdown menu animaties
**Bestanden:** `jolkr-app/src/components/ChannelList.tsx` (regels 265-280)
**Probleem:** Context menus en dropdowns verschijnen instant.
**Fix:** CSS `@keyframes dropdown-enter` (opacity 0→1, translateY -4px→0, 150ms). Toepassen op alle dropdown containers.
**Status:** [ ]

### 3.7 Collapsible sections: category channels smooth expand/collapse
**Bestanden:** `jolkr-app/src/components/ChannelList.tsx` (regel 236)
**Probleem:** Category expand/collapse is instant — channels verschijnen/verdwijnen abrupt.
**Fix:** `max-height` transition op channel container. Of `grid-template-rows: 0fr → 1fr` CSS Grid trick voor smooth collapse.
**Status:** [ ]

### 3.8 Settings: desktop/mobile layout switch
**Bestanden:** `jolkr-app/src/pages/App/Settings.tsx` (regels 179-240)
**Probleem:** Bij window resize wisselt layout abrupt tussen sidebar en horizontal tabs.
**Fix:** `transition-all duration-200` op layout containers. Sidebar `width` transition.
**Status:** [ ]

### 3.9 Toast exit animatie
**Bestanden:** `jolkr-app/src/components/Toast.tsx` (regels 34-44)
**Probleem:** Toast heeft `animate-fade-in` maar verdwijnt instant.
**Fix:** Exit animatie via state: set `exiting` class → `animate-fade-out` → remove na animation end.
**Status:** [ ]

### 3.10 UserProfileCard: avatar/banner overlap refine
**Bestanden:** `jolkr-app/src/components/UserProfileCard.tsx` (regels 219-226)
**Probleem:** `-mt-8` voor avatar overlap is fragiel. Kan verschuiven bij avatar size changes.
**Fix:** Gebruik `absolute` positioning voor de avatar overlay i.p.v. negatieve margin.
**Status:** [ ]

---

## CSS Toevoegingen (index.css)

De volgende CSS keyframes/utilities moeten worden toegevoegd of bijgewerkt:

```css
/* Modal scale animation */
@keyframes modal-scale {
  from { opacity: 0; transform: scale(0.95); }
  to { opacity: 1; transform: scale(1); }
}
.animate-modal-scale {
  animation: modal-scale 0.2s ease-out;
}

/* Dropdown entrance */
@keyframes dropdown-enter {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}
.animate-dropdown-enter {
  animation: dropdown-enter 0.15s ease-out;
}

/* Collapsible sections */
.collapsible {
  display: grid;
  grid-template-rows: 1fr;
  transition: grid-template-rows 0.2s ease;
}
.collapsible.collapsed {
  grid-template-rows: 0fr;
}
.collapsible > * {
  overflow: hidden;
}

/* Skeleton loader (uitbreiden) */
.skeleton-channel {
  height: 32px;
  border-radius: 6px;
  width: 70%;
}
.skeleton-member {
  height: 44px;
  border-radius: 6px;
  display: flex;
  gap: 8px;
  align-items: center;
}
.skeleton-message {
  height: 52px;
  border-radius: 8px;
}
```

---

## Verificatie Checklist

- [ ] `npx tsc --noEmit` — geen type errors
- [ ] `npx vite build` — clean build
- [ ] Channel switch: geen blank flash, instant cached content
- [ ] Berichten met afbeeldingen: geen content jumping bij image load
- [ ] Link embeds: geen layout shift bij embed image load
- [ ] Typing indicator: smooth fade in/out, geen content shift
- [ ] MessageInput reply/upload/error: geen input area jumping
- [ ] Modals: smooth scale + fade entrance
- [ ] Channel list loading: skeleton UI i.p.v. "Loading..."
- [ ] Member list loading: skeleton UI i.p.v. "Loading..."
- [ ] Tab switching (Friends): smooth transition, geen height jump
- [ ] Sidebar toggle (DmChat desktop): smooth width transition
- [ ] Dropdowns/context menus: animated entrance
- [ ] Category collapse/expand: smooth height transition
- [ ] Toast: fade out animatie bij dismiss
- [ ] Mobile: alle fixes ook responsive correct

---

## Bestanden (geschat)

### Te wijzigen:
- `jolkr-app/src/stores/messages.ts`
- `jolkr-app/src/stores/servers.ts`
- `jolkr-app/src/stores/voice.ts`
- `jolkr-app/src/components/MessageList.tsx`
- `jolkr-app/src/components/MessageTile.tsx`
- `jolkr-app/src/components/MessageInput.tsx`
- `jolkr-app/src/components/LinkEmbed.tsx`
- `jolkr-app/src/components/ImageLightbox.tsx`
- `jolkr-app/src/components/PollDisplay.tsx`
- `jolkr-app/src/components/ChannelList.tsx`
- `jolkr-app/src/components/MemberList.tsx`
- `jolkr-app/src/components/DmList.tsx`
- `jolkr-app/src/components/Toast.tsx`
- `jolkr-app/src/components/Avatar.tsx`
- `jolkr-app/src/components/UserProfileCard.tsx`
- `jolkr-app/src/components/dialogs/*.tsx` (alle dialogs)
- `jolkr-app/src/pages/App/Channel.tsx`
- `jolkr-app/src/pages/App/DmChat.tsx`
- `jolkr-app/src/pages/App/Friends.tsx`
- `jolkr-app/src/pages/App/Settings.tsx`
- `jolkr-app/src/pages/App/Server.tsx`
- `jolkr-app/src/pages/Register.tsx`
- `jolkr-app/src/styles/index.css`
