# Backend Audit Items — Frontend ↔ Backend Schema Mismatches

Vondsten uit het frontend audit-werk waar het backend DTO niet exact
matcht met wat de TS / zod schema's verwachten. Frontend handelt elk item
nu zelf netjes af zodat schema-validatie passeert; voor een toekomstige
backend-audit hoort de bron in de Rust-DTO's te worden gefixt zodat het
contract direct klopt.

## R-001 · `ReactionInfo.me` ontbreekt
**Endpoint:** `GET /api/channels/:id/messages`,
`GET /api/channels/:id/messages/search`,
`GET /api/channels/:id/pins`, `GET /api/threads/:id/messages`,
`GET /api/dms/:id/messages`, `GET /api/dms/:id/pins`
**Probleem:** Rust struct
[`jolkr_core::services::message::ReactionInfo`](../jolkr-server/crates/jolkr-core/src/services/message.rs)
serialiseert alleen `emoji`, `count`, `user_ids` — geen `me` veld.
Frontend type `Reaction` verwacht `me: boolean` ("did the current user
react?"). De UI gebruikt het voor de active-state op een reaction
chip.
**Workaround (FE):**
- `Reaction.me: boolean` → `me?: boolean` (optional in TS interface +
  `me: z.boolean().optional()` in `ReactionSchema`).
- `stores/messages.ts::transformReactions` derived `me` uit
  `user_ids.includes(currentUserId)` direct na elke fetch en voordat
  het naar de UI gaat.
**Backend fix (toekomst):**
- Voeg `pub me: bool` toe aan `ReactionInfo`.
- Geef `caller_id: Uuid` mee aan `enrich_with_reactions(...)` /
  `enrich_dm_messages(...)`.
- Bouw elke `ReactionInfo` met `me: user_ids.contains(&caller_id)`.
- Patch alle callers (services + routes).
- Verwijder dan de `transformReactions` helper en zet
  `me: z.boolean()` terug vereist.

## C-001 · `MessageInfo.content` is `null` voor attachment-only of
encrypted-zonder-tekst messages
**Endpoint:** alle `*messages*` paths.
**Probleem:** Rust struct heeft `pub content: Option<String>` zonder
`#[serde(skip_serializing_if = "Option::is_none")]`, dus `null` komt
over de wire. Frontend `Message.content: string` (vereist) en eerder
ook `MessageSchema.content: z.string()`.
**Workaround (FE):**
- `MessageSchema.content: z.string().nullish().transform(v => v ?? '')`
  zodat consumers altijd een string krijgen.
**Backend fix (toekomst):** kies één:
- (a) Verander `content` naar `String` met `""` als default voor
  no-text rows, of
- (b) Voeg `#[serde(skip_serializing_if = "Option::is_none")]` toe en
  verander frontend type naar `content?: string`. Optie (a) is voor
  consumers makkelijker.

## V-001 · Vec collections kunnen `null` zijn ipv `[]` op edge paths
**Endpoint:** alle `*messages*` paths.
**Probleem:** Vrij van wire — backend serialiseert `Vec::new()` als
`[]`. Maar bij oudere code-paden / migrations kan `attachments`,
`reactions`, of `embeds` als `null` arriveren (DTO inconsistentie).
**Workaround (FE):** schema doet
`z.array(...).nullish().transform(v => v ?? [])` zodat nulls of
ontbrekende velden gracefully `[]` worden.
**Backend fix (toekomst):** garandeer dat alle Vec velden altijd een
JSON-array zijn (gebruik `#[serde(default)]` op alle Vec-velden).

## D-001 · `DmMessageInfo` mist serverside fields die in
`MessageInfo` wel zitten
**Endpoint:** `/api/dms/:id/messages` en gerelateerd.
**Probleem:** `DmMessageInfo` gebruikt `dm_channel_id` ipv `channel_id`
en heeft geen `thread_id`/`thread_reply_count`/`poll`/`webhook_*`
fields. Daardoor matcht `MessageSchema` niet en moeten DM-endpoints
ofwel:
- Schema-validatie skippen (huidige situatie), of
- Een eigen `DmMessageSchema` introduceren met `.transform()` om
  `dm_channel_id` te aliasen.
**Workaround (FE):** DM endpoints draaien nu zonder schema-validatie
(zie comment boven `getDmMessages` in `api/client.ts`).
**Backend fix (toekomst):** maak `DmMessageInfo` shape-compatible met
`MessageInfo` door een `channel_id` alias toe te voegen (en weglaten
van DM-specifiek `dm_channel_id`), of geef expliciet aan dat de
endpoints een eigen DTO hebben en behoud beide schemas. De cleanste
optie is unify naar één `MessageInfo` met optionele server-only
fields.

---

Notatie:
- **R-** = Reaction-gerelateerd
- **C-** = Content-gerelateerd
- **V-** = Vec/array gerelateerd
- **D-** = DM-specifiek
