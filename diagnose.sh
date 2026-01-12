#!/usr/bin/env bash
set -euo pipefail

echo "========================================="
echo "Tailscale Serve Diagnostic Tool"
echo "========================================="
echo ""

echo "1. Tailscale Status:"
echo "-----------------------------------"
tailscale status
echo ""

echo "2. Tailscale Serve Configuration:"
echo "-----------------------------------"
tailscale serve status
echo ""

echo "3. Check if frontend/backend are running:"
echo "-----------------------------------"
echo "Backend (port 50000):"
curl -s http://127.0.0.1:50000 2>&1 | head -5 || echo "Backend not responding"
echo ""
echo "Frontend (port 50001):"
curl -s http://127.0.0.1:50001 2>&1 | head -5 || echo "Frontend not responding"
echo ""

echo "4. Port listening status:"
echo "-----------------------------------"
ss -tlnp | grep -E ':(50000|50001)' || lsof -i :50000 -i :50001 || echo "Ports not listening"
echo ""

echo "5. Tailscale hostname:"
echo "-----------------------------------"
HOSTNAME=$(tailscale status --json | grep -o '"HostName":"[^"]*"' | cut -d'"' -f4 || echo "unknown")
echo "Your Tailscale hostname: ${HOSTNAME}"
echo "Access URL: https://${HOSTNAME}/"
echo ""

echo "6. Check if Funnel is needed:"
echo "-----------------------------------"
echo "If you need PUBLIC internet access (not just tailnet), you need to use 'funnel' instead of 'serve'."
echo "Current setup: tailscale serve (tailnet only)"
echo ""

echo "========================================="
echo "Diagnostic Complete"
echo "========================================="
