#!/bin/bash
# Jolkr watchdog — mailt zodra de publieke stack onbereikbaar wordt.
#
# Aanleiding: op 2026-09-08 lag de hele stack ~20 uur plat (NetworkManager
# detachte alle Docker-veth's op render-unit) zonder dat iets een signaal gaf.
# Het kwam pas boven water doordat de gebruiker het zelf merkte.
#
# Draait bewust op web-unit en niet op render-unit: bij een render-unit-outage
# moet de waarnemer juist overeind blijven.
#
# Geïnstalleerd als /usr/local/sbin/jolkr-watchdog.sh, aangestuurd door
# jolkr-watchdog.timer (elke 5 minuten). Config: /etc/jolkr-watchdog.conf

set -uo pipefail

CONF=/etc/jolkr-watchdog.conf

# De omgeving wint van het configbestand, zodat de faalroute te testen is
# (dood endpoint, mail naar root) zonder de productieconfig aan te raken.
# Zonder dit overschrijft `source` juist wat de aanroeper meegaf.
_tunables=(ALERT_EMAIL MAIL_FROM FAIL_THRESHOLD REMIND_AFTER STATE LOG TIMEOUT
           HEALTH_URL APP_URL UPLOAD_URL)
declare -A _from_env=()
for _v in "${_tunables[@]}"; do
    [[ -v $_v ]] && _from_env[$_v]=${!_v}
done
# shellcheck source=/dev/null
[[ -r $CONF ]] && source "$CONF"
for _v in "${!_from_env[@]}"; do
    printf -v "$_v" '%s' "${_from_env[$_v]}"
done

: "${ALERT_EMAIL:=root}"
# De envelope-afzender moet op een domein liggen met geldige SPF voor 212.45.36.41.
# Zonder dit vertrekt post als root@mail.phillippepelzer.me — dat subdomein heeft
# GEEN eigen SPF-record en Gmail weigert het dan met 550-5.7.26 (geverifieerd
# 2026-09-09). Zowel jolkr.app als phillippepelzer.me passeren wel.
: "${MAIL_FROM:=watchdog@jolkr.app}"
: "${FAIL_THRESHOLD:=2}"          # aantal opeenvolgende mislukkingen vóór alarm
: "${REMIND_AFTER:=288}"          # herinnering na N cycli storing (288 × 5min = 24u)
: "${STATE:=/var/lib/jolkr-watchdog}"
: "${LOG:=/var/log/jolkr-watchdog.log}"
: "${TIMEOUT:=20}"
# Overschrijfbaar zodat de faalroute getest kan worden zonder productie te raken.
: "${HEALTH_URL:=https://jolkr.app/health}"
: "${APP_URL:=https://jolkr.app/app/}"
: "${UPLOAD_URL:=https://upload.jolkr.app/}"

mkdir -p "$STATE"
FAILFILE=$STATE/consecutive_failures
ALERTED=$STATE/alerted

log() { printf '%s %s\n' "$(date -Is)" "$*" >>"$LOG"; }

problems=()

# 1. API-health: bewijst de hele keten tot en met postgres/redis/minio/nats.
body=$(curl -sS --max-time "$TIMEOUT" -w '\n%{http_code}' "$HEALTH_URL" 2>&1)
code=$(printf '%s' "$body" | tail -n1)
json=$(printf '%s' "$body" | sed '$d')
if [[ $code != 200 ]]; then
    problems+=("API /health gaf HTTP ${code:-geen antwoord}")
elif ! printf '%s' "$json" | grep -q '"status":"healthy"'; then
    problems+=("API /health meldt niet 'healthy': $(printf '%s' "$json" | head -c 200)")
else
    # Een subsysteem kan 'down' zijn terwijl de top-status nog healthy heet.
    for svc in database cache storage events relay; do
        printf '%s' "$json" | grep -qE "\"$svc\":\{\"status\":\"up\"" \
            || problems+=("subsysteem '$svc' is niet 'up'")
    done
fi

# 2. Frontend wordt geserveerd.
code=$(curl -sS --max-time "$TIMEOUT" -o /dev/null -w '%{http_code}' "$APP_URL" 2>&1)
[[ $code == 200 ]] || problems+=("frontend /app/ gaf HTTP ${code:-geen antwoord}")

# 3. Upload-vhost reageert. 404 is hier correct (upload-only vhost); alleen een
#    uitblijvend antwoord of een 5xx is een storing.
code=$(curl -sS --max-time "$TIMEOUT" -o /dev/null -w '%{http_code}' "$UPLOAD_URL" 2>&1)
if [[ -z $code || $code == 000 || $code =~ ^5 ]]; then
    problems+=("upload.jolkr.app gaf HTTP ${code:-geen antwoord}")
fi

fails=$(cat "$FAILFILE" 2>/dev/null || echo 0)

if ((${#problems[@]} == 0)); then
    if [[ -f $ALERTED ]]; then
        log "HERSTELD na $fails mislukte cycli"
        printf 'De Jolkr-stack is weer bereikbaar.\n\nHersteld op: %s\nStoring duurde ongeveer %d minuten.\n' \
            "$(date -Is)" "$((fails * 5))" \
            | mail -r "$MAIL_FROM" -s "Jolkr HERSTELD — stack is weer bereikbaar" "$ALERT_EMAIL"
        rm -f "$ALERTED"
    fi
    echo 0 >"$FAILFILE"
    exit 0
fi

fails=$((fails + 1))
echo "$fails" >"$FAILFILE"
log "STORING (cyclus $fails): ${problems[*]}"

# Alarmeer op de overgang naar 'down', daarna alleen nog als herinnering.
should_alert=0
if ((fails == FAIL_THRESHOLD)); then
    should_alert=1
elif [[ -f $ALERTED ]] && ((fails % REMIND_AFTER == 0)); then
    should_alert=1
fi

if ((should_alert == 1)); then
    {
        printf 'De Jolkr-stack reageert niet zoals verwacht.\n\n'
        printf 'Tijdstip: %s\n' "$(date -Is)"
        printf 'Mislukte controles op rij: %d (ongeveer %d minuten)\n\n' "$fails" "$((fails * 5))"
        printf 'Geconstateerd:\n'
        printf '  - %s\n' "${problems[@]}"
        printf '\nEerste plek om te kijken (render-unit):\n'
        printf '  ip -br addr show | grep -E "br-|docker0"    # bridges DOWN? zie 2026-09-08\n'
        printf '  docker ps --format "{{.Names}}: {{.Status}}"\n'
        printf '  docker logs --tail 50 jolkr-api\n'
    } | mail -r "$MAIL_FROM" -s "Jolkr STORING — stack onbereikbaar" "$ALERT_EMAIL"
    touch "$ALERTED"
    log "alarm gemaild naar $ALERT_EMAIL"
fi
