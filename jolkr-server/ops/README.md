# Ops-scripts (web-unit)

Systeemscripts die op **web-unit** (`192.168.178.20`) draaien en de Jolkr-stack
overeind houden. Ze staan hier in de repo omdat scripts die alleen op een server
leven onzichtbaar wegdrijven — precies wat er met `jolkr-upload.tpl/.stpl`
gebeurde (uit de repo verwijderd op 2026-05-10, waarna een IP-migratie een vhost
stilzwijgend achterliet).

Uitrollen: `bash install.sh` vanaf de dev-machine.

---

## `jolkr-watchdog.sh` — merkt een outage op

Elke 5 minuten een controle op de publieke keten:

| Controle | Waarom |
|---|---|
| `https://jolkr.app/health` → 200 én `"status":"healthy"` én elk subsysteem `up` | Bewijst Cloudflare → web-unit → render-unit → API → postgres/redis/minio/nats |
| `https://jolkr.app/app/` → 200 | Frontend wordt geserveerd |
| `https://upload.jolkr.app/` reageert (404 is hier correct) | Upload-vhost leeft |

Mailt bij twee mislukte cycli op rij (~10 minuten), mailt opnieuw bij herstel, en
herinnert eens per 24 uur zolang de storing duurt. Alarmeert dus op de *overgang*,
niet elke cyclus.

**Aanleiding:** op 2026-09-08 lag de stack ~20 uur plat zonder signaal —
NetworkManager had alle Docker-veth's op render-unit van hun bridges gedetacht.
Het kwam pas boven water doordat de gebruiker het zelf merkte.

Config: `/etc/jolkr-watchdog.conf` (`ALERT_EMAIL`, `FAIL_THRESHOLD`, `REMIND_AFTER`).
Log: `/var/log/jolkr-watchdog.log`.

## `jolkr-heal-error-pages.sh` — herstelt de error-pages

`v-rebuild-web-domain` leegt `document_errors/` en zet Hestia's standaardpagina's
terug, waardoor de Jolkr-pagina's stil verdwijnen. De nginx-bedrading zit in de
templates en overleeft de rebuild wél — alleen de HTML moet terug.

Draait elke 15 minuten, herstelt uit `/root/jolkr-error-pages/<domein>/` zodra
`document_errors/404.html` de Jolkr-marker mist, en herlaadt daarna nginx
(`open_file_cache_valid` staat op 60s).

**Dit is niet theoretisch:** op 2026-09-06 06:05 wiste een rebuild de pagina's van
`upload.jolkr.app`; dat werd pas op 2026-09-09 opgemerkt. Sindsdien gaat het
vanzelf. De handmatige stap ("draai `deploy-error-pages.ps1` na elke rebuild")
is daarmee vervallen.

Log: `/var/log/jolkr-error-pages.log`.

---

## Waar draait dit, en waarom daar

Allebei op **web-unit**, niet op render-unit. Bij een render-unit-outage moet de
waarnemer juist overeind blijven — een monitor die met de storing meevalt, meldt niets.

Uptime Kuma draait om dezelfde reden op web-unit (`/opt/uptime-kuma/`,
bereikbaar op `http://192.168.178.20:3001`, bewust aan het LAN-adres gebonden en
niet publiek).

## status.jolkr.app

De watchdog schrijft bij elke run `offline.html` naar de docroot van
`status.jolkr.app`. Zolang de backend antwoordt proxyt dat domein de live
`/health`-pagina door; valt de backend weg, dan serveert nginx die momentopname
met de oorspronkelijke 5xx-status.

Het subdomein staat **grey-clouded** in Cloudflare (DNS-only). Proxied vervangt
Cloudflare de 5xx-body van de origin door zijn eigen `error code: 502` van 16
bytes, waardoor de terugvalpagina niemand bereikt — geverifieerd op 2026-09-09.
Zet het terug op oranje en deze pagina stopt stilzwijgend met werken in precies
de situatie waarvoor hij bestaat.

Gevolg van grey cloud: het origin-IP (`212.45.36.41`) is voor dit subdomein
publiek zichtbaar, net als bij `upload.jolkr.app`. Er is ook geen
Cloudflare-bescherming meer op dit ene domein. De watchdog dekt het CF-pad nog
steeds af via zijn controle op `https://jolkr.app/app/`.
