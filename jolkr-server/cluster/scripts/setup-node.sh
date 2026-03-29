#!/bin/bash
set -euo pipefail

# ══════════════════════════════════════════════════════════════════════════════
# Jolkr HA Cluster — Node Setup Script
#
# Universal setup script that works on any node (A, B, or C).
# Reads .env, validates config, resolves templates, and starts services.
#
# Usage:
#   cd /path/to/jolkr-server/cluster
#   ./scripts/setup-node.sh
# ══════════════════════════════════════════════════════════════════════════════

# ── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*"; }
header()  { echo -e "\n${BOLD}${CYAN}═══ $* ═══${NC}\n"; }

# ── Determine cluster root directory ────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLUSTER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$CLUSTER_DIR"
info "Cluster directory: $CLUSTER_DIR"

# ══════════════════════════════════════════════════════════════════════════════
# Step 1: Check .env exists
# ══════════════════════════════════════════════════════════════════════════════
header "Step 1: Loading Environment"

ENV_FILE="$CLUSTER_DIR/.env"

if [ ! -f "$ENV_FILE" ]; then
    error ".env file not found at: $ENV_FILE"
    error "Copy .env.template to .env and fill in the values:"
    error "  cp $CLUSTER_DIR/.env.template $CLUSTER_DIR/.env"
    exit 1
fi

success ".env file found"

# ══════════════════════════════════════════════════════════════════════════════
# Step 2: Source .env
# ══════════════════════════════════════════════════════════════════════════════
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

info "NODE_NAME = ${NODE_NAME:-<unset>}"
info "NODE_IP   = ${NODE_IP:-<unset>}"

# ══════════════════════════════════════════════════════════════════════════════
# Step 3: Validate required variables
# ══════════════════════════════════════════════════════════════════════════════
header "Step 2: Validating Configuration"

REQUIRED_VARS=(
    # Node identity
    NODE_NAME
    NODE_IP
    # Cluster peers
    NODE_A_IP
    NODE_B_IP
    NODE_C_IP
    # Postgres / Patroni
    POSTGRES_USER
    POSTGRES_PASSWORD
    POSTGRES_DB
    REPLICATION_USER
    REPLICATION_PASSWORD
    PATRONI_RESTAPI_PASSWORD
    # Redis
    REDIS_PASSWORD
    # NATS
    NATS_USER
    NATS_PASSWORD
    NATS_HMAC_SECRET
    NATS_CLUSTER_PASSWORD
    # Jolkr API
    JWT_SECRET
)

# Node A and B also need keepalived and MinIO vars
if [[ "${NODE_NAME:-}" == "node-a" || "${NODE_NAME:-}" == "node-b" ]]; then
    REQUIRED_VARS+=(
        VIRTUAL_IP
        VIRTUAL_IP_MASK
        KEEPALIVED_PASSWORD
        KEEPALIVED_INTERFACE
        MINIO_ROOT_USER
        MINIO_ROOT_PASSWORD
    )
fi

MISSING=()
for var in "${REQUIRED_VARS[@]}"; do
    if [ -z "${!var:-}" ]; then
        MISSING+=("$var")
    fi
done

if [ ${#MISSING[@]} -gt 0 ]; then
    error "The following required variables are missing or empty in .env:"
    for var in "${MISSING[@]}"; do
        echo -e "  ${RED}-${NC} $var"
    done
    exit 1
fi

# Validate NODE_NAME is one of the expected values
if [[ "$NODE_NAME" != "node-a" && "$NODE_NAME" != "node-b" && "$NODE_NAME" != "node-c" ]]; then
    error "NODE_NAME must be 'node-a', 'node-b', or 'node-c' (got: '$NODE_NAME')"
    exit 1
fi

success "All required variables are set"
info "Node identity: ${BOLD}$NODE_NAME${NC} ($NODE_IP)"
info "Cluster peers: A=$NODE_A_IP  B=$NODE_B_IP  C=$NODE_C_IP"

# ══════════════════════════════════════════════════════════════════════════════
# Step 4: Determine docker-compose file
# ══════════════════════════════════════════════════════════════════════════════
header "Step 3: Selecting Compose Configuration"

COMPOSE_FILE="$CLUSTER_DIR/$NODE_NAME/docker-compose.yml"

if [ ! -f "$COMPOSE_FILE" ]; then
    error "Docker Compose file not found: $COMPOSE_FILE"
    error "Expected directory structure: cluster/$NODE_NAME/docker-compose.yml"
    exit 1
fi

success "Using compose file: $COMPOSE_FILE"

# ══════════════════════════════════════════════════════════════════════════════
# Step 5: Create certs directory
# ══════════════════════════════════════════════════════════════════════════════
header "Step 4: TLS Certificates"

CERTS_DIR="$CLUSTER_DIR/certs"
mkdir -p "$CERTS_DIR"

if [ -f "$CERTS_DIR/fullchain.pem" ] && [ -f "$CERTS_DIR/privkey.pem" ]; then
    success "TLS certificates found in $CERTS_DIR"
else
    warn "TLS certificates NOT found in $CERTS_DIR"
    warn "Expected: fullchain.pem and privkey.pem"
    warn "Services will start but HTTPS/TLS will not work until certs are placed."
    warn "Use certbot or acme.sh to obtain certificates."
fi

# ══════════════════════════════════════════════════════════════════════════════
# Step 6: Resolve config templates
# ══════════════════════════════════════════════════════════════════════════════
header "Step 5: Resolving Configuration Templates"

RESOLVED_DIR="$CLUSTER_DIR/resolved"
mkdir -p "$RESOLVED_DIR/nats" "$RESOLVED_DIR/redis" "$RESOLVED_DIR/etcd" "$RESOLVED_DIR/patroni"

# Determine peer IP for keepalived (node-a peers with node-b, and vice versa)
PEER_IP=""
if [ "$NODE_NAME" == "node-a" ]; then
    PEER_IP="$NODE_B_IP"
elif [ "$NODE_NAME" == "node-b" ]; then
    PEER_IP="$NODE_A_IP"
fi

resolve_file() {
    local src="$1"
    local dst="$2"
    local basename
    basename="$(basename "$src")"

    if [ ! -f "$src" ]; then
        warn "Template not found, skipping: $src"
        return
    fi

    cp "$src" "$dst"

    # Node IPs
    sed -i "s|NODE_A_IP_PLACEHOLDER|${NODE_A_IP}|g"   "$dst"
    sed -i "s|NODE_B_IP_PLACEHOLDER|${NODE_B_IP}|g"   "$dst"
    sed -i "s|NODE_C_IP_PLACEHOLDER|${NODE_C_IP}|g"   "$dst"
    sed -i "s|NODE_IP_PLACEHOLDER|${NODE_IP}|g"        "$dst"

    # Redis
    sed -i "s|REDIS_PASSWORD_PLACEHOLDER|${REDIS_PASSWORD}|g" "$dst"

    # NATS
    sed -i "s|NATS_USER_PLACEHOLDER|${NATS_USER}|g"                     "$dst"
    sed -i "s|NATS_PASSWORD_PLACEHOLDER|${NATS_PASSWORD}|g"             "$dst"
    sed -i "s|NATS_CLUSTER_PASSWORD_PLACEHOLDER|${NATS_CLUSTER_PASSWORD}|g" "$dst"

    # Keepalived (only relevant for node-a / node-b)
    sed -i "s|KEEPALIVED_INTERFACE_PLACEHOLDER|${KEEPALIVED_INTERFACE:-eth0}|g" "$dst"
    sed -i "s|KEEPALIVED_PASSWORD_PLACEHOLDER|${KEEPALIVED_PASSWORD:-}|g"      "$dst"
    sed -i "s|VIRTUAL_IP_PLACEHOLDER|${VIRTUAL_IP:-}|g"                        "$dst"
    sed -i "s|VIRTUAL_IP_MASK_PLACEHOLDER|${VIRTUAL_IP_MASK:-24}|g"            "$dst"

    # Peer IP (for keepalived unicast/peer config)
    if [ -n "$PEER_IP" ]; then
        sed -i "s|PEER_IP_PLACEHOLDER|${PEER_IP}|g" "$dst"
    fi

    # Postgres / Patroni
    sed -i "s|\${POSTGRES_PASSWORD}|${POSTGRES_PASSWORD}|g"       "$dst"
    sed -i "s|\${REPLICATION_PASSWORD}|${REPLICATION_PASSWORD}|g" "$dst"
    sed -i "s|\${NODE_NAME}|${NODE_NAME}|g"                       "$dst"
    sed -i "s|\${NODE_IP}|${NODE_IP}|g"                           "$dst"
    sed -i "s|\${NODE_A_IP}|${NODE_A_IP}|g"                       "$dst"
    sed -i "s|\${NODE_B_IP}|${NODE_B_IP}|g"                       "$dst"
    sed -i "s|\${NODE_C_IP}|${NODE_C_IP}|g"                       "$dst"

    info "Resolved: $basename -> $dst"
}

# -- NATS config (per-node) --
NATS_CONF="$CLUSTER_DIR/config/nats/nats-${NODE_NAME}.conf"
if [ -f "$NATS_CONF" ]; then
    resolve_file "$NATS_CONF" "$RESOLVED_DIR/nats/nats.conf"
else
    warn "No NATS config template for $NODE_NAME at $NATS_CONF"
fi

# -- Redis Sentinel config --
resolve_file "$CLUSTER_DIR/config/redis/sentinel.conf" "$RESOLVED_DIR/redis/sentinel.conf"

# -- etcd config --
resolve_file "$CLUSTER_DIR/config/etcd/etcd.conf.yml" "$RESOLVED_DIR/etcd/etcd.conf.yml"

# -- Patroni config (only node-a / node-b run Postgres) --
if [[ "$NODE_NAME" == "node-a" || "$NODE_NAME" == "node-b" ]]; then
    resolve_file "$CLUSTER_DIR/config/patroni/patroni.yml" "$RESOLVED_DIR/patroni/patroni.yml"
fi

success "All templates resolved to: $RESOLVED_DIR/"

# ══════════════════════════════════════════════════════════════════════════════
# Step 7: Make entrypoint scripts executable
# ══════════════════════════════════════════════════════════════════════════════
header "Step 6: Preparing Entrypoints"

ENTRYPOINT_SCRIPTS=(
    "$CLUSTER_DIR/config/nats/nats-entrypoint.sh"
    "$CLUSTER_DIR/config/redis/sentinel-entrypoint.sh"
)

for script in "${ENTRYPOINT_SCRIPTS[@]}"; do
    if [ -f "$script" ]; then
        chmod +x "$script"
        success "Executable: $(basename "$script")"
    fi
done

# Also make cluster scripts executable
chmod +x "$SCRIPT_DIR"/*.sh 2>/dev/null || true

# ══════════════════════════════════════════════════════════════════════════════
# Step 8: Start services
# ══════════════════════════════════════════════════════════════════════════════
header "Step 7: Starting Services"

info "Starting Docker Compose for $NODE_NAME..."
info "Compose file: $COMPOSE_FILE"
echo ""

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d

echo ""

# ══════════════════════════════════════════════════════════════════════════════
# Step 9: Print status
# ══════════════════════════════════════════════════════════════════════════════
header "Setup Complete"

echo -e "${GREEN}${BOLD}Node $NODE_NAME ($NODE_IP) is starting up!${NC}"
echo ""

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps

echo ""
echo -e "${CYAN}Next steps:${NC}"
echo "  1. Run setup-node.sh on the other nodes"
echo "  2. Verify cluster health:  ./scripts/health-check.sh"
echo "  3. Test failover:          ./scripts/failover-test.sh"

if [ ! -f "$CERTS_DIR/fullchain.pem" ]; then
    echo ""
    echo -e "  ${YELLOW}!${NC} Don't forget to install TLS certificates in $CERTS_DIR"
fi

echo ""
