#!/bin/bash
set -euo pipefail

# ══════════════════════════════════════════════════════════════════════════════
# Jolkr HA Cluster — Failover Test Script
#
# Interactive script to test failover scenarios:
#   a) Stop Postgres primary   (Patroni auto-promotes replica)
#   b) Stop Redis primary      (Sentinel promotes replica)
#   c) Stop API on one node    (keepalived moves VIP)
#   d) Stop entire node        (all services failover)
#
# Usage:
#   ./scripts/failover-test.sh
# ══════════════════════════════════════════════════════════════════════════════

# ── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*"; }
header()  { echo -e "\n${BOLD}${CYAN}═══ $* ═══${NC}\n"; }

# ── Determine cluster root directory ────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLUSTER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
HEALTH_CHECK="$SCRIPT_DIR/health-check.sh"

# ── Load environment ───────────────────────────────────────────────────────
ENV_FILE="$CLUSTER_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
    error ".env file not found at: $ENV_FILE"
    exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

NODE_NAME="${NODE_NAME:-unknown}"
NODE_IP="${NODE_IP:-127.0.0.1}"
REDIS_PASSWORD="${REDIS_PASSWORD:-}"

# ── Compose file ───────────────────────────────────────────────────────────
COMPOSE_FILE="$CLUSTER_DIR/$NODE_NAME/docker-compose.yml"
COMPOSE_CMD="docker compose --env-file $ENV_FILE -f $COMPOSE_FILE"

if [[ "$NODE_NAME" != "node-a" && "$NODE_NAME" != "node-b" ]]; then
    warn "This script is designed to run on node-a or node-b (data nodes)."
    warn "Node C is a witness node — there's limited failover to test here."
fi

# ── Helpers ─────────────────────────────────────────────────────────────────
wait_for_condition() {
    local description="$1"
    local check_cmd="$2"
    local timeout="${3:-60}"
    local interval="${4:-3}"

    info "Waiting for: $description (timeout: ${timeout}s)"
    local elapsed=0

    while [ $elapsed -lt $timeout ]; do
        if eval "$check_cmd" >/dev/null 2>&1; then
            success "$description"
            return 0
        fi
        echo -ne "  ${DIM}Elapsed: ${elapsed}s...${NC}\r"
        sleep "$interval"
        elapsed=$((elapsed + interval))
    done

    error "Timed out waiting for: $description"
    return 1
}

confirm() {
    local msg="$1"
    echo -e "\n${YELLOW}${BOLD}$msg${NC}"
    echo -ne "${YELLOW}Continue? [y/N]: ${NC}"
    read -r answer
    if [[ "$answer" != "y" && "$answer" != "Y" ]]; then
        info "Cancelled."
        return 1
    fi
    return 0
}

# ══════════════════════════════════════════════════════════════════════════════
# Show current cluster state
# ══════════════════════════════════════════════════════════════════════════════
show_cluster_state() {
    header "Current Cluster State"

    echo -e "${BOLD}  Node: ${CYAN}$NODE_NAME${NC} ${BOLD}($NODE_IP)${NC}"
    echo ""

    # -- Patroni / Postgres --
    echo -e "  ${BOLD}PostgreSQL (Patroni):${NC}"
    if PATRONI_JSON=$(curl -sf --connect-timeout 3 http://localhost:8008/health 2>/dev/null) || \
       PATRONI_JSON=$(curl -s --connect-timeout 3 http://localhost:8008/health 2>/dev/null); then
        PATRONI_ROLE=$(echo "$PATRONI_JSON" | grep -o '"role":"[^"]*"' | cut -d'"' -f4 || echo "unknown")
        PATRONI_STATE=$(echo "$PATRONI_JSON" | grep -o '"state":"[^"]*"' | cut -d'"' -f4 || echo "unknown")
        if [ "$PATRONI_ROLE" == "master" ] || [ "$PATRONI_ROLE" == "primary" ]; then
            echo -e "    This node: ${GREEN}${BOLD}PRIMARY${NC} (state: $PATRONI_STATE)"
        else
            echo -e "    This node: ${BLUE}${BOLD}REPLICA${NC} (role: $PATRONI_ROLE, state: $PATRONI_STATE)"
        fi
    else
        echo -e "    This node: ${DIM}Patroni not running or not a data node${NC}"
    fi

    # Check peer Patroni
    PEER_IP=""
    PEER_NAME=""
    if [ "$NODE_NAME" == "node-a" ]; then
        PEER_IP="$NODE_B_IP"
        PEER_NAME="node-b"
    elif [ "$NODE_NAME" == "node-b" ]; then
        PEER_IP="$NODE_A_IP"
        PEER_NAME="node-a"
    fi

    if [ -n "$PEER_IP" ]; then
        if PEER_JSON=$(curl -sf --connect-timeout 3 "http://$PEER_IP:8008/health" 2>/dev/null) || \
           PEER_JSON=$(curl -s --connect-timeout 3 "http://$PEER_IP:8008/health" 2>/dev/null); then
            PEER_ROLE=$(echo "$PEER_JSON" | grep -o '"role":"[^"]*"' | cut -d'"' -f4 || echo "unknown")
            PEER_STATE=$(echo "$PEER_JSON" | grep -o '"state":"[^"]*"' | cut -d'"' -f4 || echo "unknown")
            if [ "$PEER_ROLE" == "master" ] || [ "$PEER_ROLE" == "primary" ]; then
                echo -e "    Peer ($PEER_NAME): ${GREEN}${BOLD}PRIMARY${NC} (state: $PEER_STATE)"
            else
                echo -e "    Peer ($PEER_NAME): ${BLUE}${BOLD}REPLICA${NC} (role: $PEER_ROLE, state: $PEER_STATE)"
            fi
        else
            echo -e "    Peer ($PEER_NAME): ${RED}unreachable${NC}"
        fi
    fi

    # -- Redis --
    echo ""
    echo -e "  ${BOLD}Redis:${NC}"
    REDIS_AUTH=""
    if [ -n "$REDIS_PASSWORD" ]; then
        REDIS_AUTH="-a $REDIS_PASSWORD --no-auth-warning"
    fi

    SENTINEL_CONTAINER="jolkr-sentinel-${NODE_NAME##*-}"
    REDIS_MASTER_IP=$(redis-cli -p 26379 sentinel get-master-addr-by-name jolkr-redis 2>/dev/null | head -1 | tr -d '\r' || \
                      docker exec "$SENTINEL_CONTAINER" redis-cli -p 26379 sentinel get-master-addr-by-name jolkr-redis 2>/dev/null | head -1 | tr -d '\r' || echo "unknown")

    if [ "$REDIS_MASTER_IP" == "$NODE_A_IP" ]; then
        echo -e "    Redis primary: ${GREEN}${BOLD}node-a${NC} ($NODE_A_IP)"
    elif [ "$REDIS_MASTER_IP" == "$NODE_B_IP" ]; then
        echo -e "    Redis primary: ${GREEN}${BOLD}node-b${NC} ($NODE_B_IP)"
    else
        echo -e "    Redis primary: ${YELLOW}$REDIS_MASTER_IP${NC}"
    fi

    # -- NATS --
    echo ""
    echo -e "  ${BOLD}NATS:${NC}"
    if NATS_VARZ=$(curl -sf --connect-timeout 3 http://localhost:8222/varz 2>/dev/null); then
        NATS_SERVER=$(echo "$NATS_VARZ" | grep -o '"server_name":"[^"]*"' | cut -d'"' -f4 || echo "unknown")
        NATS_ROUTES=$(echo "$NATS_VARZ" | grep -o '"routes":[0-9]*' | cut -d: -f2 || echo "?")
        echo -e "    Server: $NATS_SERVER  Routes: $NATS_ROUTES"
    else
        echo -e "    ${DIM}NATS monitoring unavailable${NC}"
    fi

    # -- Keepalived / VIP --
    echo ""
    echo -e "  ${BOLD}Virtual IP (Keepalived):${NC}"
    VIP="${VIRTUAL_IP:-}"
    if [ -n "$VIP" ]; then
        if ip addr show 2>/dev/null | grep -q "$VIP"; then
            echo -e "    VIP $VIP: ${GREEN}${BOLD}ON THIS NODE${NC}"
        else
            echo -e "    VIP $VIP: ${BLUE}on peer node${NC}"
        fi
    else
        echo -e "    ${DIM}VIRTUAL_IP not configured${NC}"
    fi

    echo ""
}

# ══════════════════════════════════════════════════════════════════════════════
# Test A: Postgres Failover
# ══════════════════════════════════════════════════════════════════════════════
test_postgres_failover() {
    header "Test: PostgreSQL Failover (Patroni)"

    # Determine if this node is the primary
    PATRONI_JSON=$(curl -sf --connect-timeout 3 http://localhost:8008/health 2>/dev/null || \
                   curl -s --connect-timeout 3 http://localhost:8008/health 2>/dev/null || echo "{}")
    PATRONI_ROLE=$(echo "$PATRONI_JSON" | grep -o '"role":"[^"]*"' | cut -d'"' -f4 || echo "unknown")

    if [[ "$PATRONI_ROLE" != "master" && "$PATRONI_ROLE" != "primary" ]]; then
        warn "This node ($NODE_NAME) is NOT the Postgres primary (role: $PATRONI_ROLE)."
        warn "Stopping Patroni here will not trigger a failover."
        if ! confirm "Stop Patroni on this replica node anyway?"; then
            return
        fi
    else
        info "This node ($NODE_NAME) is the Postgres PRIMARY."
        if ! confirm "This will stop Patroni on the primary, forcing a failover to the replica."; then
            return
        fi
    fi

    # Stop Patroni container
    info "Stopping Patroni container..."
    $COMPOSE_CMD stop patroni 2>/dev/null || docker stop "jolkr-patroni-${NODE_NAME##*-}" 2>/dev/null || true
    success "Patroni stopped on $NODE_NAME"

    # Wait for failover
    echo ""
    info "Waiting for Patroni failover..."
    info "The replica should be promoted to primary within ~30 seconds."
    echo ""

    if [ -n "$PEER_IP" ]; then
        wait_for_condition \
            "Peer $PEER_NAME promoted to primary" \
            "curl -sf http://$PEER_IP:8008/health 2>/dev/null | grep -q '\"role\":\"master\"\\|\"role\":\"primary\"'" \
            90 5
    else
        warn "No peer IP configured — cannot verify remote failover."
        info "Waiting 30 seconds for cluster to stabilize..."
        sleep 30
    fi

    # Run health check
    echo ""
    info "Running health check on cluster..."
    "$HEALTH_CHECK" || true

    # Offer to restore
    echo ""
    if confirm "Restore Patroni on this node?"; then
        info "Starting Patroni..."
        $COMPOSE_CMD start patroni 2>/dev/null || docker start "jolkr-patroni-${NODE_NAME##*-}" 2>/dev/null || true

        wait_for_condition \
            "Patroni rejoining cluster" \
            "curl -sf http://localhost:8008/health 2>/dev/null || curl -s http://localhost:8008/health 2>/dev/null | grep -q 'running'" \
            120 5

        success "Patroni restored on $NODE_NAME"
        info "Note: This node will rejoin as a replica (the new primary stays primary)."
    fi
}

# ══════════════════════════════════════════════════════════════════════════════
# Test B: Redis Failover
# ══════════════════════════════════════════════════════════════════════════════
test_redis_failover() {
    header "Test: Redis Failover (Sentinel)"

    REDIS_AUTH=""
    if [ -n "$REDIS_PASSWORD" ]; then
        REDIS_AUTH="-a $REDIS_PASSWORD --no-auth-warning"
    fi

    # Find current Redis master
    SENTINEL_CONTAINER="jolkr-sentinel-${NODE_NAME##*-}"
    REDIS_MASTER_IP=$(redis-cli -p 26379 sentinel get-master-addr-by-name jolkr-redis 2>/dev/null | head -1 | tr -d '\r' || \
                      docker exec "$SENTINEL_CONTAINER" redis-cli -p 26379 sentinel get-master-addr-by-name jolkr-redis 2>/dev/null | head -1 | tr -d '\r' || echo "")

    if [ -z "$REDIS_MASTER_IP" ]; then
        error "Cannot determine Redis master from Sentinel."
        return
    fi

    MASTER_NODE="unknown"
    if [ "$REDIS_MASTER_IP" == "$NODE_A_IP" ]; then
        MASTER_NODE="node-a"
    elif [ "$REDIS_MASTER_IP" == "$NODE_B_IP" ]; then
        MASTER_NODE="node-b"
    fi

    info "Current Redis master: ${BOLD}$MASTER_NODE${NC} ($REDIS_MASTER_IP)"

    if [ "$REDIS_MASTER_IP" == "$NODE_IP" ]; then
        info "Redis master is on THIS node ($NODE_NAME)."
        if ! confirm "This will stop Redis on the primary, forcing Sentinel to promote the replica."; then
            return
        fi

        # Stop Redis container
        info "Stopping Redis container..."
        $COMPOSE_CMD stop redis 2>/dev/null || docker stop "jolkr-redis-${NODE_NAME##*-}" 2>/dev/null || true
        success "Redis stopped on $NODE_NAME"

    else
        warn "Redis master is on $MASTER_NODE ($REDIS_MASTER_IP), not this node."
        if ! confirm "Stop Redis on this REPLICA node? (This won't trigger a failover.)"; then
            return
        fi

        info "Stopping Redis replica..."
        $COMPOSE_CMD stop redis 2>/dev/null || docker stop "jolkr-redis-${NODE_NAME##*-}" 2>/dev/null || true
        success "Redis replica stopped on $NODE_NAME"
    fi

    # Wait for Sentinel failover
    echo ""
    info "Waiting for Sentinel to detect failure and complete failover..."
    info "Sentinel down-after-milliseconds: 5000ms, failover-timeout: 60000ms"
    echo ""

    sleep 8  # Wait for sentinel to detect the failure (5s down-after + margin)

    # Check new master
    NEW_MASTER_IP=$(redis-cli -p 26379 sentinel get-master-addr-by-name jolkr-redis 2>/dev/null | head -1 | tr -d '\r' || \
                    docker exec "$SENTINEL_CONTAINER" redis-cli -p 26379 sentinel get-master-addr-by-name jolkr-redis 2>/dev/null | head -1 | tr -d '\r' || echo "")

    if [ -n "$NEW_MASTER_IP" ] && [ "$NEW_MASTER_IP" != "$REDIS_MASTER_IP" ]; then
        NEW_MASTER_NODE="unknown"
        if [ "$NEW_MASTER_IP" == "$NODE_A_IP" ]; then NEW_MASTER_NODE="node-a"; fi
        if [ "$NEW_MASTER_IP" == "$NODE_B_IP" ]; then NEW_MASTER_NODE="node-b"; fi
        success "Sentinel failover complete!"
        success "New Redis master: ${BOLD}$NEW_MASTER_NODE${NC} ($NEW_MASTER_IP)"
    elif [ "$REDIS_MASTER_IP" != "$NODE_IP" ]; then
        info "Master unchanged at $MASTER_NODE ($REDIS_MASTER_IP) — expected since we stopped a replica."
    else
        warn "Failover may still be in progress. Waiting longer..."
        wait_for_condition \
            "New Redis master elected" \
            "NEW=$(redis-cli -p 26379 sentinel get-master-addr-by-name jolkr-redis 2>/dev/null | head -1 | tr -d '\r' || docker exec $SENTINEL_CONTAINER redis-cli -p 26379 sentinel get-master-addr-by-name jolkr-redis 2>/dev/null | head -1 | tr -d '\r'); [ -n \"\$NEW\" ] && [ \"\$NEW\" != '$REDIS_MASTER_IP' ]" \
            60 5
    fi

    # Run health check
    echo ""
    info "Running health check..."
    "$HEALTH_CHECK" || true

    # Offer to restore
    echo ""
    if confirm "Restore Redis on this node?"; then
        info "Starting Redis..."
        $COMPOSE_CMD start redis 2>/dev/null || docker start "jolkr-redis-${NODE_NAME##*-}" 2>/dev/null || true

        wait_for_condition \
            "Redis rejoining cluster" \
            "redis-cli $REDIS_AUTH ping 2>/dev/null | grep -q PONG || docker exec jolkr-redis-${NODE_NAME##*-} redis-cli $REDIS_AUTH ping 2>/dev/null | grep -q PONG" \
            30 3

        success "Redis restored on $NODE_NAME (will rejoin as replica)."
    fi
}

# ══════════════════════════════════════════════════════════════════════════════
# Test C: API Failover (Keepalived VIP)
# ══════════════════════════════════════════════════════════════════════════════
test_api_failover() {
    header "Test: API Failover (Keepalived VIP)"

    VIP="${VIRTUAL_IP:-}"
    if [ -z "$VIP" ]; then
        error "VIRTUAL_IP is not set in .env — cannot test keepalived failover."
        return
    fi

    VIP_ON_THIS_NODE=false
    if ip addr show 2>/dev/null | grep -q "$VIP"; then
        VIP_ON_THIS_NODE=true
        info "VIP ($VIP) is currently on THIS node ($NODE_NAME)."
    else
        info "VIP ($VIP) is currently on the PEER node."
    fi

    if ! confirm "This will stop the API and keepalived on $NODE_NAME, causing the VIP to move to the peer."; then
        return
    fi

    # Stop API and keepalived
    info "Stopping Jolkr API..."
    $COMPOSE_CMD stop jolkr-api 2>/dev/null || docker stop "jolkr-api-${NODE_NAME##*-}" 2>/dev/null || true
    success "API stopped"

    info "Stopping keepalived..."
    $COMPOSE_CMD stop keepalived 2>/dev/null || docker stop "jolkr-keepalived-${NODE_NAME##*-}" 2>/dev/null || true
    success "Keepalived stopped"

    # Wait for VIP migration
    echo ""
    info "Waiting for keepalived on peer to claim VIP..."
    echo ""

    wait_for_condition \
        "VIP ($VIP) reachable on peer" \
        "ping -c 1 -W 2 $VIP >/dev/null 2>&1" \
        30 3

    # Verify API is reachable on VIP
    if curl -sf --connect-timeout 5 "http://$VIP/health" >/dev/null 2>&1; then
        success "API is reachable via VIP ($VIP) on peer node!"
    else
        warn "VIP is reachable but API health check on VIP failed."
        warn "The peer API may need a moment to start serving."
    fi

    # Run health check
    echo ""
    info "Running health check..."
    "$HEALTH_CHECK" || true

    # Offer to restore
    echo ""
    if confirm "Restore API and keepalived on this node?"; then
        info "Starting keepalived..."
        $COMPOSE_CMD start keepalived 2>/dev/null || docker start "jolkr-keepalived-${NODE_NAME##*-}" 2>/dev/null || true

        info "Starting Jolkr API..."
        $COMPOSE_CMD start jolkr-api 2>/dev/null || docker start "jolkr-api-${NODE_NAME##*-}" 2>/dev/null || true

        wait_for_condition \
            "API healthy on $NODE_NAME" \
            "curl -sf --connect-timeout 3 http://localhost:8080/health >/dev/null 2>&1" \
            60 5

        success "API and keepalived restored on $NODE_NAME"
        info "Note: VIP may or may not return to this node depending on keepalived priority."
    fi
}

# ══════════════════════════════════════════════════════════════════════════════
# Test D: Full Node Failure
# ══════════════════════════════════════════════════════════════════════════════
test_full_node_failure() {
    header "Test: Full Node Failure"

    echo -e "${RED}${BOLD}  WARNING: This will stop ALL services on $NODE_NAME ($NODE_IP).${NC}"
    echo -e "${RED}${BOLD}  All failover mechanisms will be tested simultaneously.${NC}"
    echo ""
    echo "  Services that will be stopped:"

    if [[ "$NODE_NAME" == "node-a" || "$NODE_NAME" == "node-b" ]]; then
        echo "    - Patroni (Postgres)"
        echo "    - Redis"
        echo "    - Redis Sentinel"
        echo "    - NATS"
        echo "    - MinIO"
        echo "    - Jolkr API"
        echo "    - nginx"
        echo "    - keepalived"
        echo "    - etcd"
    else
        echo "    - etcd"
        echo "    - Redis Sentinel"
        echo "    - NATS"
    fi

    echo ""
    if ! confirm "This is a destructive test. Are you sure?"; then
        return
    fi

    # Double-confirm for full node failure
    echo -ne "${RED}Type 'FAILOVER' to confirm: ${NC}"
    read -r confirmation
    if [ "$confirmation" != "FAILOVER" ]; then
        info "Cancelled."
        return
    fi

    echo ""
    info "Stopping ALL services on $NODE_NAME..."
    $COMPOSE_CMD down 2>/dev/null || true
    success "All services stopped on $NODE_NAME"

    echo ""
    info "Waiting for cluster to stabilize (30 seconds)..."
    echo ""

    # Countdown
    for i in $(seq 30 -1 1); do
        echo -ne "  ${DIM}Stabilizing... ${i}s remaining${NC}\r"
        sleep 1
    done
    echo -e "  ${DIM}Stabilization period complete.${NC}          "

    # Check peer health if possible
    echo ""
    if [ -n "${PEER_IP:-}" ]; then
        info "Checking peer node ($PEER_NAME at $PEER_IP)..."
        echo ""

        echo -ne "  Patroni:   "
        if PEER_PATRONI=$(curl -sf --connect-timeout 3 "http://$PEER_IP:8008/health" 2>/dev/null) || \
           PEER_PATRONI=$(curl -s --connect-timeout 3 "http://$PEER_IP:8008/health" 2>/dev/null); then
            PEER_PG_ROLE=$(echo "$PEER_PATRONI" | grep -o '"role":"[^"]*"' | cut -d'"' -f4 || echo "?")
            echo -e "${GREEN}UP${NC} (role: $PEER_PG_ROLE)"
        else
            echo -e "${RED}UNREACHABLE${NC}"
        fi

        echo -ne "  Redis:     "
        if PEER_REDIS_MASTER=$(curl -sf --connect-timeout 3 "http://$PEER_IP:26379/" 2>/dev/null) || \
           ping -c 1 -W 2 "$PEER_IP" >/dev/null 2>&1; then
            echo -e "${GREEN}Peer reachable${NC}"
        else
            echo -e "${RED}Peer unreachable${NC}"
        fi

        echo -ne "  NATS:      "
        if curl -sf --connect-timeout 3 "http://$PEER_IP:8222/healthz" >/dev/null 2>&1; then
            echo -e "${GREEN}UP${NC}"
        else
            echo -e "${RED}UNREACHABLE${NC}"
        fi

        echo -ne "  API:       "
        if curl -sf --connect-timeout 3 "http://$PEER_IP:8080/health" >/dev/null 2>&1; then
            echo -e "${GREEN}UP${NC}"
        else
            echo -e "${YELLOW}DOWN or unreachable${NC}"
        fi

        VIP="${VIRTUAL_IP:-}"
        if [ -n "$VIP" ]; then
            echo -ne "  VIP ($VIP): "
            if ping -c 1 -W 2 "$VIP" >/dev/null 2>&1; then
                echo -e "${GREEN}REACHABLE${NC} (peer has VIP)"
            else
                echo -e "${RED}UNREACHABLE${NC}"
            fi
        fi
    else
        warn "No peer IP — cannot verify remote failover from this node."
    fi

    # Offer to restore
    echo ""
    echo -e "${BOLD}${CYAN}──────────────────────────────────────────────────────${NC}"
    if confirm "Restore ALL services on $NODE_NAME?"; then
        info "Starting all services..."
        $COMPOSE_CMD up -d 2>/dev/null
        success "All services starting on $NODE_NAME"

        echo ""
        info "Waiting for services to initialize (45 seconds)..."
        for i in $(seq 45 -1 1); do
            echo -ne "  ${DIM}Starting... ${i}s remaining${NC}\r"
            sleep 1
        done
        echo -e "  ${DIM}Startup period complete.${NC}               "

        echo ""
        info "Running health check..."
        "$HEALTH_CHECK" || true

        echo ""
        success "Node $NODE_NAME restored."
        info "Services will rejoin the cluster as replicas (Patroni, Redis)."
        info "VIP assignment depends on keepalived priority configuration."
    fi
}

# ══════════════════════════════════════════════════════════════════════════════
# Main Menu
# ══════════════════════════════════════════════════════════════════════════════
main() {
    echo ""
    echo -e "${BOLD}${MAGENTA}══════════════════════════════════════════════════════════════${NC}"
    echo -e "${BOLD}${MAGENTA}  Jolkr HA Cluster — Failover Test Suite${NC}"
    echo -e "${BOLD}${MAGENTA}  Node: ${NODE_NAME} (${NODE_IP})${NC}"
    echo -e "${BOLD}${MAGENTA}══════════════════════════════════════════════════════════════${NC}"

    # Show current state first
    show_cluster_state

    # Menu
    echo -e "${BOLD}${CYAN}──────────────────────────────────────────────────────${NC}"
    echo -e "${BOLD}  Select a failover test:${NC}"
    echo ""
    echo -e "    ${BOLD}a)${NC}  PostgreSQL failover    ${DIM}(stop Patroni primary, auto-promote replica)${NC}"
    echo -e "    ${BOLD}b)${NC}  Redis failover          ${DIM}(stop Redis primary, Sentinel promotes replica)${NC}"
    echo -e "    ${BOLD}c)${NC}  API / VIP failover      ${DIM}(stop API + keepalived, VIP moves to peer)${NC}"
    echo -e "    ${BOLD}d)${NC}  Full node failure       ${DIM}(stop everything, all services failover)${NC}"
    echo ""
    echo -e "    ${BOLD}h)${NC}  Health check only       ${DIM}(no changes, just check status)${NC}"
    echo -e "    ${BOLD}s)${NC}  Show cluster state      ${DIM}(display current primaries)${NC}"
    echo -e "    ${BOLD}q)${NC}  Quit"
    echo ""
    echo -ne "${CYAN}  Choice [a/b/c/d/h/s/q]: ${NC}"

    read -r choice

    case "$choice" in
        a|A)
            test_postgres_failover
            ;;
        b|B)
            test_redis_failover
            ;;
        c|C)
            test_api_failover
            ;;
        d|D)
            test_full_node_failure
            ;;
        h|H)
            echo ""
            "$HEALTH_CHECK"
            ;;
        s|S)
            show_cluster_state
            ;;
        q|Q)
            info "Bye."
            exit 0
            ;;
        *)
            error "Invalid choice: $choice"
            exit 1
            ;;
    esac

    echo ""
    echo -e "${BOLD}${MAGENTA}══════════════════════════════════════════════════════════════${NC}"
    echo -e "${BOLD}${MAGENTA}  Failover test complete.${NC}"
    echo -e "${BOLD}${MAGENTA}══════════════════════════════════════════════════════════════${NC}"
    echo ""
}

main "$@"
