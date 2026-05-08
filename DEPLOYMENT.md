# BD Smart POS Deployment Guide

## 1) Prerequisites
- Node.js 20+ recommended
- MySQL 8+
- npm

## 2) Backend Setup
1. Copy `backend/.env.example` to `backend/.env`
2. Update at minimum:
   - `DATABASE_URL`
   - `JWT_SECRET` (use `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`)
   - `ALLOWED_ORIGINS` (e.g. `https://pos.example.com`)
   - `BOOTSTRAP_SEED_TOKEN` (production only — required to call seed)
3. Install dependencies:
   - `cd backend && npm install`
4. Sync schema:
   - `npx prisma generate`
   - `npx prisma migrate deploy` (production) or `npx prisma db push --accept-data-loss` (dev)
5. Start backend:
   - `npm run dev` (development)
   - `npm start` (production mode, with `NODE_ENV=production`)

## 3) Seed Initial System (one-time per branch)
- Create initial branch/accounts/admin:
  - `POST /api/bootstrap/seed`
  - Header (production): `X-Bootstrap-Token: <BOOTSTRAP_SEED_TOKEN>`
  - Example body:
```json
{
  "branchName": "Main Branch",
  "adminEmail": "admin@bdpos.local",
  "adminPassword": "<strong-password>"
}
```
- Subsequent calls against the same branch return **409 Conflict** — the branch is already bootstrapped.
- Subsequent calls without `branchId` also return **409** if any branch in the system is already bootstrapped.
- Production refuses to seed admin password `123456` — pass a strong `adminPassword`.
- Without `BOOTSTRAP_SEED_TOKEN` set, production returns **503** for all seed calls.

## 4) Frontend Setup
1. Copy `frontend/.env.example` to `frontend/.env`
2. Install dependencies:
   - `cd frontend && npm install`
3. Start frontend:
   - `npm run dev`

## 5) Smoke Test
- Ensure backend is running, then:
  - `cd backend && npm run smoke`
- This validates login, supplier/customer/product creation, purchase, sale, return, and accounting/report endpoints.

## 6) Production Recommendations
- Use strong `JWT_SECRET` (≥ 24 chars; the server fails fast if shorter in prod)
- Set explicit `ALLOWED_ORIGINS` (an empty list in prod denies all browsers)
- Set `NODE_ENV=production` so config gates engage (seed token required, default password refused, dev fallbacks disabled)
- Run behind reverse proxy (Nginx/Caddy) and set `TRUST_PROXY=1` (or the proxy hop count) so rate-limit IPs are accurate
- Enable DB backups and log retention
- Use process manager (PM2/systemd) for backend uptime
- Helmet headers, login rate-limit (default 10 per 15 min), and bootstrap rate-limit (default 5 per hour) are enabled by default
