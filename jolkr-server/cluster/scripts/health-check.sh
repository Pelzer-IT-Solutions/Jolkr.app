#!/bin/bash
set -euo pipefail

# ══════════════════════════════════════════════════════════════════════════════
# Jolkr HA Cluster — Health Check Script
#
# Verifies that all cluster services are running and healthy.
# Exit code 0 = all healthy, 1 = one or more failures.
#
# Usage:
#   ./scripts/health-check.sh           # Check all services
#   ./scripts/health-check.sh --quiet   # Exit code only, no output
# ══════════════════════════════════════════════════════════════════════════════

# ── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

QUIET=false
if [[ "${1:-}" == "--quiet" || "${1:-}" == "-q" ]]; then
    QUIET=true
fi

# ── Determine cluster root directory ────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLUSTER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── Load environment ───────────────────────────────────────────────────────
ENV_FILE="$CLUSTER_DIR/.env"
if [ -f "$ENV_FILE" ]; then
    set -a
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    set +a
fi

NODE_NAME="${NODE_NAME:-unknown}"
NODE_IP="${NODE_IP:-127.0.0.1}"
REDIS_PASSWORD="${REDIS_PASSWORD:-}"

# ── Counters ────────────────────────────────────────────────────────────────
TOTAL=0
PASSED=0
FAILED=0
SKIPPED=0

# ── Helper functions ───────────────────────────────────────────────────────
print_result() {
    local name="$1"
    local status="$2"
    local detail="${3:-}"

    TOTAL=$((TOTAL + 1))

    if $QUIET; then
        return
    fi

    local icon
    local color
    case "$status" in
        pass)
            icon="${GREEN}[HEALTHY]${NC}"
            color="$GREEN"
            PASSED=$((PASSED + 1))
            ;;
        fail)
            icon="${RED}[DOWN]${NC}   "
            color="$RED"
            FAILED=$((FAILED + 1))
            ;;
        skip)
            icon="${YELLOW}[SKIP]${NC}  "
            color="$YELLOW"
            SKIPPED=$((SKIPPED + 1))
            TOTAL=$((TOTAL - 1))  # Don't count skipped in total
            ;;
        warn)
            icon="${YELLOW}[WARN]${NC}  "
            color="$YELLOW"
            PASSED=$((PASSED + 1))  # Warnings still count as "up"
            ;;
    esac

    printf "  %b  %-22s" "$icon" "$name"
    if [ -n "$detail" ]; then
        echo -e " ${DIM}${detail}${NC}"
    else
        echo ""
    fi
}

check_service() {
    local name="$1"
    local cmd="$2"
    local detail_cmd="${3:-}"

    local output
    if output=$(eval "$cmd" 2>&1); then
        local detail=""
        if [ -n "$detail_cmd" ]; then
            detail=$(eval "$detail_cmd" 2>/dev/null || echo "")
        fi
        print_result "$name" "pass" "$detail"
        return 0
    else
        print_result "$name" "fail" "${output:0:80}"
        return 1
    fi
}

# ══════════════════════════════════════════════════════════════════════════════
# Header
# ══════════════════════════════════════════════════════════════════════════════
if ! $QUIET; then
    echo ""
    echo -e "${BOLD}${CYAN}══════════════════════════════════════════════════════════════${NC}"
    echo -e "${BOLD}${CYAN}  Jolkr HA Cluster — Health Check${NC}"
    echo -e "${BOLD}${CYAN}  Node: ${NODE_NAME} (${NODE_IP})${NC}"
    echo -e "${BOLD}${CYAN}  Time: $(date '+%Y-%m-%d %H:%M:%S')${NC}"
    echo -e "${BOLD}${CYAN}══════════════════════════════════════════════════════════════${NC}"
    echo ""
fi

FAILURES=0

# ══════════════════════════════════════════════════════════════════════════════
# 1. etcd
# ══════════════════════════════════════════════════════════════════════════════
if ! $QUIET; then echo -e "${BOLD}  Distributed Coordination${NC}"; fi

if check_service "etcd" \
    "curl -sf --connect-timeout 3 http://localhost:2379/health" \
    "curl -sf http://localhost:2379/health 2>/dev/null | grep -o '\"health\":\"[^\"]*\"'"; then
    :
else
    FAILURES=$((FAILURES + 1))
fi

# ══════════════════════════════════════════════════════════════════════════════
# 2. Patroni
# ══════════════════════════════════════════════════════════════════════════════
if [[ "$NODE_NAME" == "node-a" || "$NODE_NAME" == "node-b" ]]; then
    if ! $QUIET; then echo -e "\n${BOLD}  Database (Patroni + PostgreSQL)${NC}"; fi

    # Patroni REST API
    PATRONI_DETAIL=""
    if PATRONI_JSON=$(curl -sf --connect-timeout 3 http://localhost:8008/health 2>/dev/null); then
        PATRONI_ROLE=$(echo "$PATRONI_JSON" | grep -o '"role":"[^"]*"' | cut -d'"' -f4 || echo "unknown")
        PATRONI_STATE=$(echo "$PATRONI_JSON" | grep -o '"state":"[^"]*"' | cut -d'"' -f4 || echo "unknown")
        PATRONI_DETAIL="role=$PATRONI_ROLE state=$PATRONI_STATE"
        print_result "Patroni" "pass" "$PATRONI_DETAIL"
    else
        # Patroni returns 503 for replicas but still provides info
        if PATRONI_JSON=$(curl -s --connect-timeout 3 http://localhost:8008/health 2>/dev/null); then
            PATRONI_ROLE=$(echo "$PATRONI_JSON" | grep -o '"role":"[^"]*"' | cut -d'"' -f4 || echo "unknown")
            PATRONI_STATE=$(echo "$PATRONI_JSON" | grep -o '"state":"[^"]*"' | cut -d'"' -f4 || echo "unknown")
            if [ "$PATRONI_STATE" == "running" ]; then
                PATRONI_DETAIL="role=$PATRONI_ROLE state=$PATRONI_STATE"
                print_result "Patroni" "pass" "$PATRONI_DETAIL"
            else
                print_result "Patroni" "fail" "role=$PATRONI_ROLE state=$PATRONI_STATE"
                FAILURES=$((FAILURES + 1))
            fi
        else
            print_result "Patroni" "fail" "REST API unreachable"
            FAILURES=$((FAILURES + 1))
        fi
    fi

    # PostgreSQL
    if check_service "PostgreSQL" \
        "pg_isready -h localhost -p 5432 -q 2>/dev/null || docker exec jolkr-patroni-${NODE_NAME##*-} pg_isready -h localhost -p 5432 -q 2>/dev/null" \
        ""; then
        :
    else
        FAILURES=$((FAILURES + 1))
    fi
else
    if ! $QUIET; then
        echo -e "\n${BOLD}  Database (Patroni + PostgreSQL)${NC}"
        print_result "Patroni" "skip" "not on witness node"
        print_result "PostgreSQL" "skip" "not on witness node"
    fi
fi

# ══════════════════════════════════════════════════════════════════════════════
# 3. Redis
# ══════════════════════════════════════════════════════════════════════════════
if ! $QUIET; then echo -e "\n${BOLD}  Cache (Redis)${NC}"; fi

# Redis data node (only on node-a / node-b)
if [[ "$NODE_NAME" == "node-a" || "$NODE_NAME" == "node-b" ]]; then
    REDIS_AUTH=""
    if [ -n "$REDIS_PASSWORD" ]; then
        REDIS_AUTH="-a $REDIS_PASSWORD --no-auth-warning"
    fi

    if check_service "Redis" \
        "redis-cli $REDIS_AUTH ping 2>/dev/null | grep -q PONG || docker exec jolkr-redis-${NODE_NAME##*-} redis-cli $REDIS_AUTH ping 2>/dev/null | grep -q PONG"; then
        :
    else
        FAILURES=$((FAILURES + 1))
    fi

    # Redis role info
    if ! $QUIET; then
        REDIS_ROLE=$(redis-cli $REDIS_AUTH info replication 2>/dev/null | grep "^role:" | tr -d '\r' || \
                     docker exec "jolkr-redis-${NODE_NAME##*-}" redis-cli $REDIS_AUTH info replication 2>/dev/null | grep "^role:" | tr -d '\r' || echo "role:unknown")
        echo -e "                                  ${DIM}${REDIS_ROLE}${NC}"
    fi
else
    if ! $QUIET; then
        print_result "Redis" "skip" "not on witness node"
    fi
fi

# Redis Sentinel (on all nodes)
if check_service "Redis Sentinel" \
    "redis-cli -p 26379 ping 2>/dev/null | grep -q PONG || curl -sf --connect-timeout 3 http://localhost:26379/ >/dev/null 2>&1"; then
    :
else
    # Try via docker
    SENTINEL_CONTAINER="jolkr-sentinel-${NODE_NAME##*-}"
    if docker exec "$SENTINEL_CONTAINER" redis-cli -p 26379 ping 2>/dev/null | grep -q PONG; then
        print_result "Redis Sentinel" "pass" "via docker"
        PASSED=$((PASSED + 1))
        FAILED=$((FAILED - 1))
    else
        FAILURES=$((FAILURES + 1))
    fi
fi

# Sentinel master info
if ! $QUIET; then
    SENTINEL_MASTER=$(redis-cli -p 26379 sentinel get-master-addr-by-name jolkr-redis 2>/dev/null || \
                      docker exec "jolkr-sentinel-${NODE_NAME##*-}" redis-cli -p 26379 sentinel get-master-addr-by-name jolkr-redis 2>/dev/null || echo "")
    if [ -n "$SENTINEL_MASTER" ]; then
        MASTER_IP=$(echo "$SENTINEL_MASTER" | head -1 | tr -d '\r')
        echo -e "                                  ${DIM}master=$MASTER_IP${NC}"
    fi
fi

# ══════════════════════════════════════════════════════════════════════════════
# 4. NATS
# ══════════════════════════════════════════════════════════════════════════════
if ! $QUIET; then echo -e "\n${BOLD}  Messaging (NATS)${NC}"; fi

NATS_DETAIL=""
if NATS_HEALTH=$(curl -sf --connect-timeout 3 http://localhost:8222/healthz 2>/dev/null); then
    # Get server info for details
    if NATS_VARZ=$(curl -sf --connect-timeout 3 http://localhost:8222/varz 2>/dev/null); then
        NATS_CONNS=$(echo "$NATS_VARZ" | grep -o '"connections":[0-9]*' | cut -d: -f2 || echo "?")
        NATS_ROUTES=$(echo "$NATS_VARZ" | grep -o '"routes":[0-9]*' | cut -d: -f2 || echo "?")
        NATS_DETAIL="connections=$NATS_CONNS routes=$NATS_ROUTES"
    fi
    print_result "NATS" "pass" "$NATS_DETAIL"
else
    print_result "NATS" "fail" "monitoring endpoint unreachable"
    FAILURES=$((FAILURES + 1))
fi

# JetStream status
if [[ "$NODE_NAME" == "node-a" || "$NODE_NAME" == "node-b" ]]; then
    if JS_INFO=$(curl -sf --connect-timeout 3 http://localhost:8222/jsz 2>/dev/null); then
        JS_STREAMS=$(echo "$JS_INFO" | grep -o '"streams":[0-9]*' | head -1 | cut -d: -f2 || echo "0")
        print_result "NATS JetStream" "pass" "streams=$JS_STREAMS"
    else
        print_result "NATS JetStream" "warn" "info unavailable"
    fi
fi

# ══════════════════════════════════════════════════════════════════════════════
# 5. MinIO (only Node A / Node B)
# ══════════════════════════════════════════════════════════════════════════════
if [[ "$NODE_NAME" == "node-a" || "$NODE_NAME" == "node-b" ]]; then
    if ! $QUIET; then echo -e "\n${BOLD}  Object Storage (MinIO)${NC}"; fi

    if check_service "MinIO" \
        "curl -sf --connect-timeout 3 http://localhost:9000/minio/health/live" \
        ""; then
        :
    else
        FAILURES=$((FAILURES + 1))
    fi

    # MinIO cluster health (2-node erasure set)
    if MINIO_CLUSTER=$(curl -sf --connect-timeout 3 http://localhost:9000/minio/health/cluster 2>/dev/null); then
        print_result "MinIO Cluster" "pass" ""
    else
        print_result "MinIO Cluster" "warn" "cluster endpoint unavailable"
    fi
else
    if ! $QUIET; then
        echo -e "\n${BOLD}  Object Storage (MinIO)${NC}"
        print_result "MinIO" "skip" "not on witness node"
    fi
fi

# ══════════════════════════════════════════════════════════════════════════════
# 6. Jolkr API (only Node A / Node B)
# ══════════════════════════════════════════════════════════════════════════════
if [[ "$NODE_NAME" == "node-a" || "$NODE_NAME" == "node-b" ]]; then
    if ! $QUIET; then echo -e "\n${BOLD}  Application${NC}"; fi

    if check_service "Jolkr API" \
        "curl -sf --connect-timeout 5 http://localhost:8080/health" \
        "curl -sf http://localhost:8080/health 2>/dev/null | head -c 100"; then
        :
    else
        FAILURES=$((FAILURES + 1))
    fi
else
    if ! $QUIET; then
        echo -e "\n${BOLD}  Application${NC}"
        print_result "Jolkr API" "skip" "not on witness node"
    fi
fi

# ══════════════════════════════════════════════════════════════════════════════
# 7. nginx (only Node A / Node B)
# ══════════════════════════════════════════════════════════════════════════════
if [[ "$NODE_NAME" == "node-a" || "$NODE_NAME" == "node-b" ]]; then
    if check_service "nginx" \
        "curl -sf --connect-timeout 3 http://localhost/health || curl -sf --connect-timeout 3 http://localhost:80/health" \
        ""; then
        :
    else
        FAILURES=$((FAILURES + 1))
    fi
else
    if ! $QUIET; then
        print_result "nginx" "skip" "not on witness node"
    fi
fi

# ══════════════════════════════════════════════════════════════════════════════
# 8. Keepalived / VIP (only Node A / Node B)
# ══════════════════════════════════════════════════════════════════════════════
if [[ "$NODE_NAME" == "node-a" || "$NODE_NAME" == "node-b" ]]; then
    if ! $QUIET; then echo -e "\n${BOLD}  High Availability${NC}"; fi

    VIP="${VIRTUAL_IP:-}"
    if [ -n "$VIP" ]; then
        if ip addr show 2>/dev/null | grep -q "$VIP"; then
            print_result "Keepalived VIP" "pass" "VIP $VIP is on THIS node"
        else
            # VIP not on this node — that's fine if the peer has it
            if ping -c 1 -W 2 "$VIP" >/dev/null 2>&1; then
                print_result "Keepalived VIP" "pass" "VIP $VIP is on peer node"
            else
                print_result "Keepalived VIP" "fail" "VIP $VIP unreachable"
                FAILURES=$((FAILURES + 1))
            fi
        fi
    else
        print_result "Keepalived VIP" "warn" "VIRTUAL_IP not set"
    fi
else
    if ! $QUIET; then
        echo -e "\n${BOLD}  High Availability${NC}"
        print_result "Keepalived VIP" "skip" "not on witness node"
    fi
fi

# ══════════════════════════════════════════════════════════════════════════════
# Summary
# ══════════════════════════════════════════════════════════════════════════════
if ! $QUIET; then
    echo ""
    echo -e "${BOLD}${CYAN}══════════════════════════════════════════════════════════════${NC}"

    if [ "$FAILURES" -eq 0 ]; then
        echo -e "  ${GREEN}${BOLD}ALL CHECKS PASSED${NC}  ${DIM}($PASSED/$TOTAL healthy, $SKIPPED skipped)${NC}"
    else
        echo -e "  ${RED}${BOLD}$FAILURES FAILURE(S) DETECTED${NC}  ${DIM}($PASSED passed, $FAILURES failed, $SKIPPED skipped)${NC}"
    fi

    echo -e "${BOLD}${CYAN}══════════════════════════════════════════════════════════════${NC}"
    echo ""
fi

if [ "$FAILURES" -gt 0 ]; then
    exit 1
fi

exit 0
