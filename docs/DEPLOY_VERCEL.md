# Deploy BD Smart POS on Vercel (frontend)

BD Smart POS is a **monorepo**: a Vite + React **frontend** and an Express + Prisma + MySQL **backend** with Socket.IO.

| Component | Recommended host | Notes |
|-----------|------------------|--------|
| `frontend/` | **Vercel** | Static SPA build |
| `backend/` | Railway, Render, Fly.io, or VPS | Long-running Node + WebSockets |
| MySQL | Railway MySQL, Aiven, DigitalOcean, RDS, etc. | `DATABASE_URL` for Prisma |

Do **not** deploy the full backend on Vercel without refactoring — Express, Socket.IO, and background jobs expect a persistent server.

---

## 1. Deploy the backend first

You need a live API URL before configuring Vercel.

### Railway / Render (example)

1. Create a new service from [github.com/SamdaniAnik/bd-smart-pos](https://github.com/SamdaniAnik/bd-smart-pos).
2. Set **root directory** to `backend`.
3. **Build:** `npm install` (`postinstall` runs `prisma generate`).
4. **Start:** `node src/server.js`.
5. Attach a **MySQL** database and set environment variables (see `backend/.env.example`).

**Minimum production env vars:**

```bash
DATABASE_URL=mysql://user:password@host:3306/bd_pos
JWT_SECRET=<48+ char random hex>
NODE_ENV=production
ALLOWED_ORIGINS=https://your-app.vercel.app
TRUST_PROXY=1
BOOTSTRAP_SEED_TOKEN=<long random secret>
MANAGER_APPROVAL_PIN=<strong pin>
LOYALTY_OTP_SALT=<random secret>
```

Generate a secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### Run migrations (once)

On the backend host shell:

```bash
cd backend
npx prisma migrate deploy
```

Optional demo data:

```bash
npm run seed:demo
```

### Note your API base URL

Example: `https://bd-smart-pos-api.up.railway.app`

- REST API: `https://<api-host>/api`
- Socket.IO: `https://<api-host>` (same origin as the HTTP server)

---

## 2. Deploy the frontend on Vercel

### Dashboard

1. [vercel.com](https://vercel.com) → **Add New** → **Project**.
2. Import `SamdaniAnik/bd-smart-pos`.
3. Configure:

| Setting | Value |
|---------|--------|
| Root Directory | `frontend` |
| Framework Preset | Vite |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Install Command | `npm install` |

4. **Environment variables** (Production + Preview):

| Name | Example |
|------|---------|
| `VITE_API_BASE_URL` | `https://bd-smart-pos-api.up.railway.app/api` |
| `VITE_SOCKET_URL` | `https://bd-smart-pos-api.up.railway.app` |

5. Deploy.

`frontend/vercel.json` rewrites all routes to `index.html` so React Router works on refresh.

### CLI

```bash
cd frontend
npm i -g vercel
vercel login
vercel link
vercel env add VITE_API_BASE_URL production
vercel env add VITE_SOCKET_URL production
vercel --prod
```

---

## 3. Post-deploy checklist

- [ ] **CORS:** `ALLOWED_ORIGINS` on the backend includes your exact Vercel URL (e.g. `https://bd-smart-pos.vercel.app`), comma-separated if you have preview URLs too.
- [ ] **HTTPS:** Frontend and API both use `https://`.
- [ ] **Bootstrap:** Run initial seed once via `POST /api/bootstrap/seed` with `X-Bootstrap-Token` (see `backend/README.md`).
- [ ] **Login:** Open the Vercel URL and sign in with seeded credentials (or your admin user).
- [ ] **Sockets:** Customer display / real-time features need `VITE_SOCKET_URL` pointing at a host that supports WebSockets (not Vercel serverless).
- [ ] **Cron:** Schedule automation on the **backend** (not Vercel), e.g. purchase schedule cron with `x-automation-token` — see `backend/README.md`.

---

## 4. Preview deployments

For Vercel preview URLs, either:

- Add each preview origin to `ALLOWED_ORIGINS` on the backend, or
- Use a staging API with `ALLOWED_ORIGINS` that includes `https://*.vercel.app` — **not supported** as a wildcard in this app; list explicit origins instead.

Common pattern: one staging API + one staging Vercel project with fixed URLs.

---

## 5. Local production build test

Before deploying:

```bash
cd frontend
VITE_API_BASE_URL=https://your-api-host.com/api \
VITE_SOCKET_URL=https://your-api-host.com \
npm run build
npm run preview
```

Open the preview URL and verify login + a few API screens.

---

## 6. Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| Blank page after refresh on `/sales` etc. | Missing `vercel.json` rewrites — ensure `frontend/vercel.json` is deployed. |
| CORS error in browser console | `ALLOWED_ORIGINS` missing your Vercel URL on the backend. |
| Network error / 502 on API | Backend down, wrong `VITE_API_BASE_URL`, or DB connection failed. |
| Login works locally but not on Vercel | Env vars not set on Vercel, or old build — redeploy after changing `VITE_*` vars. |
| Customer display not updating | `VITE_SOCKET_URL` wrong or backend WebSockets blocked. |

---

## Related docs

- [backend/README.md](../backend/README.md) — API, cron, automation tokens
- [frontend/.env.example](../frontend/.env.example) — frontend env template
- [backend/.env.example](../backend/.env.example) — full backend env reference
