#!/bin/bash
set -euo pipefail

# NATS Entrypoint Script — Jolkr HA Cluster
# Resolves placeholder values in NATS config files from environment variables,
# then starts nats-server with the resolved configuration.

CONFIG_FILE="${1:-${NATS_CONFIG_FILE:-}}"

if [ -z "$CONFIG_FILE" ]; then
  echo "ERROR: No config file specified. Pass as \$1 or set NATS_CONFIG_FILE." >&2
  exit 1
fi

if [ ! -f "$CONFIG_FILE" ]; then
  echo "ERROR: Config file not found: $CONFIG_FILE" >&2
  exit 1
fi

# Validate required environment variables
REQUIRED_VARS=(
  NATS_USER
  NATS_PASSWORD
  NATS_CLUSTER_PASSWORD
  NODE_A_IP
  NODE_B_IP
  NODE_C_IP
)

for var in "${REQUIRED_VARS[@]}"; do
  if [ -z "${!var:-}" ]; then
    echo "ERROR: Required environment variable $var is not set." >&2
    exit 1
  fi
done

RESOLVED_CONFIG="/tmp/nats-resolved.conf"

# Replace all placeholders with actual environment variable values
sed \
  -e "s|NATS_USER_PLACEHOLDER|${NATS_USER}|g" \
  -e "s|NATS_PASSWORD_PLACEHOLDER|${NATS_PASSWORD}|g" \
  -e "s|NATS_CLUSTER_PASSWORD_PLACEHOLDER|${NATS_CLUSTER_PASSWORD}|g" \
  -e "s|NODE_A_IP_PLACEHOLDER|${NODE_A_IP}|g" \
  -e "s|NODE_B_IP_PLACEHOLDER|${NODE_B_IP}|g" \
  -e "s|NODE_C_IP_PLACEHOLDER|${NODE_C_IP}|g" \
  "$CONFIG_FILE" > "$RESOLVED_CONFIG"

echo "NATS config resolved: $CONFIG_FILE -> $RESOLVED_CONFIG"
echo "Cluster routes: Node A=${NODE_A_IP}, Node B=${NODE_B_IP}, Node C=${NODE_C_IP}"

# Start nats-server with the resolved configuration
exec nats-server -c "$RESOLVED_CONFIG"
