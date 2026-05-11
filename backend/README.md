# BD Smart POS Backend

This is the starter backend for a Bangladesh-focused Point of Sales system.

## Setup

```bash
cd backend
npm install
cp .env.example .env
npm run dev
```

Open:

```text
http://localhost:5000
```

You should see:

```text
BD Smart POS API is running
```

## Purchase Schedule Automation (Cron)

The purchase payment schedule reminder automation endpoint is:

`POST /api/purchases/payment-schedule/automation/cron?branchId=<id>`

It requires a token in `x-automation-token` that must match:

`PURCHASE_SCHEDULE_AUTOMATION_TOKEN` in `backend/.env`

Example `.env` value:

```bash
PURCHASE_SCHEDULE_AUTOMATION_TOKEN=replace-with-a-long-random-secret
```

Manual test with curl:

```bash
curl -X POST "http://localhost:5000/api/purchases/payment-schedule/automation/cron?branchId=1" \
  -H "x-automation-token: replace-with-a-long-random-secret"
```

Reusable script:

```bash
chmod +x ./scripts/run-purchase-schedule-cron.sh
```

Run once (single branch):

```bash
PURCHASE_SCHEDULE_AUTOMATION_TOKEN=replace-with-a-long-random-secret \
./scripts/run-purchase-schedule-cron.sh
```

Run once (multiple branches):

```bash
API_BASE_URL=http://localhost:5000 \
BRANCH_IDS="1,2,3" \
PURCHASE_SCHEDULE_AUTOMATION_TOKEN=replace-with-a-long-random-secret \
./scripts/run-purchase-schedule-cron.sh
```

Example crontab (runs daily at 8:00 AM, branch 1):

```bash
0 8 * * * cd /path/to/bd-smart-pos/backend && PURCHASE_SCHEDULE_AUTOMATION_TOKEN=replace-with-a-long-random-secret ./scripts/run-purchase-schedule-cron.sh >>/tmp/purchase-schedule-cron.log 2>&1
```
