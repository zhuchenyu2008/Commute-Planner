# AI Commute

<p align="center">
  <img src="output/readme-assets/logo.png" alt="AI Commute Logo" width="520">
</p>

<p align="center"><strong>Your AI commute planning and reminder assistant</strong></p>

<p align="center">
  <a href="#highlights">Highlights</a>
  ·
  <a href="README.md">中文</a>
  ·
  <a href="#docker">Docker</a>
  ·
  <a href="#local-development">Local Development</a>
</p>

<p align="center">
  <img alt="Next.js" src="https://img.shields.io/badge/Next.js-15-black">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-blue">
  <img alt="Prisma" src="https://img.shields.io/badge/Prisma-SQLite-2D3748">
  <img alt="License" src="https://img.shields.io/badge/license-AGPL--3.0-orange">
  <img alt="Docker" src="https://img.shields.io/badge/Docker-ready-2496ED">
</p>

## Overview

AI Commute is an intelligent planning app for personal commute workflows. It uses Next.js, Prisma/SQLite, AMap services, and an OpenAI-compatible planning runner to connect place search, route options, weather references, trip reminders, Telegram conversations, and email notifications into one complete commute flow.

It is useful when you want to:

- Work backward from an arrival time to find the right departure time.
- Let AI combine preferences, routes, and weather into a commute plan.
- Continue the agent conversation or switch trips from Telegram.
- Receive departure reminders and route-change alerts by email or Telegram.

## Highlights

- **AI route planning**: Create an agent conversation from a natural-language goal, then call place, route, weather, and persistence tools to generate a trip.
- **Multi-leg trips and buffers**: Supports route legs, weather/traffic buffers, latest departure time, and reminder scheduling.
- **User-level settings**: Saves default city, default origin, commute preferences, Telegram Chat ID, email recipient, and route-change thresholds.
- **Notification loop**: Includes a scheduler, Telegram worker, email templates, and notification delivery logs.
- **Deployment friendly**: Supports one-command local startup and Docker Compose for the web app, scheduler, and Telegram worker.

## Screenshots

| Home | History | Memories |
| --- | --- | --- |
| <img src="output/readme-assets/home.png" alt="Home" width="240"> | <img src="output/readme-assets/history.png" alt="Trip history" width="240"> | <img src="output/readme-assets/memories.png" alt="Commute memories" width="240"> |

### Email Reminders

<p align="center">
  <img src="output/readme-assets/departure-reminder-mobile.png" alt="Departure reminder email" width="360">
  <img src="output/readme-assets/route-change-mobile.png" alt="Route change email" width="360">
</p>

## Tech Stack

- Next.js 15 / React 19 / TypeScript
- Prisma / SQLite
- Tailwind CSS / lucide-react
- Vitest / Playwright
- Nodemailer / Telegram Bot API
- OpenAI-compatible Chat Completions

## Local Development

1. Copy and fill in environment variables:

```bash
cp .env.example .env
```

2. Install dependencies:

```bash
npm install
```

3. Prepare the database:

```bash
npm run prisma:deploy
npm run prisma:seed
```

4. Start the development server:

```bash
npm run dev
```

Default seed account:

```text
user@example.com / password
```

## Common Scripts

```bash
npm run dev
npm run build
npm run start
npm run lint
npm test
npm run test:watch
npm run prisma:generate
npm run prisma:migrate
npm run prisma:deploy
npm run prisma:seed
npm run scheduler:tick
npm run email:test-templates
npm run email:test-departure-reminder
npm run email:test-route-change
npm run telegram:poll
```

## Docker

Run the web app, scheduler, and Telegram worker together:

```bash
docker compose up --build
```

The one-shot `migrate` service runs `npx prisma migrate deploy` first. `web`, `scheduler`, and `telegram` all depend on it with `service_completed_successfully`, so the SQLite schema is migrated before long-running services start.

- `web`: runs `npm run start` and exposes `3000:3000`.
- `scheduler`: runs `npm run scheduler:tick` every 60 seconds.
- `telegram`: runs `npm run telegram:poll`.
- SQLite data is persisted to host path `./data`; the container path is `/app/data`.

## One-Command Local Startup

Windows:

```powershell
.\start-all.ps1
```

You can also double-click `start-all.cmd`. If PowerShell execution policy blocks the script, use `start-all.cmd`; it invokes PowerShell with `ExecutionPolicy Bypass`.

Linux:

```bash
chmod +x ./start-all.sh
./start-all.sh
```

Available arguments:

```bash
npm run start:all -- --configure
npm run start:all -- --yes
```

## Telegram Two-Way Entry

The Telegram polling worker requires this `.env` value:

```bash
TELEGRAM_BOT_TOKEN=
```

After logging in to the website, users need to save their Telegram Chat ID on the settings page. The worker can then connect Telegram conversations with in-app users.

Common commands:

- `/new arrive at Foreign Affairs School at 9 tomorrow` creates a new trip.
- `/new` followed by the next normal text message creates a new trip.
- Normal text continues the current agent conversation.
- `/trips` switches the trip bound to the current Telegram conversation through inline buttons.
- `/cancel` cancels monitoring for the current trip.

## Email Reminders

After SMTP is fully configured, the scheduler can send departure reminders and route-change alerts. Recipients are entered by users on the settings page instead of being stored in `.env`.

```bash
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
SMTP_TLS_USE_SYSTEM_CA=false
```

Send mock email templates locally:

```bash
npm run email:test-templates
npm run email:test-departure-reminder
npm run email:test-route-change
```

## Environment Variables

Core configuration:

- `DATABASE_URL`: Prisma database connection. SQLite is supported by default.
- `DEFAULT_CITY`: Default city.
- `DEFAULT_TIMEZONE`: Default timezone, for example `Asia/Shanghai`.
- `AMAP_API_KEY`: AMap Web Service key. When empty, the mock AMap client is used.
- `OPENAI_API_KEY`: Credential for the OpenAI-compatible planning runner. When empty, the built-in fallback planner is used.
- `OPENAI_BASE_URL`: Custom base URL for an OpenAI-compatible API.
- `OPENAI_MODEL`: Model name for the planning runner.
- `SEED_USER_EMAIL`: Seed account email.
- `SEED_USER_PASSWORD`: Seed account password.
- `SCHEDULER_TICK_SECRET`: Shared secret that protects the scheduler tick API.
- `TELEGRAM_BOT_TOKEN`: Telegram bot token.

> AMap API console: https://console.amap.com/dev/index. It includes a monthly free quota, which is more than enough for personal use. This project limits concurrency to 3.

## Testing

Unit and integration tests:

```bash
npm test
```

Type check:

```bash
npm run lint
```

Production build:

```bash
npm run build
```

Playwright E2E:

```bash
npm run test:e2e -- tests/e2e/commute-flow.spec.ts --reporter=line --workers=1
```

---

## Acknowledgements

- CodeX
- GPT-Image-2
- stitch
- Linux Do
- 啃果干儿^-^
