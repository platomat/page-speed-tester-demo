#!/usr/bin/env bash
# One-time Cloudflare resource setup. Run after: npm install && wrangler login
set -euo pipefail

echo "Creating D1 database..."
wrangler d1 create page-speed-tester-db || true

echo "Creating R2 bucket..."
wrangler r2 bucket create page-speed-tester-reports || true

echo "Creating KV namespace..."
wrangler kv namespace create page-speed-tester-worker-kv || true

echo ""
echo "Add to Cloudflare Workers Build env (Git deploy) or local .env:"
echo "  D1_DATABASE_ID=<from d1 create output>"
echo "  KV_NAMESPACE_ID=<from kv create output>"
echo ""
echo "Then set Worker Secrets in Cloudflare (or wrangler secret put):"
echo "  SESSION_SECRET, GH_PAT, WORKER_API_SECRET"
echo ""
echo "Deploy: push to GitHub (CF build) or locally: npm run deploy"
