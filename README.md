# Commute Planner

Personal agentic commute planner built with Next.js, Prisma/SQLite, AMap tools, and an OpenAI-compatible planning runner.

## Local Development

1. Keep your runtime configuration in `.env`.
2. Install dependencies:

```bash
npm install
```

3. Prepare the local database:

```bash
npm run prisma:deploy
npm run prisma:seed
```

4. Start the app:

```bash
npm run dev
```

The seeded login defaults to `user@example.com` / `password` unless overridden by environment variables.

## Tests

```bash
npm test
npm run lint
npm run build
npm run test:e2e -- tests/e2e/commute-flow.spec.ts --reporter=line --workers=1
```

The E2E runner builds the app, starts a production server, runs Playwright, and then stops the server. It uses a local SQLite database named `e2e-test.db` unless `DATABASE_URL` is supplied.

## Scheduler

Run one scheduler tick locally:

```bash
npm run scheduler:tick
```

The scheduler checks due reminder jobs, performs recalculation logging, and sends Telegram/email notifications when those adapters are configured.

## Docker

Run the web app and scheduler together:

```bash
docker compose up --build
```

SQLite data is persisted in `./data` and mounted at `/app/data` inside the containers. The compose file reads `.env` for API keys and notification settings.
