# BD Smart POS Deployment Guide

## 1) Prerequisites
- Node.js 20+ recommended
- MySQL 8+
- npm

## 2) Backend Setup
1. Copy `backend/.env.example` to `backend/.env`
2. Update `DATABASE_URL` and `JWT_SECRET`
3. Install dependencies:
   - `cd backend && npm install`
4. Sync schema:
   - `npx prisma generate`
   - `npx prisma db push --accept-data-loss`
5. Start backend:
   - `npm run dev` (development)
   - `npm start` (production mode)

## 3) Seed Initial System
- Create initial branch/accounts/admin:
  - `POST /api/bootstrap/seed`
  - Example body:
```json
{
  "branchName": "Main Branch",
  "adminEmail": "admin@bdpos.local",
  "adminPassword": "123456"
}
```

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
- Use strong `JWT_SECRET`
- Restrict CORS origin in backend
- Run behind reverse proxy (Nginx/Caddy)
- Enable DB backups and log retention
- Use process manager (PM2/systemd) for backend uptime
