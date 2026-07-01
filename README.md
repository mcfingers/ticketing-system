# Ticketing System

A small ticketing web app where registered users organize tickets by team, group
them into epics, and move them through a fixed kanban workflow:

**New → Ready for implementation → In progress → Ready for acceptance → Done**

## Architecture

Three cleanly separated tiers, each in its own container:

| Tier            | Container | Technology                              |
| --------------- | --------- | --------------------------------------- |
| Presentation    | `web`     | React + Vite SPA, served by **nginx**   |
| Application/API | `api`     | Node + Express + Prisma (HTTP JSON API) |
| Persistence     | `db`      | **PostgreSQL** 16                       |

The `web` container serves the compiled SPA and reverse-proxies `/api/*` to the
`api` container, so the browser talks to a single origin (no CORS). The `api`
container owns all business logic and is the only tier that talks to the database.
HTTP sessions are stored in Postgres (via `connect-pg-simple`), not in memory.

```
browser ──> web (nginx :8080) ──/api──> api (Express :3000) ──> db (Postgres :5432)
                 └── static SPA
```

## Requirements

- **Docker Desktop / Docker Engine with Compose v2** — to run the app itself.
- No host-installed Node, npm, or PostgreSQL is needed.
- Cross-platform: Windows, macOS, Linux.
- **For email verification (sign-up):** outbound access to the SMTP relay
  configured in `docker-compose.yml` (`relay1.dataart.com:25`). This relay is
  only reachable on the DataArt network/VPN. See
  [Email verification & the SMTP dependency](#email-verification--the-smtp-dependency).

## Run it

From the repository root:

```bash
docker compose up --build
```

Then open **http://localhost:8080**.

On startup the API applies the database schema with `prisma db push` and then
starts serving. **It does not seed any data** — a fresh database has no users,
teams, or tickets. Click **Register** to create the first account (then verify
your email — see below).

To stop and wipe all data:

```bash
docker compose down -v
```

### Seeding demo data (optional)

The default startup intentionally seeds nothing. If you want demo data, run the
seed script manually inside the running `api` container:

```bash
docker compose exec api npm run seed
```

This creates a "Demo Team" with two **pre-verified** users you can sign in as:

| Email               | Password      | Role in "Demo Team" |
| ------------------- | ------------- | ------------------- |
| `alice@example.com` | `password123` | admin               |
| `bob@example.com`   | `password123` | member              |

## Accounts & email verification

Registration does **not** log you in immediately. A new account is created in an
unverified state, and sign-in is blocked (HTTP 403) until you confirm your email:

1. **Register** with name, email, and password (min 8 characters).
2. The API emails a verification link (valid for 24 hours).
3. Click the link — it activates the account and redirects you to the sign-in page.
4. **Sign in.** If you try to sign in before verifying, the login screen offers a
   **Resend verification email** action.

### Email verification & the SMTP dependency

The verification email is sent through the SMTP relay configured in
`docker-compose.yml`:

| Env var        | Default                          | Purpose                                        |
| -------------- | -------------------------------- | ---------------------------------------------- |
| `SMTP_HOST`    | `relay1.dataart.com`             | SMTP relay host                                |
| `SMTP_PORT`    | `25`                             | SMTP port (unauthenticated, `secure:false`)    |
| `SMTP_FROM`    | `Ticketing <noreply@dataart.com>`| From address                                   |
| `APP_BASE_URL` | `http://localhost:8080`          | Origin used to build the link + post-verify redirect |

> **Off-network caveat:** the relay only accepts mail on the DataArt
> network/VPN. When you're off-network, registration returns **502** because the
> email can't be sent. The account is still created (unverified) — reconnect and
> use **Resend verification email** to finish, or seed a pre-verified demo user
> as shown above.

## Using the app

- **Teams** — pick a team from the dropdown, or create one (the creator becomes
  its admin). Add other registered users to a team by their email. An admin can
  delete a team, but only once it has no tickets and no epics.
- **Epics** — create, edit, and delete epics to group related tickets. An epic
  can't be deleted while tickets still reference it.
- **Tickets** — create a ticket (lands in **New**), give it a **type**
  (🐛 Bug / ✨ Feature / 🔧 Fix), optionally assign it to a team member and an
  epic, then drag cards between columns to move them through the workflow. Click a
  card to edit, reassign, move to another team, or delete it.
- **Filter & search** — narrow the board by ticket title, type, and/or epic; the
  filters combine with AND.
- **Visibility** — tickets and epics belong to one team and are visible only to
  that team's members.

## API overview

All endpoints are under `/api`. Authentication is an httpOnly session cookie.
Status codes are meaningful: `400` validation, `401` unauthenticated, `403`
forbidden/unverified, `404` missing, `409` conflict (duplicate name/email,
already-a-member, or delete-with-children).

### Auth

| Method | Path                    | Description                                        |
| ------ | ----------------------- | ------------------------------------------------- |
| POST   | `/api/auth/register`    | Register (creates an unverified account, emails a link) |
| GET    | `/api/auth/verify`      | Confirm email via the emailed token, then redirect |
| POST   | `/api/auth/resend`      | Resend a verification link (enumeration-safe)     |
| POST   | `/api/auth/login`       | Log in (403 if email not yet verified)            |
| POST   | `/api/auth/logout`      | Log out                                            |
| GET    | `/api/auth/me`          | Current user                                       |

### Teams & members

| Method | Path                       | Description                                   |
| ------ | -------------------------- | --------------------------------------------- |
| GET    | `/api/teams`               | Teams the user belongs to                     |
| POST   | `/api/teams`               | Create a team (creator = admin)               |
| DELETE | `/api/teams/:id`           | Delete a team (admin only; 409 if not empty)  |
| GET    | `/api/teams/:id/members`   | List team members                             |
| POST   | `/api/teams/:id/members`   | Add a registered user by email                |

### Epics

| Method | Path                          | Description                                |
| ------ | ----------------------------- | ------------------------------------------ |
| GET    | `/api/epics?teamId=...`       | Epics for a team (with ticket counts)      |
| POST   | `/api/epics`                  | Create an epic                             |
| PATCH  | `/api/epics/:id`              | Edit an epic's title/description           |
| DELETE | `/api/epics/:id`              | Delete an epic (409 if it still has tickets) |

### Tickets

| Method | Path                          | Description                          |
| ------ | ----------------------------- | ------------------------------------ |
| GET    | `/api/tickets?teamId=...`     | Tickets for a team                   |
| POST   | `/api/tickets`                | Create a ticket (lands in *New*)     |
| PATCH  | `/api/tickets/:id`            | Edit / move / reorder / reassign / re-team a ticket |
| DELETE | `/api/tickets/:id`            | Delete a ticket                      |

### Misc

| Method | Path           | Description        |
| ------ | -------------- | ------------------ |
| GET    | `/api/health`  | Health check       |

## Project layout

```
.
├── docker-compose.yml          # db + api + web
├── api/                        # Express + Prisma (application/API tier)
│   ├── prisma/schema.prisma    # User, Team, TeamMember, Epic, Ticket + enums
│   ├── docker-entrypoint.sh    # prisma db push, then start (no seed)
│   └── src/
│       ├── index.ts            # app + session setup, route mounting
│       ├── db.ts               # Prisma client
│       ├── middleware.ts       # requireAuth, assertMembership
│       ├── mailer.ts           # nodemailer verification emails
│       ├── seed.ts             # optional demo data (npm run seed)
│       └── routes/             # auth, teams, epics, tickets
└── web/                        # React + Vite SPA (presentation tier)
    ├── nginx.conf              # serves SPA + proxies /api
    └── src/                    # pages, auth context, API client
```

## Local development (optional, without Docker)

Requires host Node 20+ and a Postgres reachable at `DATABASE_URL`.

```bash
# API
cd api && npm install && npx prisma db push && npm run build && npm start
# Web (separate shell) — Vite proxies /api to localhost:3000
cd web && npm install && npm run dev
```
