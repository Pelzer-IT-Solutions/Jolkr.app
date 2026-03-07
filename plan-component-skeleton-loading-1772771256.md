# Plan: Component-Level Skeleton Loading (replace generic skeletons)

## Datum: 2026-03-06

## Context
De huidige skeleton loading states zijn generieke grijze balken op parent-niveau (bijv. MessageList rendert altijd 6 identieke grijze bars, ongeacht hoeveel berichten er daadwerkelijk zijn). Ze matchen niet met de echte content en zien er lelijk uit.

De nieuwe aanpak: **component-level lazy loading**. Elk component rendert ZICHZELF als skeleton totdat zijn eigen dependencies (author info, avatar, etc.) geladen zijn. Zo is het aantal skeletons altijd exact gelijk aan het aantal echte items.

## Kernprincipe
- De berichtenlijst komt snel binnen (message objects van API)
- Elk **MessageTile** toont zichzelf als skeleton totdat `author` (User object) geladen is
- Zodra author binnenkomt → smooth transitie naar volledig gerenderd component
- Batch-loaded lijsten (channels, members, friends) laden alle data in één keer → GEEN skeletons nodig, verwijder de generieke bars

---

## Stap 1: MessageTile — skeleton wanneer `author` undefined

**Bestand:** `jolkr-app/src/components/MessageTile.tsx`

**Huidige situatie:** MessageTile ontvangt `author?: User`. Als author undefined is, toont het "Unknown" als username + placeholder avatar. De message data (content, timestamp) is WEL beschikbaar.

**Aanpassing:** Aan het begin van `MessageTileInner`, vóór alle andere rendering, check of `author` undefined is. Zo ja, return een skeleton variant die exact dezelfde layout heeft:

```tsx
// Early return voor skeleton state — zelfde container, zelfde afmetingen
if (!author && !message.webhook_id) {
  return (
    <div className={`group flex gap-4 px-4 relative ${compact ? 'py-0.5' : 'py-1.5'}`}>
      {compact ? (
        <div className="w-10 shrink-0" />
      ) : (
        <div className="w-10 h-10 rounded-full bg-white/5 animate-pulse shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        {!compact && (
          <div className="flex items-baseline gap-2 mb-0.5">
            <div className="h-3.5 bg-white/5 rounded animate-pulse w-20" />
            <div className="h-2.5 bg-white/5 rounded animate-pulse w-10" />
          </div>
        )}
        <div className="h-3.5 bg-white/5 rounded animate-pulse" style={{ width: '60%' }} />
      </div>
    </div>
  );
}
```

**Waarom dit werkt:**
- Elke MessageTile rendert zichzelf → exact het juiste aantal skeletons
- Zelfde `flex gap-4 px-4 py-1.5` layout → zero layout shift bij transitie
- Avatar placeholder = zelfde 40x40 rounded-full
- Username bar = zelfde positie als echte username
- Content bar = zelfde positie als echte message content
- `compact` mode wordt correct afgehandeld (geen avatar, geen header)

---

## Stap 2: MessageList — verwijder generieke skeleton

**Bestand:** `jolkr-app/src/components/MessageList.tsx`

**Huidige situatie (regels 143-158):** Bij `isLoading && msgs.length === 0`, rendert 6 generieke grijze bars in een aparte div.

**Aanpassing:**
- Verwijder het hele `Array.from({ length: 6 }).map(...)` skeleton blok
- Bij `notYetFetched && msgs.length === 0`: toon niks (lege scroll area) of een subtiele centered spinner
- De berichten komen snel binnen, waarna elke MessageTile zichzelf als skeleton toont totdat author geladen is
- Het `searchLoading` "Searching..." geval blijft

```tsx
{((isLoading || searchLoading) && msgs.length === 0) || (notYetFetched && !search && !searchResults) ? (
  <div className="flex items-center justify-center h-full">
    {searchLoading ? (
      <span className="text-text-muted">Searching...</span>
    ) : (
      <div className="w-6 h-6 rounded-full border-2 border-white/10 border-t-white/40 animate-spin" />
    )}
  </div>
) : msgs.length === 0 ? (
  // ... existing "No messages yet" empty state
```

---

## Stap 3: ChannelList — verwijder generieke skeleton

**Bestand:** `jolkr-app/src/components/ChannelList.tsx`

**Huidige situatie (regels 303-308):** Bij `loading && !serverChannels.length`, rendert 6 grijze `h-8` bars.

**Aanpassing:** Channels laden als batch — alle data is compleet in de response. Vervang de 6 grijze bars met een subtiele spinner of helemaal niks:

```tsx
{loading && !serverChannels.length && (
  <div className="flex items-center justify-center py-8">
    <div className="w-5 h-5 rounded-full border-2 border-white/10 border-t-white/40 animate-spin" />
  </div>
)}
```

---

## Stap 4: MemberList — verwijder generieke skeleton

**Bestand:** `jolkr-app/src/components/MemberList.tsx`

**Huidige situatie (regels 364-372):** Bij geen members geladen, rendert 8 grijze items.

**Aanpassing:** Members laden als batch. Vervang met spinner:

```tsx
{!loadError && online.length === 0 && offline.length === 0 && (
  <div className="flex items-center justify-center py-8">
    <div className="w-5 h-5 rounded-full border-2 border-white/10 border-t-white/40 animate-spin" />
  </div>
)}
```

---

## Stap 5: Friends — verwijder generieke skeleton

**Bestand:** `jolkr-app/src/pages/App/Friends.tsx`

**Huidige situatie (regels 173-184):** Bij `friendsLoading`, rendert 5 grijze items.

**Aanpassing:** Friends laden als batch. Vervang met spinner:

```tsx
{friendsLoading && friends.length === 0 && pending.length === 0 && (
  <div className="flex items-center justify-center py-8">
    <div className="w-5 h-5 rounded-full border-2 border-white/10 border-t-white/40 animate-spin" />
  </div>
)}
```

---

## Stap 6: PollDisplay — skeleton matchen met echte poll structuur

**Bestand:** `jolkr-app/src/components/PollDisplay.tsx`

**Huidige situatie (regels 42-49):** Generieke bars die niet matchen met de echte poll layout.

**Aanpassing:** Maak de skeleton structureel identiek aan de echte poll (zelfde container, zelfde borders, zelfde spacing):

```tsx
if (loading) return (
  <div className="mt-2 bg-background/50 rounded-lg p-3 border border-divider max-w-100 animate-pulse">
    <div className="h-4 bg-white/5 rounded w-2/3 mb-2" />
    <div className="space-y-1.5">
      <div className="rounded px-3 py-1.5 border border-divider h-8 bg-white/5" />
      <div className="rounded px-3 py-1.5 border border-divider h-8 bg-white/5" />
    </div>
    <div className="h-3 bg-white/5 rounded w-1/4 mt-2" />
  </div>
);
```

---

## Stap 7: MessageInput — skeleton matchen met echte input structuur

**Bestand:** `jolkr-app/src/components/MessageInput.tsx`

**Huidige situatie (regels 424-432):** Bij `canSend === undefined`, toont een minimale bar die niet matcht met de echte input.

**Aanpassing:** Skeleton matcht de echte input layout (status line + toolbar + input area):

```tsx
if (canSend === undefined) {
  return (
    <div className="px-4 pb-4 shrink-0">
      <div className="h-4 mb-0.5" />
      <div className="flex items-center gap-0.5 mb-1">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="p-1">
            <div className="w-5 h-5 bg-white/5 rounded animate-pulse" />
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 bg-input rounded-lg px-4 py-2">
        <div className="w-5 h-5 bg-white/5 rounded animate-pulse" />
        <div className="w-5 h-5 bg-white/5 rounded animate-pulse" />
        <div className="flex-1 py-1">
          <div className="h-5 bg-white/5 rounded animate-pulse w-40" />
        </div>
        <div className="w-5 h-5 bg-white/5 rounded animate-pulse" />
      </div>
    </div>
  );
}
```

---

## Samenvatting

| Component    | Oud (generiek)      | Nieuw                                                        |
| ------------ | ------------------- | ------------------------------------------------------------ |
| MessageTile  | N/A                 | Skeleton variant van ZICHZELF wanneer `author` undefined     |
| MessageList  | 6 grijze bars       | Verwijderd → subtiele spinner, messages tonen zelf skeletons |
| ChannelList  | 6 grijze bars       | Verwijderd → subtiele spinner (batch load)                   |
| MemberList   | 8 grijze items      | Verwijderd → subtiele spinner (batch load)                   |
| Friends      | 5 grijze items      | Verwijderd → subtiele spinner (batch load)                   |
| PollDisplay  | Niet-matchende bars | Structureel identiek aan echte poll                          |
| MessageInput | Enkele bar          | Matcht echte input (toolbar + input area)                    |

---

## Bestanden

- `jolkr-app/src/components/MessageTile.tsx` — skeleton early return (Stap 1)
- `jolkr-app/src/components/MessageList.tsx` — verwijder generic skeleton (Stap 2)
- `jolkr-app/src/components/ChannelList.tsx` — verwijder generic skeleton (Stap 3)
- `jolkr-app/src/components/MemberList.tsx` — verwijder generic skeleton (Stap 4)
- `jolkr-app/src/pages/App/Friends.tsx` — verwijder generic skeleton (Stap 5)
- `jolkr-app/src/components/PollDisplay.tsx` — verbeter skeleton match (Stap 6)
- `jolkr-app/src/components/MessageInput.tsx` — verbeter skeleton match (Stap 7)

## Verificatie

- `npx tsc --noEmit` — geen type errors
- `npx vite build` — clean build
- Open channel met berichten → elke message toont kort skeleton, dan fade naar echte content
- Aantal skeletons = exact aantal echte berichten
- Channel/member/friend lijsten: subtiele spinner i.p.v. lelijke grijze bars
- MessageInput: skeleton matcht echte input structuur
- `npx tauri build` — desktop build
