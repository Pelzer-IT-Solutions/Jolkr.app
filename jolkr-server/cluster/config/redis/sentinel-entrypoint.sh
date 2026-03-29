#!/bin/bash
set -e

TEMPLATE="/etc/redis/sentinel.conf"
CONFIG="/tmp/sentinel.conf"

# Validate required environment variables
if [ -z "$REDIS_PASSWORD" ]; then
    echo "ERROR: REDIS_PASSWORD is not set"
    exit 1
fi

if [ -z "$NODE_A_IP" ]; then
    echo "ERROR: NODE_A_IP is not set"
    exit 1
fi

if [ -z "$NODE_IP" ]; then
    echo "ERROR: NODE_IP is not set"
    exit 1
fi

# Copy template and replace placeholders
cp "$TEMPLATE" "$CONFIG"
sed -i "s/REDIS_PASSWORD_PLACEHOLDER/${REDIS_PASSWORD}/g" "$CONFIG"
sed -i "s/NODE_A_IP_PLACEHOLDER/${NODE_A_IP}/g" "$CONFIG"
sed -i "s/NODE_IP_PLACEHOLDER/${NODE_IP}/g" "$CONFIG"

echo "Sentinel config prepared:"
echo "  Primary (initial): ${NODE_A_IP}:6379"
echo "  Announce IP: ${NODE_IP}"
echo "  Quorum: 2"

# Start Redis Sentinel with the resolved config
exec redis-sentinel "$CONFIG"
