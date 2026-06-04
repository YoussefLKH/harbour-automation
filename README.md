# 🌊 Harbour Automation

Done-for-you automation systems for small businesses in Halifax & Atlantic Canada.
Virtual receptionists, bookkeeping, customer service — built and maintained for the client.

**Model:** Apply → Discovery call → Invite → Client dashboard.

## Stack
- **Frontend:** static HTML/CSS/JS (ocean/harbourside design system)
- **Backend:** Node + Express
- **Data + Auth:** Supabase (Postgres)
- **Billing:** Stripe (retainers + setup fees)

## Setup
```bash
npm install
cp .env.example .env      # fill in Supabase + Stripe keys
npm start                 # → http://localhost:3000
```

## Database
Run `db/schema.sql` in the Supabase SQL editor to create all tables + RLS policies.

## Funnel
| Stage | Where | Table |
|-------|-------|-------|
| Public landing | `public/index.html` | — |
| Application form | `public/apply.html` | `applications` |
| Admin review & invite | `public/admin.html` | `invites` |
| Client onboarding | `public/login.html` | `profiles` |
| Client dashboard | `public/dashboard.html` | `systems`, `support_*`, `invoices`, `reports` |

## Status
- [x] Project scaffold + ocean design system
- [x] Landing page
- [x] Supabase schema
- [ ] Application form + intake
- [ ] Admin review + invite flow
- [ ] Auth + client dashboard
- [ ] Realtime support chat
- [ ] Stripe billing
- [ ] Deploy
