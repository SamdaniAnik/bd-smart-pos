# BD Smart POS

Bangladesh-focused retail Point of Sale — POS, inventory, dues (Bakir Khata), loyalty, VAT/EFD, online storefront, and more.

## User documentation (বাংলা)

**Shop staff and owners:** see the full guide in Bangla:

→ **[docs/USER_GUIDE_BN.md](./docs/USER_GUIDE_BN.md)** (includes **§18 Process Flow** diagrams)

Covers login, daily POS, products, customers, dues, loyalty QR cards, warranty, settings, and role-based workflows.

## Developer setup

```bash
# Backend
cd backend && npm install && cp .env.example .env && npm run dev

# Frontend
cd frontend && npm install && npm run dev
```

See [backend/README.md](./backend/README.md) for API and automation notes.

## Deploy (production)

- **Frontend (Vercel):** [docs/DEPLOY_VERCEL.md](./docs/DEPLOY_VERCEL.md)
- **Backend:** host `backend/` on Railway, Render, Fly.io, or a VPS with MySQL — not Vercel serverless (Socket.IO + long-running Express).
