#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   PURCHASE_SCHEDULE_AUTOMATION_TOKEN=secret ./scripts/run-purchase-schedule-cron.sh
#   API_BASE_URL=http://localhost:5000 BRANCH_IDS="1,2,3" PURCHASE_SCHEDULE_AUTOMATION_TOKEN=secret ./scripts/run-purchase-schedule-cron.sh
#
# Optional env vars:
#   API_BASE_URL   default: http://localhost:5000
#   BRANCH_IDS     default: 1 (comma-separated list)
#   CURL_BIN       default: curl

API_BASE_URL="${API_BASE_URL:-http://localhost:5000}"
BRANCH_IDS="${BRANCH_IDS:-1}"
CURL_BIN="${CURL_BIN:-curl}"
TOKEN="${PURCHASE_SCHEDULE_AUTOMATION_TOKEN:-}"

if [[ -z "$TOKEN" ]]; then
  echo "ERROR: PURCHASE_SCHEDULE_AUTOMATION_TOKEN is required." >&2
  exit 1
fi

IFS=',' read -r -a BRANCH_ID_ARRAY <<< "$BRANCH_IDS"

for raw_id in "${BRANCH_ID_ARRAY[@]}"; do
  branch_id="$(echo "$raw_id" | xargs)"
  if [[ -z "$branch_id" ]]; then
    continue
  fi

  echo "Running purchase schedule automation for branchId=${branch_id}..."
  "$CURL_BIN" -sS -X POST \
    "${API_BASE_URL}/api/purchases/payment-schedule/automation/cron?branchId=${branch_id}" \
    -H "x-automation-token: ${TOKEN}"
  echo
done

echo "Purchase schedule automation run completed."
