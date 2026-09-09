# Jolkr — Zero-budget marketing- & promotieplan

> Onderzoek uitgevoerd 2026-07-04/05 via twee deep-research rondes (211 research-agents totaal;
> 46 bronnen; ~230 geëxtraheerde claims waarvan 50 adversarieel geverifieerd met 3 onafhankelijke
> stemmen per claim, 2/3 refutes = verworpen). Alle platformregels live geverifieerd tegen
> primaire bronnen. Verworpen claims staan onderaan — die circuleren online maar kloppen niet.

## TL;DR — de strategie in één alinea

Voor een solo dev met €0 budget is de bewezen route: **regelconforme launches + merit-gated
directories + duurzame aanwezigheid in privacy/FOSS-communities** — géén growth-hacks. Concreet:
Show HN met een instant guest-mode (geen signup-muur), AlternativeTo (account nú registreren,
week wachttijd), Privacy Guides self-submission (vereist security-whitepaper + threat model),
en — alléén als je client/server open-sourcet — F-Droid en awesome-selfhosted. Product Hunt is
sterk in waarde gedaald (~10% van launches wordt nog featured) en is hooguit een secundair kanaal.
Het Signal-precedent zet de verwachting: jaren langzame organische groei met event-gedreven pieken
(7,5M downloads in 5 dagen na de WhatsApp-privacyrel van jan 2021). De taak is dus **nu zichtbaar
en geloofwaardig zijn in het privacy-ecosysteem, zodat de volgende privacy-rel installs oplevert**.

---

## 1. Launch-platforms (geverifieerd, hoge confidence)

### 1a. Hacker News — Show HN ⭐ hoogste prioriteit
**Regels (primaire bron, live geverifieerd):**
- Show HN is voor "something you've made that other people can play with" — landing pages,
  blogposts en signup-muren zijn expliciet off-topic.
- HN's officiële advies: verwijder signup/e-mail-barrières — **Jolkr heeft een instant
  guest/demo-mode nodig op launchdag** (web-app direct bruikbaar zonder account).
- **Nooit vrienden vragen om te upvoten of reageren** — HN bant/penaliseert vote-rings expliciet
  ("We penalize or ban submissions, accounts, and sites that break this rule").

**Stappen:**
1. Bouw een guest-mode of publieke demo-server in de web-app (grootste technische prerequisite).
2. Titel: `Show HN: Jolkr – E2EE Discord alternative with post-quantum crypto (Rust/Tauri)`.
   De techniek (Rust, Axum, Tauri, ML-KEM-768, self-hosted SFU) ís de HN-hook.
3. Post zelf, als maker, met een first-person toelichting in de comments: architectuur,
   waarom post-quantum, trade-offs. Blijf de hele dag reageren.
4. Faalt de post? HN heeft geen regel tegen opnieuw proberen na wezenlijke updates.

**Bronnen:** news.ycombinator.com/showhn.html · newsguidelines.html · newsfaq.html

### 1b. AlternativeTo ⭐ laagste effort, doe dit nu
- Gratis, self-service listing; positioneer Jolkr direct als Discord-alternatief.
- **Nieuwe accounts moeten 1 week wachten** voor ze een app-pagina mogen aanmaken →
  **registreer het account vandaag**, submit over een week.
- Likes zijn "one of the most important parameters" in de ranking. Vraag échte gebruikers
  eerlijk om een like. **Nooit incentiveren** (kortingen/gifts) en geen fake accounts — het
  algoritme demoteert of verwijdert de listing dan ("drop it in the ranks or remove it from
  the front page entirely").

**Bron:** alternativeto.net/faq (live geverifieerd 2026-07-04)

### 1c. Product Hunt — secundair, lage verwachting
- Sinds de omslag naar handmatige redactionele curatie (jan 2024) wordt nog **~10% van de
  launches featured**; de rest belandt in de low-traffic "All"-feed.
- Verwachtingen over "5.000-10.000 bezoekers bij #1 Product of the Day" en "self-hunt zonder
  nadeel" zijn **verworpen** in verificatie — er bestaan geen betrouwbare cijfers.
- Advies: wél doen (gratis, 1 dag werk, permanente backlink), maar niet als centerpiece.
  Launch op een rustige dag (weekend), volledige gallery + demo-video.

---

## 2. Directories & privacy-gidsen (geverifieerd, hoge confidence)

### 2a. Privacy Guides — hoogste geloofwaardigheidswinst
Formeel self-submission-proces, kan niet gekocht worden (geen affiliate links, geen
donor-voorkeur; team weigerde publiek betaalde partnerships, mei 2025). Vereisten voor
messengers (primaire bron, live geverifieerd):
- **Security-whitepaper is verplicht** voor apps die gevoelige data verwerken zoals messengers.
- **Expliciet threat model**: wat beschermt Jolkr wél en wat níét.
- Affiliatie disclosen (jij bent de developer).
- Submission overleeft publieke community-review op discuss.privacyguides.net.

→ **Concreet deliverable: schrijf het Jolkr security-whitepaper** (E2EE-stack: Ed25519 +
X25519 + ML-KEM-768, key-distributie, wat de server ziet, threat model). Dit document is
ook herbruikbaar voor HN, Reddit, pers en de landing page. Het bestaande
`security-audit.md`-werk is een startpunt.

### 2b. F-Droid — alléén bij open-source
Harde eis (primaire bron): volledige FLOSS-licentie, geverifieerd door build-from-source.
Google Play Services / Firebase / Crashlytics / proprietary SDK's zijn "strictly forbidden"
(FCM-push moet eruit in een aparte build-flavor, bijv. UnifiedPush als alternatief).
Submissie is gratis en developer-driven: fork `fdroiddata` op GitLab →
`metadata/io.jolkr.app.yml` → merge request, met Fastlane-metadata (short description
< 80 chars, screenshots, changelogs).

### 2c. awesome-selfhosted — alléén bij open-source server
- Server moet FOSS-licensed en écht self-hostable zijn (proprietary → aparte non-free-pagina).
- **Eerste tagged release moet > 4 maanden oud zijn** — plan de submissie dus 4+ maanden na
  de eerste publieke open-source-release.
- Submissie: één YAML-file (`software/jolkr.yml`) als PR naar `awesome-selfhosted-data`,
  < 1 uur werk via de GitHub web-editor. Beschrijving zonder redundante termen als
  "open-source"/"free"/"self-hosted". Werkende install-docs verplicht.

### ⚠️ De strategische beslissing die ~de helft van het plan gate't
**F-Droid, awesome-selfhosted en de facto ook Privacy Guides-geloofwaardigheid vereisen
open-sourcen van client en/of server.** Signal, Element en Revolt zijn allemaal open-source —
in het privacy-segment is closed-source een structurele handicap. Dit is een productbeslissing,
geen marketingtaak. Opties: alles open-sourcen, client-only open-sourcen (deblokkeert F-Droid +
versterkt Privacy Guides-case), of closed blijven en deze kanalen afschrijven.

---

## 3. Realistische groeiverwachting (Signal-precedent, geverifieerd)

- Brian Acton over Signal: **"It was a slow burn for three years and then a huge explosion."**
- De explosie (7,5M+ downloads in 5 dagen, jan 2021; 50,6M die maand, +5.001% YoY) kwam door
  een externe trigger: WhatsApp's datadeel-beleid + Musk's "Use Signal"-tweet. In februari
  zakte het alweer 86% MoM. Herhaald in maart 2025 ("Signalgate": downloads verdubbeld).
- **Les voor Jolkr:** groei komt in event-gedreven pieken, niet als curve. Je kunt de piek
  niet plannen — wel zorgen dat Jolkr op dat moment vindbaar en geloofwaardig is (directories,
  community-reputatie, SEO op "Discord alternative"). Kanttekening: Signal had ~$50M funding;
  het kalibreert de *vorm* van de curve, niet de magnitude.

---

## 4. Wat je NIET moet doen (geverifieerd met case study)

- **Astroturfing / verkapte "ik ontdekte deze app"-posts.** Cautionary tale (nov 2025,
  multi-outlet nieuws): agency Trap Plan draaide ~100 "organic-style" Reddit-posts voor
  War Robots: Frontiers ("Most players didn't even realize they were part of a marketing
  effort") — Reddit vond hun eigen opschepperige case study, het werd een publieke rel in
  PC Gamer/Kotaku/Notebookcheck. Post altijd transparant als developer.
- **Vote-rings op HN** — expliciet verboden, accounts en site worden gepenaliseerd.
- **Geïncentiveerde likes/reviews op AlternativeTo** — algoritme demoteert/verwijdert.
- **Fake reviews op Google Play** — Play-policy-schending, risico op app-verwijdering.

---

## 5. Community-groei zonder bans (geverifieerd)

### 5a. Lemmy c/selfhosted (lemmy.world) — regels live geverifieerd
Grootste selfhosted-community op Lemmy: ~60,4K subscribers, ~473 actieve users/dag.
De regels zijn in juni 2026 twee keer aangescherpt (mod-post 22 juni + formalisering als Rule 7
op 28 juni; herlees ze vlak vóór je post). Live geverifieerd 2026-07-05, 3-0:
- Promotie vereist **actieve participatie** in selfhosting/gerelateerde communities, anders removal.
- **Max 10% van je posts/comments mag self-promo zijn.**
- **Account moet minimaal 30 dagen oud zijn** voor promotieposts — hierop bestaat géén
  uitzondering. → Maak je Lemmy-account nu aan en participeer, ruim vóór een launch-post.
- **FOSS-exemption**: is je project volledig open source én volledig gratis self-hostable, dan ben
  je vrijgesteld van de 10%-cap (níét van de 30-dagen-eis) — zolang je in de comments blijft
  reageren. Donaties zijn oké; betaalde features achter een abonnement diskwalificeren
  (moderator noemt Kavita als voorbeeld).
- Spam-definitie (altijd removal): dezelfde announcement snel over meerdere communities posten,
  karma-farming, bot/AI-posts, ongevraagde massa-DM's.
- Scope: alléén self-hostable alternatieven zijn on-topic — dit kanaal vereist dus dat Jolkr
  publiek self-hostable is (technisch is de stack het al; het vereist de open-source-release).

### 5b. Privacy Guides forum (discuss.privacyguides.net)
- Eigen projecten promoten mag **alleen in de "Project Showcase"-categorie**.
- Verwacht wordt dat je **eerst teamleden contacteert om jezelf als project-representative te
  verifiëren** vóór je post (forum-guidance, april 2026).
- "I built X"-posts van developers zijn daar expliciet welkom; een showcase-post is géén
  Privacy Guides-endorsement (dat is alleen de recommendations-pagina, zie §2a).

### 5c. Reddit
- Reddits "Responsible Builder Policy" (juni 2026) gaat over API/bots/apps — automated
  cross-posting van (vrijwel) identieke content over subreddits is verboden spam, net als
  vote/karma-manipulatie en multi-accounts. **Handmatige, per-community toegesneden posts
  vallen onder de regels van elke subreddit afzonderlijk.**
- Let op: r/selfhosted-regels staan NIET op wiki.r-selfhosted.com (geverifieerd: geen
  rules-pagina, /rules = 404) — check de sidebar/rules op reddit.com/r/selfhosted zelf vlak
  voor je post. Idem voor r/privacy, r/degoogle, r/opensource, r/rust, r/SideProject.
- Officiële r/selfhosted-zijkanalen om reputatie op te bouwen: hun Discord-server, Matrix
  (#r-selfhosted:matrix.org) en Mastodon (selfhosted.cafe).
- **Realistische verwachting**: Plausible haalde in 4 maanden slechts ~2,2K bezoekers uit
  privacy/OSS-subreddits tegenover 43,6K uit Hacker News. Reddit is voor reputatie, feedback
  en langzame naamsbekendheid — niet voor traffic-pieken.

### 5d. De Discord-les (2015, Citron op 20VC-podcast nov 2024 + de gearchiveerde r/ffxiv-thread)
Discord stond na maanden op **20 DAU** ("We had 20 DAU that weren't us") — het product alleen
groeide niet. De doorbraak: een post van een vriend op r/ffxiv (13 mei 2015, "Just switched to
a program called Discord for our VOIP, has anyone else tried it?" — 151 comments) met een
klikbare link die mensen **direct in een live server** zette; ~50-600 signups in de eerste
dagen, playbook ~6 maanden herhaald per community. Citron benoemt de **feedback-framing** als
de unlock: "inviting people to give feedback on the app, as opposed to saying try this thing
we're selling". Kanttekening: de post kwam van een vriend en was als ontdekking geframed —
vandaag heet dat astroturfing en wordt het publiekelijk afgestraft (zie §4). De kopieerbare,
transparante variant: post zélf als developer met een **échte feedback-vraag** ("I built X,
what am I missing?"), en kopieer de mechanic — **de link moet direct in een werkende server
landen, zonder drempel**.

---

## 6. ASO (Google Play) & SEO (jolkr.app)

### 6a. ASO — geverifieerd (deels tegen Googles eigen Play Console-docs)
- Google Play indexeert keywords uit **drie zichtbare velden**: titel (30 chars), short
  description (80), long description (4.000). Geen verborgen keyword-veld zoals bij Apple.
  **De titel weegt het zwaarst** (vendor-consensus AppTweak/Phiture/AppFollow/MobileAction;
  Google publiceert geen gewichten) → formaat "Jolkr — encrypted group chat".
- Long description: primaire keywords **3-5× natuurlijk** herhalen. Let op: keyword-stuffing
  is volgens Googles eigen metadata-policy een **verwijderbare policy-overtreding**, niet
  alleen een ranking-nadeel (3-0 geverifieerd tegen support.google.com).
- Ranking voor competitieve termen is **gegate't door gedrag ná install** (3-0, mede op
  Googles primaire docs: "Apps that have strong technical performance and a good user
  experience are generally favored"; slechte Android-vitals maken je expliciet "less
  discoverable"). Een onbekende app rankt dus niet op metadata alleen voor head terms als
  "Discord alternative" — **begin long-tail** ("encrypted group chat" e.d.) en behandel
  retentie + crash-free rate als ASO-input.
- Ratings zijn een harde poort: **onder 3 sterren val je uit de Explore-sectie**. Recente
  reviews wegen zwaarder dan een oud hoog gemiddelde → goed getimede in-app review-prompts
  vroeg inbouwen.
- Feedback-loop is traag: ~2 weken per metadata-iteratie, 3-4 weken voor keyword-effect,
  en bij lage traffic nóg langer. Plan ASO als **maandcyclus met één hypothese per iteratie**,
  niet als launch-week-taak.

### 6b. SEO — de AI-Overview-realiteit (Ahrefs-studie feb 2026, primair, 3-0 geverifieerd)
- Staat er een Google AI Overview boven de resultaten, dan kost dat de #1-positie **-58% CTR**
  (posities 2-10: -50,8% tot -19,4%). Onafhankelijk bevestigd door Pew (juli 2025: 8% klikrate
  mét AI-samenvatting vs 15% zonder). Zelfs zónder AI Overview is de #1-CTR gehalveerd
  (0,076 → 0,039 tussen dec 2023 en dec 2025). ~60% van alle searches eindigt zonder klik.
  → Alle pre-2024 SEO-verwachtingen halveren; informational listicles zijn structureel minder
  waard. Behandel comparison pages als **conversie/geloofwaardigheids-assets en vangnet voor
  branded queries ("Jolkr vs Discord")**, niet als primair traffic-kanaal in jaar één.
- **Comparison pages werken nog steeds** (Intergrowth-survey nov 2025: ~85% van 52 marketeers
  zag gelijke of betere performance in 2024): "X vs Y"-zoekers zitten in de beslissingsfase,
  een pagina hoeft maar ~1.000 woorden te zijn (Ahrefs' eigen page: top-3 voor 46 keywords),
  en hoge domain authority is geen vereiste (NapLab rankt met DR 48).
- Kanttekeningen: onafhankelijke vergelijkingen ranken beter dan vendor-eigen "wij vs zij";
  programmatic/AI-gegenereerde vergelijkingspagina's worden gedevalueerd (G2/Capterra-verval);
  gebruik de volgorde die mensen typen (incumbent eerst: "Discord alternative", niet "Jolkr vs...").
- **Plausible-precedent** (pre-AI-era, dus halveer de cijfers): 1 blogpost/week gedurende
  4 maanden → Google-clicks van ~400 naar 6.000+; organic search was hun laagste-volume maar
  **hoogste-intent** kanaal (nr. 1 bron van trials, 3+ min sessieduur).
- Positioneringsles van Plausible: homepage-herformulering naar expliciet
  **"privacy-friendly alternative to Google Analytics"** was een gecrediteerde groei-hefboom
  → jolkr.app-tagline: "privacy-first alternative to Discord" prominent voeren.

## 7. Content marketing & gratis pers/outreach

### 7a. Het bewezen model: Plausible Analytics (privacy-tool, solo→klein team, $0 ad-budget)
Gedocumenteerd, gedateerd én onafhankelijk gecorroboreerd (HN Algolia API); het meest
overdraagbare precedent voor Jolkr:
- **$415 → $2.750 MRR in 135 dagen** met uitsluitend gratis kanalen; later $1M ARR (juni 2022)
  zonder ooit te adverteren ("Our growth comes organically from word of mouth"). Ze weigerden
  zelfs affiliate/referral-programma's.
- **Hacker News was hun grootste kanaal (43,6K bezoekers, ~4× het volgende kanaal)** — door hun
  éigen blogposts zelf in te sturen. Eén opiniepost ("Why you should stop using Google
  Analytics on your website", april 2020) → #1 op HN (462 punten, onafhankelijk geverifieerd)
  → 25.000+ bezoekers op één dag. **Let op de vorm: power-law** — vrijwel alle traffic zat in
  1-2 virale posts, niet gelijkmatig verdeeld. De werkende framing: een onderbouwd standpunt
  tegen de incumbent (toen Google Analytics; voor Jolkr: Discords privacy-model).
- **Origineel onderzoek converteert het best**: hun adblocker-study (aug 2021) → 30.000 lezers
  in 24 uur → trials +100% in de vijf dagen erna.
- **Cold outreach werkt**: één cold-gepitcht gastartikel op Opensource.com (1 mei 2020) → 94
  trials op 2 mei, hun beste dag ooit (geverifieerd: géén HN-activiteit in dat venster, dus
  zuivere attributie). Kanttekening: Opensource.com is sinds 2023 gearchiveerd — pitch in 2026
  naar It's FOSS, dev.to en privacy-newsletters. Een viral groeiverhaal leverde een
  Changelog-podcast-uitnodiging op.
- Ter contrast: hun Product Hunt-launch → ~1.000 bezoekers, 15 trials, na een paar dagen <20
  bezoekers/dag. Build-in-public (blog + Indie Hackers + Twitter, "All the early users came
  from these updates"): gestaag maar bescheiden (~10K bezoekers over maanden) — werkte in
  combinatie met virale HN-content, niet standalone.

**Vertaling naar Jolkr** — jouw technische verhaal ís de content: post-quantum E2EE (ML-KEM-768)
in een productie-chat-app, een Rust SFU bouwen, één Tauri-codebase voor 4 platforms, self-hosted
infra. Dat zijn precies de deep-dives die HN-frontpage halen. Cadans: 1 post per 1-2 weken op
een blog onder jolkr.app (zelfde domein = SEO-winst), zelf naar HN insturen.

### 7b. HN-mechanica voor herkansingen (primaire bronnen)
- Show HN-posts staan in **twee** sandboxes (/shownew + /newest) — meer upvote-kansen.
- Een nieuwe submission krijgt ~30 views in /newest en heeft ~5 punten nodig om te ontsnappen;
  de mediaan is 0-1 upvotes — **een flop is de norm, geen oordeel**. Submitter-karma geeft geen boost.
- Link-post > text-post (text-only krijgt een geschatte 0,4-0,7 ranking-penalty).
- **Second-chance pool (3-0 geverifieerd, bestaat sinds 2014, aantoonbaar actief per
  22 juni 2026)**: moderators herplaatsen overziene posts op de frontpage — soms 9 van de 30
  slots. **Mail hn@ycombinator.com** om je eigen genegeerde post te nomineren; moderators
  nodigen dat expliciet uit ("It's fine if it's your own article"). Geen garantie, wel gratis.
- Reposten mag officieel als een post geen significante aandacht kreeg (kan de kans op de
  frontpage verdrievoudigen). Delete-en-repost is daarentegen ban-waardig.

### 7c. Gratis pers
Volg het OpenSource.com-model: pitch gastartikelen/tips naar FOSS- en privacy-media
(It's FOSS, OpenSource.com-achtigen, privacy-newsletters) met een concreet technisch verhaal,
niet een productpitch. YouTube-privacykanalen (Techlore e.d.): geen geverifieerde data over
pitch-acceptatie — behandel als experiment, niet als pijler (zie open vragen).

## 8. Virale invite-loops (het product ís het kanaal)

Geverifieerde mechanics van de twee relevante voorbeelden:
- **Discord**: invite-link → username invullen → **binnen seconden in een live voice/text chat,
  zonder volledige account-setup, direct in de browser** ("Discord could run in a browser, so
  on-boarding was extremely easy"). Winst via "supernodes": als de groepsleider verhuist, volgt
  de hele groep. Founders draaiden zelf een support-server voor nieuwe users.
- **Telegram**: publieke groepen hebben een t.me-vanity-link waarvan **de volledige history
  leesbaar is vóór je joint** (view-before-commit — al gebeurt dat binnen de Telegram-client,
  dus mét account; de anonieme browser-preview is beperkt); private invite-links zijn one-tap
  met instant revoke; usernames zijn tegelijk deeplink én discovery (global search).
  **Beide flows zijn pas frictieloos ná app-install — nooit account-vrij. Een web-first app
  als Jolkr kan die baseline dus verslaan** met links die account-vrij in de browser openen.

**Concreet voor Jolkr** (grotendeels bestaande features, kleine FE/BE-uitbreidingen):
1. **Guest-join op invite-links**: link opent de web-app, alleen een username nodig, direct in
   het kanaal. Dit is dezelfde feature die Show HN vereist (§1a) — één investering, drie
   kanalen (HN-demo, invite-loop, Reddit/Lemmy "kom kijken"-links).
2. **Publieke servers met read-only preview** vóór join (Telegram-model).
3. **Vanity server-URLs** (jolkr.app/s/naam) — deelbaar buiten de app.
4. **Eigen "Jolkr HQ"-server** als support + community, door jou bemand (Discord-model; kost
   alleen tijd).
Kanttekening: de loop start niet vanzelf — Discord stond op 20 DAU tot de seeding begon.
Loop + seeding (§5) horen bij elkaar.

## 9. Actieplan & volgorde

**Fase 0 — deze week (uren werk)**
1. AlternativeTo-account registreren (1 week verplichte wachttijd) → daarna listing als
   Discord-alternatief.
2. Google Play listing ASO-pass: titel "Jolkr: [primair keyword]", short description met
   keyword, long description met 3-5× natuurlijke herhaling. In-app review-prompt plannen.
3. Landing-tagline aanscherpen naar "privacy-first alternative to Discord"-framing.

**Fase 1 — weken 1-4 (de fundering)**
4. **Guest-mode / instant-join bouwen** — deblokkeert Show HN, de invite-loop én community-links.
5. **Security-whitepaper schrijven** (E2EE-stack, threat model, wat de server ziet) —
   vereist voor Privacy Guides, herbruikbaar overal. Startpunt: bestaand security-audit-werk.
6. Blog opzetten op jolkr.app + eerste technische deep-dive (bijv. post-quantum E2EE in productie).
7. Build-in-public accounts starten (Mastodon/fosstodon, Bluesky, X) — bescheiden verwachting,
   wel gestage referrals + geloofwaardigheid.
8. Reputatie beginnen opbouwen in r/selfhosted (+ hun Discord/Matrix), r/privacy, Lemmy
   c/selfhosted — als deelnemer, nog niet als promotor (10%-regel). **Lemmy-account meteen
   aanmaken**: de 30-dagen-eis loopt vanaf registratie.

**Fase 2 — maand 2-3 (launches)**
9. **Show HN** (guest-mode klaar): link-post, zelf gepost, hele dag comments beantwoorden.
   Flopt hij → hn@ycombinator.com voor de second-chance pool; later 1× reposten mag.
10. Privacy Guides forum "Project Showcase"-post (na verificatie bij het team).
11. Product Hunt op een rustige dag — lage verwachting, gratis backlink.
12. Cold outreach naar 5-10 FOSS/privacy-media met een technisch verhaal (OpenSource.com-model).
13. Blogcadans vasthouden (1 post per 1-2 weken), elke post zelf naar HN.

**Fase 3 — maand 3+ (de open-source-route, indien besloten)**
14. Open-source-beslissing nemen (§2 — gate't F-Droid, awesome-selfhosted, Lemmy-exemption,
    en de facto Privacy Guides).
15. F-Droid: build-flavor zonder FCM/GMS → fdroiddata merge request.
16. awesome-selfhosted: YAML-PR, ten vroegste 4 maanden na de eerste publieke tagged release.
17. Lemmy c/selfhosted launch-post onder de FOSS-exemption; r/selfhosted-post na
    reputatie-opbouw (sidebar-regels vooraf checken).
18. 2-3 comparison pages op jolkr.app ("Discord alternative"-framing, handgemaakt, eerlijk
    over trade-offs, ~1.000 woorden per stuk).
19. Privacy Guides self-submission met whitepaper (verwacht de audit-vraag: "uitgevoerd of
    aangevraagd?").

**Doorlopend**
- Community-participatie > promotie (10%-verhouding aanhouden).
- Altijd transparant als developer posten; nooit vote-solicitation, incentivized likes,
  fake reviews of "ontdekkings"-posts.
- Doel van dit alles: **gepositioneerd staan (directories, reputatie, SEO) vóór het volgende
  privacy-schandaal** — dat is historisch het moment waarop privacy-apps hun groeispurt maken (§3).

## Open vragen (niet geverifieerd — handmatig checken)
- Actuele sidebar-regels van r/selfhosted, r/privacy, r/degoogle, r/opensource, r/rust,
  r/SideProject, r/androidapps — Reddit blokkeert niet-ingelogde toegang, dus check
  reddit.com/r/<sub>/about/rules **ingelogd, vlak vóór een post** (bestaat er een
  showcase-draad? welke flair?). Verlaat je niet op wiki's of samenvattingen van derden.
- Pitch-acceptatie van YouTube-privacykanalen (Techlore — die heeft een
  tool-suggestie-forumdraad, The Hated One, Mental Outlaw) en privacy-newsletters — geen
  betrouwbare data gevonden; gewoon proberen, kost alleen een e-mail.
- Zoekvolume/moeilijkheid van "Discord alternative"-keywords — vereist een keyword-tool
  (gratis tiers van Ahrefs/Semrush volstaan voor een eerste blik).
- Waitlist/invite-schaarste (Clubhouse-model): geen geverifieerde zero-budget succescase
  gevonden voor chat-apps; het geverifieerde bewijs (Discord-seeding, Telegram open links)
  wijst juist naar **minimum-frictie open invites**.
- **De gate-vraag die alleen jij kunt beantwoorden**: wordt Jolkr (deels) open source?
  Dit bepaalt F-Droid, awesome-selfhosted, de Lemmy-exemption én de kracht van de
  Privacy Guides-case (§2).

---

## Appendix A — Verworpen claims (niet op vertrouwen)

| Claim (circuleert online) | Verdict |
|---|---|
| "#1 Product of the Day levert 5.000-10.000 bezoekers op met 1-3% conversie" | 0-3 verworpen — geen betrouwbare data |
| "Hunter met veel followers maakt niet meer uit; 60% van succesvolle launches is self-hunted" | 1-2 verworpen |
| "Non-featured PH-producten verliezen ~70% zichtbaarheid" (specifiek cijfer) | 0-3 verworpen — het ~10%-featured-cijfer zelf is wél bevestigd (3-0) |
| "Lemmy c/selfhosted heeft de 10%-cap-wording láten vallen" | 0-3 verworpen — de 10%-cap staat er nog steeds; de 30-dagen-account-eis kwam er op 28 juni 2026 bovenop (beide gelden dus) |

## Appendix B — Belangrijkste primaire bronnen

- news.ycombinator.com/showhn.html + newsguidelines.html + newsfaq.html
- privacyguides.org/en/about/criteria + discuss.privacyguides.net (topic 27596)
- f-droid.org/en/docs/Inclusion_Policy + Inclusion_How-To + gitlab.com/fdroid/fdroiddata
- alternativeto.net/faq
- github.com/awesome-selfhosted/awesome-selfhosted (+ awesome-selfhosted-data CONTRIBUTING.md)
- techcrunch.com (Acton-interview 2021-01-12) + Sensor Tower + Appfigures (Signal-data)
- pcgamer.com / Kotaku / Notebookcheck (Trap Plan astroturfing-schandaal, nov 2025)
- lemmy.world/post/48504688 (c/selfhosted Rule 2-clarificatie, 22 juni 2026)
- discuss.privacyguides.net topic 36766 (developer-posting-richtlijnen)
- support.reddithelp.com — Responsible Builder Policy
- ahrefs.com/blog/ai-overviews-reduce-clicks-update (feb 2026, 300K-keyword-studie)
- news.ycombinator.com/item?id=26998308 (dang over de second-chance pool)
- telegram.org/faq (invite-link/vanity-mechanics)
- startuparchive.org (Citron over Discords eerste groei) + producthabits.com-achtige casestudies
- plausible.io/blog (open startup-groeirapporten 2020-2022)
